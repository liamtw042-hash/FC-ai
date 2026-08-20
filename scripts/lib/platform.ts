/**
 * Launching other programs, on Windows as well as on POSIX.
 *
 * TWO THINGS BREAK ON WINDOWS AND BOTH ARE HERE.
 *
 * `npx`, `tsx` and `next` are `.cmd` shims on Windows, and a `.cmd` file is not
 * an executable: `CreateProcess` cannot run one, so `spawn('npx', ...)` fails
 * with ENOENT. The usual fix is `shell: true`, which is worse than it looks: it
 * hands the whole command line to `cmd.exe` to re-parse, so a path containing a
 * space or an `&` becomes a quoting bug, and every argument becomes an injection
 * surface. So nothing here spawns a shim. A Node CLI is launched by running
 * NODE ITSELF against the package's own entry point, which is the same file on
 * every platform and needs no shell at all.
 *
 * `python3` is the normal name on POSIX and usually does not exist on Windows,
 * where the interpreter is `python` or the `py` launcher. Worse, a pip install
 * that warns its `Scripts` directory is not on PATH means console entry points
 * like `uvicorn` and `pytest` are NOT callable by name even though the packages
 * are installed. So the interpreter is PROBED rather than assumed, and every
 * Python tool is invoked as `<interpreter> -m <module>`, which needs nothing on
 * PATH but the interpreter.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface Command {
  command: string
  args: string[]
}

export class ToolNotFoundError extends Error {}

/**
 * A locally installed Node CLI, launched through Node rather than through its
 * shim. Reads the package's own `bin` field, so it does not hardcode a path that
 * a version bump could move.
 */
export function nodeCli(packageName: string, args: string[], root = REPO_ROOT): Command {
  const manifestPath = resolve(root, 'node_modules', packageName, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new ToolNotFoundError(
      `${packageName} is not installed in ${root}. Run npm install first.`,
    )
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const bin = manifest.bin
  const relative = typeof bin === 'string' ? bin : bin?.[packageName]
  if (relative === undefined) {
    throw new ToolNotFoundError(
      `${packageName} declares no bin entry called ${packageName}, so there is nothing to run.`,
    )
  }
  const entry = resolve(root, 'node_modules', packageName, relative)
  if (!existsSync(entry)) {
    throw new ToolNotFoundError(`${packageName}'s bin entry ${entry} does not exist.`)
  }
  // process.execPath is the Node binary running this script, so the child runs
  // on the same Node the parent did. No PATH lookup, no shim, no shell.
  return { command: process.execPath, args: [entry, ...args] }
}

/**
 * Interpreter names to try, in order, per platform.
 *
 * Windows first tries the `py` launcher, which pythoncore installs into System32
 * and which is therefore on PATH even when the Python directory itself is not.
 * `-3` pins it to Python 3 on a machine that also has 2.x.
 */
export function pythonCandidates(platform: NodeJS.Platform = process.platform): string[][] {
  return platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']]
}

/** Probes an interpreter and reports its version, or null when it will not run. */
export function probePython(candidate: string[]): string | null {
  const [command, ...prefix] = candidate
  if (command === undefined) return null
  const result = spawnSync(
    command,
    [...prefix, '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.error !== undefined || result.status !== 0) return null
  const version = (result.stdout ?? '').trim()
  return version.startsWith('3.') ? version : null
}

let cached: { command: Command; version: string } | null = null

export interface PythonOptions {
  /** Overrides the probe entirely. Set FC_AI_PYTHON to a full interpreter path. */
  override?: string | undefined
  platform?: NodeJS.Platform
}

/**
 * The Python 3 interpreter to use, found by trying each candidate for real.
 *
 * Throws with every name it tried rather than letting a spawn fail with ENOENT,
 * which on Windows says nothing about which of the three names was missing.
 */
export function pythonCommand(options: PythonOptions = {}): Command {
  const override = options.override ?? process.env.FC_AI_PYTHON
  if (override !== undefined && override !== '') {
    const version = probePython([override])
    if (version === null) {
      throw new ToolNotFoundError(
        `FC_AI_PYTHON is set to ${override}, but that did not run as Python 3.`,
      )
    }
    // Cached like any other, so pythonVersion() reports it rather than "unknown".
    // Found by forcing this path with a stand in interpreter, not by reading it.
    const command = { command: override, args: [] }
    cached = { command, version }
    return command
  }
  if (cached !== null) return cached.command

  const tried: string[] = []
  for (const candidate of pythonCandidates(options.platform)) {
    const version = probePython(candidate)
    tried.push(candidate.join(' '))
    if (version !== null) {
      const command = { command: candidate[0] as string, args: candidate.slice(1) }
      cached = { command, version }
      return command
    }
  }
  throw new ToolNotFoundError(
    `No Python 3 interpreter found. Tried: ${tried.join(', ')}. Install Python 3, or ` +
      `set FC_AI_PYTHON to the full path of python.exe.`,
  )
}

/** The version string of the interpreter `pythonCommand` settled on. */
export function pythonVersion(): string | null {
  return cached?.version ?? null
}

/**
 * `<interpreter> -m <module> <args>`.
 *
 * ALWAYS `-m`, never the console script. `pip install` prints a warning when its
 * `Scripts` directory is not on PATH, and on that machine `uvicorn` and `pytest`
 * are not callable by name even though both are installed. `-m` needs nothing on
 * PATH except the interpreter itself.
 */
export function pythonModule(module: string, args: string[] = [], options: PythonOptions = {}): Command {
  const python = pythonCommand(options)
  return { command: python.command, args: [...python.args, '-m', module, ...args] }
}

/** True when the interpreter can import the module. */
export function pythonModuleInstalled(module: string, options: PythonOptions = {}): boolean {
  const python = pythonCommand(options)
  const result = spawnSync(
    python.command,
    [...python.args, '-c', `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec("${module}") else 1)`],
    { encoding: 'utf8', windowsHide: true },
  )
  return result.error === undefined && result.status === 0
}

/** For error messages: how the command would look if typed. */
export function describeCommand(command: Command): string {
  return [command.command, ...command.args].join(' ')
}
