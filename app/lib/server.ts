/**
 * The only place the pages reach the club, the solver or the rules engine.
 *
 * ONE IMPLEMENTATION, TWO FRONT ENDS. The command line and this app read the same
 * `data/club/state.json`, build their pool with the same `buildPool`, and post to
 * the same solver endpoints. Nothing in `app/` re-implements a rule, a cost or a
 * requirement: if a page needs something the engine does not expose, the engine
 * grows a function and the page calls it.
 */

import 'server-only'

import { resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { buildPool, resolveClub, supplyAndPrices } from '../../src/cli/pool'
import { loadState, saveState, type ClubState } from '../../src/cli/state'
import { listSbcs, loadSbc, saveSbc, slug, type SbcDefinition } from '../../src/cli/sbc'
import { SolverClient } from '../../src/cli/solverClient'
import { EMPTY_HISTORY, type History } from '../../src/data/history'
import { collectUnverified, liveItems } from '../../src/rules/verification'
import { defaultCardTypeRegistry } from '../../src/rules/cardTypes'

export const ROOT = resolve(process.cwd())

export function state(): ClubState {
  return loadState(ROOT)
}

export function persist(next: ClubState): void {
  saveState(ROOT, next)
}

export function sbcs(): SbcDefinition[] {
  return listSbcs(ROOT)
}

export function sbc(name: string): SbcDefinition | null {
  return loadSbc(ROOT, name)
}

export function storeSbc(definition: SbcDefinition): string {
  return saveSbc(ROOT, definition)
}

export function solver(): SolverClient {
  // No timeout. A ten squad solve runs for minutes and that is not a fault.
  return new SolverClient(process.env.FC_AI_SOLVER_URL ?? undefined, 0)
}

export { buildPool, resolveClub, supplyAndPrices, slug }
export type { ClubState, SbcDefinition }

function historyPath(): string {
  return resolve(ROOT, 'data', 'club', 'history.json')
}

export function history(): History {
  const path = historyPath()
  if (!existsSync(path)) return EMPTY_HISTORY
  return JSON.parse(readFileSync(path, 'utf8')) as History
}

export function saveHistory(next: History): void {
  const path = historyPath()
  mkdirSync(resolve(ROOT, 'data', 'club'), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n')
}

/**
 * Rule values this build has not verified against the game, for the banner that
 * every page carries. Not a footnote: a wrong value here changes returned squads
 * and no test can catch it.
 */
export function unverified(): { what: string; basis: string; pendingRef: string | null }[] {
  return liveItems(collectUnverified(defaultCardTypeRegistry)).map((item) => ({
    what: item.what,
    basis: item.basis,
    pendingRef: item.pendingRef,
  }))
}
