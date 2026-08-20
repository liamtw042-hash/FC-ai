/**
 * Runs QUICKSTART.md, verbatim, and checks the answer.
 *
 * The document promises ten 85 rated squads from the sample club. A promise in a
 * README rots the first time an argument name changes, so this runs the exact
 * commands the document prints, in order, and fails loudly if the last one does
 * not come back with ten of ten.
 *
 *   npm run quickstart
 *
 * The solver service has to be running. Start it with `npm run solver:dev`.
 */

import { spawnSync } from 'node:child_process'

import { REPO_ROOT, nodeCli } from './lib/platform.ts'

const ROOT = REPO_ROOT

/** Exactly the commands QUICKSTART.md prints, in the order it prints them. */
const STEPS: string[][] = [
  ['import', 'cards', 'data/sample/cards.csv'],
  ['import', 'club', 'data/sample/club.csv'],
  ['import', 'prices', 'data/sample/prices.json'],
  ['status'],
  ['sbc', 'add', 'data/sample/sbc/eighty-five.json'],
  ['solve', 'eighty five', '--repeat', '10', '--time', '180'],
]

function run(args: string[]): { code: number; out: string } {
  // Through Node against tsx's own entry point, never through the `npx` shim:
  // on Windows `npx` is `npx.cmd` and a `.cmd` cannot be spawned without a shell.
  const tsx = nodeCli('tsx', ['scripts/fcai.ts', ...args], ROOT)
  const result = spawnSync(tsx.command, tsx.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function main(): number {
  let last = ''
  for (const step of STEPS) {
    const printed = `fcai ${step.map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ')}`
    process.stdout.write(`\n$ ${printed}\n`)
    const { code, out } = run(step)
    last = out
    process.stdout.write(out.split('\n').slice(0, 6).join('\n') + '\n')
    if (code !== 0 && step[0] !== 'solve') {
      process.stderr.write(`QUICKSTART FAILED at: ${printed}\n${out}\n`)
      return 1
    }
  }

  const line = last.split('\n')[0] ?? ''
  const match = /(\d+) of (\d+) squad\(s\) built/.exec(line)
  if (match === null) {
    process.stderr.write(`QUICKSTART FAILED: the solve printed no count. It printed:\n${line}\n`)
    return 1
  }
  const [, built, asked] = match
  if (built !== asked) {
    process.stderr.write(
      `QUICKSTART FAILED: the worked example promises ten 85 rated squads and this ` +
        `run built ${built} of ${asked}. Either the sample club changed or something ` +
        `regressed. Do not edit the promise down; find out which.\n`,
    )
    return 1
  }
  process.stdout.write(`\nQUICKSTART OK: ${built} of ${asked} squads, exactly as documented.\n`)
  return 0
}

process.exitCode = main()
