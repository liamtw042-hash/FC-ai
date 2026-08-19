/**
 * Canonical entity resolution for clubs, leagues and nations.
 *
 * Exists because women's items must club link to the men's club. See RESEARCH.md 2.2.
 * If the dataset gives "Arsenal Women" and "Arsenal" as two strings the club link
 * silently breaks, the squad scores lower than the game says, and the solver
 * confidently returns a worse answer. Nothing crashes, which is what makes it
 * dangerous.
 *
 * The league side needs no code at all. Men's and women's competitions are
 * genuinely different leagues, so distinct league strings never match and the
 * "never league" half of the rule falls out of the data model for free.
 */

import type { AliasTable, CardDefinition } from '../types/cards'

export const EMPTY_ALIAS_TABLE: AliasTable = { clubs: {}, leagues: {}, nations: {} }

/** Case and whitespace insensitive, because dataset strings are not consistent. */
function normaliseKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function createAliasTable(table: Partial<AliasTable>): AliasTable {
  const build = (entries: Record<string, string> = {}): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [alias, canonical] of Object.entries(entries)) {
      out[normaliseKey(alias)] = canonical
    }
    return out
  }
  return {
    clubs: build(table.clubs),
    leagues: build(table.leagues),
    nations: build(table.nations),
  }
}

function resolve(
  entries: Record<string, string>,
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  return entries[normaliseKey(trimmed)] ?? trimmed
}

export function resolveClub(table: AliasTable, raw: string | null): string | null {
  return resolve(table.clubs, raw)
}

export function resolveLeague(table: AliasTable, raw: string | null): string | null {
  return resolve(table.leagues, raw)
}

export function resolveNation(table: AliasTable, raw: string | null): string | null {
  return resolve(table.nations, raw)
}

/**
 * Applied once at load, so the rules engine only ever sees canonical values.
 *
 * Resolving inside the solver instead would mean doing it millions of times and
 * would leave two code paths that could disagree.
 */
export function applyAliases(
  definition: CardDefinition,
  table: AliasTable,
): CardDefinition {
  const nation = resolveNation(table, definition.nation)
  return {
    ...definition,
    club: resolveClub(table, definition.club),
    league: resolveLeague(table, definition.league),
    // A nation is never null on a real card, but an empty string in the dataset
    // must not become a shared blank, so it degrades to the original value.
    nation: nation ?? definition.nation,
  }
}
