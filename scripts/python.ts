/**
 * Runs a Python module against the interpreter this machine actually has.
 *
 * The npm scripts used to say `cd solver && python3 -m pytest`. Two problems on
 * Windows: `python3` usually does not exist there, and `pip` warning that its
 * `Scripts` directory is not on PATH means `pytest` and `uvicorn` are not
 * callable by name even when installed. This resolves the interpreter and always
 * goes through `-m`.
 *
 *   npx tsx scripts/python.ts --cwd solver -m pytest tests -q
 *   npx tsx scripts/python.ts -m pip install -r solver/requirements.txt
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import {
  REPO_ROOT,
  ToolNotFoundError,
  describeCommand,
  pythonCommand,
  pythonVersion,
} from './lib/platform.ts'

const argv = process.argv.slice(2)
let cwd = REPO_ROOT
const passthrough: string[] = []

for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index] ?? ''
  if (argument === '--cwd') {
    // resolve() rather than string concatenation, so a forward slash in the
    // argument becomes a backslash path on Windows instead of a broken one.
    cwd = resolve(REPO_ROOT, argv[index + 1] ?? '.')
    index += 1
  } else {
    passthrough.push(argument)
  }
}

if (passthrough.length === 0) {
  process.stderr.write('usage: python.ts [--cwd DIR] -m MODULE [args...]\n')
  process.exitCode = 2
} else {
  try {
    const python = pythonCommand()
    const result = spawnSync(python.command, [...python.args, ...passthrough], {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    })
    if (result.error !== undefined) {
      process.stderr.write(
        `could not run ${describeCommand(python)}: ${result.error.message}\n`,
      )
      process.exitCode = 1
    } else {
      process.exitCode = result.status ?? 1
    }
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}

void pythonVersion
