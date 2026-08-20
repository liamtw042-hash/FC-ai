/**
 * Section 1.2, as a test rather than as a promise.
 *
 * The brief's hard line is that this tool never talks to EA: no web app
 * automation, no extension, no calls to EA endpoints, no session or cookie
 * capture, no credential handling, no request replay, no auto pack opening, no
 * auto squad submission. That is the architecture, not a setting.
 *
 * RESEARCH.md 5.7 offered a CI guard for it. This is that guard. It walks every
 * source file in the repository and fails if an EA or fan site hostname appears
 * anywhere it could become a request. A prose mention is fine: the check ignores
 * documentation and looks at code.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', 'data'])
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.json'])

/**
 * Hostnames, not words. "ea" appears inside "each" and "league", and a check that
 * cannot tell those apart gets disabled the first time it cries wolf.
 */
const FORBIDDEN = [
  /\bea\.com\b/i,
  /\beasports\.com\b/i,
  /\bea\.[a-z]{2,}\/?ut\b/i,
  /\butas\.\w+\.fut\.ea/i,
  /\bfutbin\.com\b/i,
  /\bfut\.gg\b/i,
  /\bfutwiz\.com\b/i,
  /\baccounts\.ea\b/i,
  /\bwww\.easports\b/i,
]

function walk(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(name)) continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path, found)
    else if (CODE.has(extname(path))) found.push(path)
  }
  return found
}

describe('section 1.2, and it is not negotiable', () => {
  it('no source file anywhere in the repository names an EA or fan site host', () => {
    const offences: string[] = []
    for (const path of walk(ROOT)) {
      // The two guards list the strings they are looking for, so neither can
      // check itself. They cover different trees: this one walks the whole
      // repository, the Python one walks solver/fc_ai_solver.
      if (path.endsWith('section12.test.ts') || path.endsWith('test_api.py')) continue
      const text = readFileSync(path, 'utf8')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offences.push(`${path.slice(ROOT.length + 1)} matches ${String(pattern)}`)
      }
    }
    expect(offences).toEqual([])
  })

  it('checks a meaningful number of files, so a broken walk cannot pass silently', () => {
    // A guard that quietly stops looking is worse than no guard.
    expect(walk(ROOT).length).toBeGreaterThan(40)
  })

  it('would actually catch an offending string', () => {
    expect(FORBIDDEN.some((pattern) => pattern.test('fetch("https://utas.mob.v1.fut.ea.com")'))).toBe(
      true,
    )
    expect(FORBIDDEN.some((pattern) => pattern.test('const leagues = each(team)'))).toBe(false)
  })
})
