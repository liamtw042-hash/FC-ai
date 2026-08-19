/**
 * What we know versus what we have merely inferred.
 *
 * Tests prove the code matches the spec. They do not prove the spec matches the
 * game. Everything here exists to keep that distinction visible instead of
 * letting a wall of green ticks imply the rules are confirmed.
 *
 * TWO TIERS, and the distinction matters more than it looks.
 *
 *   live         unverified AND capable of changing a solution
 *   unobservable unverified AND incapable of changing anything
 *
 * Only the live tier gets "solutions may be wrong". A warning that lumps the two
 * together trains the reader to skim past it, and then the live items get skimmed
 * past too. The unobservable tier is still printed, because knowing a rule cannot
 * be checked is worth knowing, but it is printed as a footnote and never as a risk.
 */

import type { CardTypeRegistry } from './cardTypes'
import type { GroundTruthFixture } from '../types/squad'
import { FORMATIONS_SOURCE, FORMATIONS_VERIFIED } from './formations'

export type VerificationTier = 'live' | 'unobservable'

export interface UnverifiedItem {
  /** Stable id, so a report can be diffed run to run. */
  id: string
  kind: 'card_type' | 'ground_truth_fixture' | 'formation_table' | 'threshold_step'
  tier: VerificationTier
  what: string
  basis: string
  /** PENDING.md entry that would clear it, when one exists and can exist. */
  pendingRef: string | null
}

/**
 * Rule steps that are unverified and can never be verified, because they have no
 * observable consequence. Listing them is how we avoid quietly forgetting that
 * they were never checked, without pretending they are a risk.
 */
export const UNOBSERVABLE_RULE_STEPS: UnverifiedItem[] = [
  {
    id: 'threshold:club_plus_3_at_7',
    kind: 'threshold_step',
    tier: 'unobservable',
    what: 'Club +3 at 7 clubmates',
    basis:
      'Inert, not merely unverified. Clubmates are always league mates, so by four ' +
      'clubmates a player already holds club +2 plus league +1, which is the 3 point ' +
      'cap. Every group of four or more reads 3 whatever this step does, so it cannot ' +
      'change any chemistry total and therefore cannot change any solution.',
    pendingRef: null,
  },
]

export function collectUnverified(
  registry: CardTypeRegistry,
  fixtures: readonly GroundTruthFixture[] = [],
): UnverifiedItem[] {
  const items: UnverifiedItem[] = [...UNOBSERVABLE_RULE_STEPS]

  if (!FORMATIONS_VERIFIED) {
    items.push({
      id: 'formations:slot_labels',
      kind: 'formation_table',
      tier: 'live',
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
      tier: 'live',
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
      tier: 'live',
      what: `${fixture.id}, expects rating ${fixture.displayedRating}`,
      basis: fixture.source,
      pendingRef: fixture.pendingRef ?? null,
    })
  }

  return items.sort((a, b) => a.id.localeCompare(b.id))
}

export function liveItems(items: readonly UnverifiedItem[]): UnverifiedItem[] {
  return items.filter((item) => item.tier === 'live')
}

export function unobservableItems(items: readonly UnverifiedItem[]): UnverifiedItem[] {
  return items.filter((item) => item.tier === 'unobservable')
}

export function formatStartupWarning(items: readonly UnverifiedItem[]): string {
  const live = liveItems(items)
  const unobservable = unobservableItems(items)
  const lines: string[] = []

  if (live.length === 0) {
    lines.push('All game rules that can affect a solution are verified against observed readings.')
  } else {
    lines.push(`UNVERIFIED AND LIVE (${live.length}). These are inferred, not observed, and`)
    lines.push('solutions relying on them may be wrong in ways the tests cannot catch.')
    lines.push('')
    for (const item of live) {
      lines.push(`  ${item.what}`)
      lines.push(`    basis: ${item.basis}`)
      lines.push(
        `    clear it: ${item.pendingRef === null ? 'no PENDING entry yet' : `PENDING.md ${item.pendingRef}`}`,
      )
      lines.push('')
    }
  }

  if (unobservable.length > 0) {
    lines.push('')
    lines.push(`Unverified but unobservable (${unobservable.length}). Recorded so they are not`)
    lines.push('forgotten. No reading can check them and no solution can depend on them.')
    lines.push('')
    for (const item of unobservable) {
      lines.push(`  ${item.what}`)
      lines.push(`    ${item.basis}`)
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd()
}
