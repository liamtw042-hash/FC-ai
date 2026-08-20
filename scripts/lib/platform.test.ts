/**
 * Windows compatibility, asserted rather than assumed.
 *
 * Everything here runs on POSIX and on Windows. The platform specific parts are
 * pure functions taking the platform as an argument, so the Windows branch is
 * exercised on this machine rather than hoped for.
 *
 * The last two suites are the ones that matter: they scan the source for the
 * mistake rather than testing the one place it was fixed. `spawn('npx')` was one
 * instance of a class, and the class is "spawning something that is a shim on
 * Windows".
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  REPO_ROOT,
  ToolNotFoundError,
  describeCommand,
  nodeCli,
  probePython,
  pythonCandidates,
  pythonCommand,
  pythonModule,
  pythonModuleInstalled,
  pythonVersion,
} from './platform.ts'

describe('nodeCli', () => {
  // The fix for spawn ENOENT. `npx`, `tsx` and `next` are all .cmd shims on
  // Windows and a .cmd is not an executable, so the shim is never spawned.
  it('runs Node itself, never a shim', () => {
    const command = nodeCli('tsx', ['--version'])
    expect(command.command).toBe(process.execPath)
    expect(command.command).not.toMatch(/npx/)
    expect(command.command.endsWith('.cmd')).toBe(false)
  })

  it('points at a file that exists on disk', () => {
    for (const packageName of ['tsx', 'next']) {
      const command = nodeCli(packageName, [])
      expect(existsSync(command.args[0] as string), `${packageName} entry`).toBe(true)
    }
  })

  it('reads the bin field rather than hardcoding a path a version bump could move', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'node_modules', 'next', 'package.json'), 'utf8'),
    ) as { bin: Record<string, string> }
    const command = nodeCli('next', [])
    expect(command.args[0]).toBe(
      resolve(REPO_ROOT, 'node_modules', 'next', manifest.bin.next as string),
    )
  })

  it('passes arguments through after the entry point', () => {
    expect(nodeCli('tsx', ['a', 'b']).args.slice(1)).toEqual(['a', 'b'])
  })

  it('actually runs, which is the only claim that matters', () => {
    const command = nodeCli('tsx', ['--version'])
    const result = spawnSync(command.command, command.args, { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('tsx')
  })

  it('says what to do when the package is not installed', () => {
    expect(() => nodeCli('not-a-real-package', [])).toThrow(ToolNotFoundError)
    expect(() => nodeCli('not-a-real-package', [])).toThrow(/npm install/)
  })
})

describe('pythonCandidates, both platforms, from this one', () => {
  // python3 is the normal name on POSIX and usually absent on Windows.
  it('on Windows tries the py launcher first', () => {
    const candidates = pythonCandidates('win32')
    expect(candidates[0]).toEqual(['py', '-3'])
    expect(candidates.map((candidate) => candidate[0])).toContain('python')
  })

  it('on Windows never depends on python3 being the only name', () => {
    const candidates = pythonCandidates('win32')
    expect(candidates[0]?.[0]).not.toBe('python3')
    expect(candidates.length).toBeGreaterThan(1)
  })

  it('on POSIX prefers python3', () => {
    expect(pythonCandidates('linux')[0]).toEqual(['python3'])
    expect(pythonCandidates('darwin')[0]).toEqual(['python3'])
  })

  it('the py launcher is pinned to 3, on a machine that may also have 2', () => {
    expect(pythonCandidates('win32')[0]).toContain('-3')
  })
})

describe('probePython', () => {
  it('finds the interpreter this machine has', () => {
    const version = pythonCandidates()
      .map((candidate) => probePython(candidate))
      .find((result) => result !== null)
    expect(version).toMatch(/^3\./)
  })

  it('returns null for a name that is not there, rather than throwing', () => {
    expect(probePython(['definitely-not-an-interpreter'])).toBeNull()
  })

  it('returns null for something that runs but is not Python 3', () => {
    // `node -c ...` exits non zero, which is the same shape as a missing binary.
    expect(probePython([process.execPath])).toBeNull()
  })
})

describe('pythonModule', () => {
  /**
   * pip warns when its Scripts directory is not on PATH, and on that machine
   * `uvicorn` and `pytest` are not callable by name even though both are
   * installed. `-m` needs nothing on PATH but the interpreter.
   */
  it('always goes through -m, never a console script name', () => {
    const command = pythonModule('uvicorn', ['--version'])
    expect(command.args).toContain('-m')
    expect(command.args[command.args.indexOf('-m') + 1]).toBe('uvicorn')
    expect(command.command).not.toContain('uvicorn')
  })

  it('puts the module before its arguments', () => {
    const command = pythonModule('pytest', ['tests', '-q'])
    const at = command.args.indexOf('-m')
    expect(command.args.slice(at)).toEqual(['-m', 'pytest', 'tests', '-q'])
  })

  it('runs, on this machine', () => {
    const command = pythonModule('uvicorn', ['--version'])
    const result = spawnSync(command.command, command.args, { encoding: 'utf8' })
    expect(result.status).toBe(0)
  })
})

describe('pythonModuleInstalled', () => {
  it('is true for something installed and false for something invented', () => {
    expect(pythonModuleInstalled('uvicorn')).toBe(true)
    expect(pythonModuleInstalled('definitely_not_a_module')).toBe(false)
  })
})

describe('FC_AI_PYTHON', () => {
  it('is refused when it does not run as Python 3, rather than failing later', () => {
    expect(() => pythonCommand({ override: process.execPath })).toThrow(ToolNotFoundError)
    expect(() => pythonCommand({ override: process.execPath })).toThrow(/did not run as Python 3/)
  })

  it('is accepted when it does', () => {
    const found = pythonCommand()
    const command = pythonCommand({ override: found.command })
    expect(command.command).toBe(found.command)
  })

  it('reports the version of the override, not "unknown"', () => {
    // Found by forcing the override path and reading the sentence that came out:
    // it said "Python unknown was found at ...", because the override returned
    // early without caching what the probe had already measured.
    pythonCommand({ override: pythonCommand().command })
    expect(pythonVersion()).toMatch(/^3\./)
  })
})

// ---------------------------------------------------------------------------
// The regression guards. These scan the source rather than the fix.
// ---------------------------------------------------------------------------

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', 'data'])

/**
 * Comments removed, so the guards below scan CODE.
 *
 * The first version of them fired on this repository's own comments, which
 * explain the bug by quoting it. A guard that makes you write worse comments to
 * stay green is a guard that gets deleted, so it strips instead.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (SKIP.has(name)) continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (['.ts', '.tsx', '.mjs'].includes(extname(path))) found.push(path)
  }
  return found
}

describe('no spawn site reintroduces the Windows bug', () => {
  const files = sourceFiles(REPO_ROOT).filter((path) => !path.endsWith('platform.test.ts'))

  it('scans a meaningful number of files, so a broken walk cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('nothing spawns a name that is a .cmd shim on Windows', () => {
    // `npx`, `tsx` and `next` all ship as .cmd on Windows, and CreateProcess
    // cannot run a .cmd. nodeCli exists so none of these appear as a spawn target.
    const offences: string[] = []
    for (const path of files) {
      const text = codeOnly(readFileSync(path, 'utf8'))
      for (const match of text.matchAll(/spawn(?:Sync)?\(\s*['"`]([^'"`]+)['"`]/g)) {
        const target = match[1] ?? ''
        if (['npx', 'tsx', 'next', 'npm', 'yarn', 'pnpm'].includes(target)) {
          offences.push(`${path.slice(REPO_ROOT.length + 1)} spawns ${target}`)
        }
      }
    }
    expect(offences).toEqual([])
  })

  it('nothing spawns python3, pip, uvicorn or pytest by name', () => {
    // python3 is usually absent on Windows, and uvicorn and pytest live in the
    // Scripts directory that pip warns may not be on PATH.
    const offences: string[] = []
    for (const path of files) {
      const text = codeOnly(readFileSync(path, 'utf8'))
      for (const match of text.matchAll(/spawn(?:Sync)?\(\s*['"`]([^'"`]+)['"`]/g)) {
        const target = match[1] ?? ''
        if (['python3', 'python', 'pip', 'pip3', 'uvicorn', 'pytest'].includes(target)) {
          offences.push(`${path.slice(REPO_ROOT.length + 1)} spawns ${target}`)
        }
      }
    }
    expect(offences).toEqual([])
  })

  it('nothing reaches for shell: true, which is the tempting wrong fix', () => {
    // It fixes the .cmd problem and hands every argument to cmd.exe to re-parse,
    // so a path with a space or an & becomes a quoting bug.
    const offences = files.filter((path) => /shell:\s*true/.test(codeOnly(readFileSync(path, 'utf8'))))
    expect(offences.map((path) => path.slice(REPO_ROOT.length + 1))).toEqual([])
  })

  it('would actually catch an offending line', () => {
    const sample = "const r = spawnSync('npx', ['tsx', 'x.ts'])"
    const targets = [...sample.matchAll(/spawn(?:Sync)?\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
    expect(targets).toEqual(['npx'])
  })
})

describe('the npm scripts do not hardcode a POSIX only interpreter', () => {
  const scripts = (
    JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
  ).scripts

  it('no script calls python3, or pip as a bare command', () => {
    // `-m pip` is the portable form and is fine. A bare `pip` is not: it lives in
    // the Scripts directory pip itself warns may not be on PATH.
    const offenders = Object.entries(scripts).filter(
      ([, body]) => /(^|\s)python3(\s|$)/.test(body) || /(^|\s)pip3?(\s|$)/.test(body.replace(/-m\s+pip3?/g, '')),
    )
    expect(offenders.map(([name]) => name)).toEqual([])
  })

  it('and that check would catch a bare pip', () => {
    const bare = 'pip install -r solver/requirements.txt'
    expect(/(^|\s)pip3?(\s|$)/.test(bare.replace(/-m\s+pip3?/g, ''))).toBe(true)
  })

  it('every Python script goes through the runner', () => {
    for (const [name, body] of Object.entries(scripts)) {
      if (!name.startsWith('solver:')) continue
      expect(body, name).toContain('scripts/python.ts')
    }
  })

  it('describeCommand renders something a person could paste', () => {
    expect(describeCommand({ command: 'py', args: ['-3', '-m', 'pytest'] })).toBe(
      'py -3 -m pytest',
    )
  })
})
