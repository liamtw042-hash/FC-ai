/**
 * One command starts both. Brief section 10.
 *
 * The Python solver and the Next.js app are two processes and neither is much use
 * alone, so this starts both and keeps their output interleaved and labelled. It
 * also makes the failure mode obvious: if the solver dies, the label says which
 * one died rather than leaving the app to report "the solver is not answering".
 *
 *   npm run dev
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface Service {
  label: string
  command: string
  args: string[]
  cwd: string
}

const SERVICES: Service[] = [
  {
    label: 'solver',
    command: 'python3',
    args: ['-m', 'uvicorn', 'fc_ai_solver.app:app', '--host', '127.0.0.1', '--port', '8000', '--reload'],
    cwd: resolve(ROOT, 'solver'),
  },
  {
    label: 'web',
    command: 'npx',
    args: ['next', 'dev', '-p', '3000'],
    cwd: ROOT,
  },
]

const running: ChildProcess[] = []
let stopping = false

function stop(code: number): void {
  if (stopping) return
  stopping = true
  for (const child of running) child.kill('SIGTERM')
  process.exitCode = code
}

for (const service of SERVICES) {
  const child = spawn(service.command, service.args, { cwd: service.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  running.push(child)

  const label = service.label.padEnd(6)
  const write = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim() !== '') stream.write(`[${label}] ${line}\n`)
    }
  }
  child.stdout?.on('data', write(process.stdout))
  child.stderr?.on('data', write(process.stderr))

  child.on('exit', (code) => {
    if (stopping) return
    process.stderr.write(`\n[${label}] exited with code ${String(code)}. Stopping the other one too.\n`)
    stop(code ?? 1)
  })
  child.on('error', (error) => {
    process.stderr.write(`[${label}] could not start: ${error.message}\n`)
    if (service.label === 'solver') {
      process.stderr.write('[solver] is python3 on your PATH, and did npm run solver:install succeed?\n')
    }
    stop(1)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => stop(0))
}

process.stdout.write('Solver on 127.0.0.1:8000, web on 127.0.0.1:3000. Neither talks to EA.\n')
