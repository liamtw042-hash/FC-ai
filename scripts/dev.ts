/**
 * One command starts both. Brief section 10.
 *
 * The Python solver and the Next.js app are two processes and neither is much use
 * alone, so this starts both and keeps their output interleaved and labelled. It
 * also makes the failure mode obvious: if the solver dies, the label says which
 * one died rather than leaving the app to report "the solver is not answering".
 *
 * NOTHING HERE IS SPAWNED BY NAME. `npx` is a `.cmd` shim on Windows and a
 * `.cmd` is not an executable, so `spawn('npx', ...)` fails with ENOENT; and
 * `python3` usually does not exist on Windows at all. Both are resolved in
 * scripts/lib/platform.ts, which explains why. Adding `shell: true` would fix the
 * first and not the second, at the price of handing every argument to cmd.exe to
 * re-parse.
 *
 *   npm run dev
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

import {
  REPO_ROOT,
  ToolNotFoundError,
  describeCommand,
  nodeCli,
  pythonCommand,
  pythonModule,
  pythonModuleInstalled,
  pythonVersion,
  type Command,
} from './lib/platform.ts'

interface Service extends Command {
  label: string
  cwd: string
}

function services(): Service[] {
  // Resolved before anything is spawned, so a missing interpreter is a sentence
  // rather than an ENOENT from a half started pair of processes.
  const uvicorn = pythonModule('uvicorn', [
    'fc_ai_solver.app:app',
    '--host',
    '127.0.0.1',
    '--port',
    '8000',
    '--reload',
  ])
  if (!pythonModuleInstalled('uvicorn')) {
    throw new ToolNotFoundError(
      `Python ${pythonVersion() ?? 'unknown'} was found at ` +
        `${describeCommand(pythonCommand())}, but uvicorn is not installed for it. ` +
        `Run: npm run solver:install`,
    )
  }
  return [
    { label: 'solver', ...uvicorn, cwd: resolve(REPO_ROOT, 'solver') },
    { label: 'web', ...nodeCli('next', ['dev', '-p', '3000']), cwd: REPO_ROOT },
  ]
}

const running: ChildProcess[] = []
let stopping = false

function stop(code: number): void {
  if (stopping) return
  stopping = true
  for (const child of running) child.kill('SIGTERM')
  process.exitCode = code
}

function main(): void {
  let planned: Service[]
  try {
    planned = services()
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
      return
    }
    throw error
  }

  for (const service of planned) {
    const child = spawn(service.command, service.args, {
      cwd: service.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Deliberately NOT shell: true. See the note at the top of this file.
      windowsHide: true,
    })
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
      process.stderr.write(
        `[${label}] could not start: ${error.message}\n` +
          `[${label}] the command was: ${describeCommand(service)}\n`,
      )
      stop(1)
    })
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => stop(0))
  }

  process.stdout.write(
    `Solver on 127.0.0.1:8000 via ${describeCommand(pythonCommand())} ` +
      `(Python ${pythonVersion() ?? 'unknown'}), web on 127.0.0.1:3000. Neither talks to EA.\n`,
  )
}

main()
