/**
 * Where the CLI keeps what it has imported.
 *
 * Under `data/club/`, which is gitignored, because a club export names every
 * card somebody owns and that is theirs, not the repository's. The sample data
 * under `data/sample/` is the opposite: invented, committed, and safe to read in
 * a test.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CardDefinition, OwnedCard } from '../types/cards'

export interface ClubState {
  cards: CardDefinition[]
  club: OwnedCard[]
  /** Rating to coins. The price by rating table of RESEARCH.md 8.1. */
  prices: Record<number, number>
  cardsImportedFrom: string | null
  clubImportedFrom: string | null
  pricesImportedFrom: string | null
}

export const EMPTY_STATE: ClubState = {
  cards: [],
  club: [],
  prices: {},
  cardsImportedFrom: null,
  clubImportedFrom: null,
  pricesImportedFrom: null,
}

export function statePath(root: string): string {
  return resolve(root, 'data', 'club', 'state.json')
}

export function loadState(root: string): ClubState {
  const path = statePath(root)
  if (!existsSync(path)) return { ...EMPTY_STATE }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ClubState>
  return { ...EMPTY_STATE, ...parsed }
}

export function saveState(root: string, state: ClubState): void {
  const path = statePath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n')
}
