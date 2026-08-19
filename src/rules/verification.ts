/**
 * What we know versus what we have merely inferred.
 *
 * Tests prove the code matches the spec. They do not prove the spec matches the
 * game. Everything in this module exists to keep that distinction visible instead
 * of letting a wall of green ticks imply the rules are confirmed.
 *
 * Anything inferred is marked verified false at its source, collected here, and
 * printed at startup with the PENDING.md entry that would settle it.
 */

import type { CardTypeRegistry } from './cardTypes'
import type { GroundTruthFixture } from '../types/squad'
import { FORMATIONS_SOURCE, FORMATIONS_VERIFIED } from './formations'

export interface UnverifiedItem {
  /** Stable id, so a report can be diffed run to run. */
  id: string
  kind: 'card_type' | 'ground_truth_fixture' | 'formation_table'
  what: string
  basis: string
  /** PENDING.md entry that would clear it, when there is one. */
  pendingRef: string | null
}

export function collectUnverified(
  registry: CardTypeRegistry,
  fixtures: readonly GroundTruthFixture[] = [],
): UnverifiedItem[] {
  const items: UnverifiedItem[] = []

  if (!FORMATIONS_VERIFIED) {
    items.push({
      id: 'formations:slot_labels',
      kind: 'formation_table',
      what: 'Formation slot labels',
      basis:
        FORMATIONS_SOURCE +
        ' A slot labelled CDM here that the game calls CM would silently zero a ' +
        "player's chemistry.",
      pendingRef: 'P-004',
    })
  }

  for (const type of registry.unverified()) {
    items.push({
      id: `card_type:${type.id}`,
      kind: 'card_type',
      what: `${type.displayName} chemistry contribution`,
      basis: type.source,
      pendingRef: type.pendingRef ?? null,
    })
  }

  for (const fixture of fixtures) {
    if (fixture.pending_verification !== true) continue
    items.push({
      id: `fixture:${fixture.id}`,
      kind: 'ground_truth_fixture',
      what: `${fixture.id}, expects rating ${fixture.displayedRating}`,
      basis: fixture.source,
      pendingRef: fixture.pendingRef ?? null,
    })
  }

  return items.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * The startup warning.
 *
 * Deliberately loud and deliberately unconditional. If this list is empty the
 * banner says so, which is itself information worth seeing.
 */
export function formatStartupWarning(items: readonly UnverifiedItem[]): string {
  if (items.length === 0) {
    return 'All game rules in use are verified against observed in game readings.'
  }

  const lines = [
    `UNVERIFIED GAME RULES IN USE (${items.length}). These are inferred, not observed.`,
    '',
  ]
  for (const item of items) {
    lines.push(`  ${item.what}`)
    lines.push(`    basis: ${item.basis}`)
    lines.push(`    clear it: ${item.pendingRef === null ? 'no PENDING entry yet' : `PENDING.md ${item.pendingRef}`}`)
    lines.push('')
  }
  lines.push('Solutions relying on these may be wrong in ways the tests cannot catch.')
  return lines.join('\n')
}
