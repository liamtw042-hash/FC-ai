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
 *
 * WHAT COUNTS AS AN ITEM, which is the part that has to be trustworthy.
 *
 * An item is an unverified RULE VALUE: a threshold step, a card type's
 * contribution weights, the rating formula's last step, the formation slot labels.
 * A pending ground truth fixture is NOT an item. A fixture is the INSTRUMENT that
 * would clear one or more rule values, so listing it alongside them counts the
 * same uncertainty twice.
 *
 * That was a real defect. gt-001 and rule fact rating:step5_floor are one
 * uncertainty and both cleared by P-001; gt-002 and gt-003 sit on top of four club
 * and league steps, all cleared by P-005. Counting them separately inflated the
 * live count from 11 to 15. Fixtures are now reported as queued readings, grouped
 * by the PENDING entry they belong to, and never as risks.
 */

import type { CardTypeRegistry } from './cardTypes'
import type { GroundTruthFixture } from '../types/squad'
import { unverifiedRuleFacts, type RuleFactKind } from './ruleFacts'

export type VerificationTier = 'live' | 'unobservable'

export interface UnverifiedItem {
  /** Stable id, so a report can be diffed run to run. */
  id: string
  kind: RuleFactKind | 'card_type' | 'ground_truth_fixture'
  tier: VerificationTier
  what: string
  basis: string
  /** PENDING.md entry that would clear it, when one exists and can exist. */
  pendingRef: string | null
}

/**
 * THE TIER CRITERION, in one function.
 *
 * Live means a wrong value could change a returned squad. It is NOT "a reading is
 * queued for it". A rule with no queued reading is still live if getting it wrong
 * would change a squad; a rule with an obvious reading is still unobservable if
 * nothing downstream can see it.
 *
 * For threshold steps `observable` is measured rather than declared. See
 * observability.test.ts, which perturbs each step and checks whether any squad's
 * chemistry actually moves.
 */
export function tierFor(couldChangeAReturnedSquad: boolean): VerificationTier {
  return couldChangeAReturnedSquad ? 'live' : 'unobservable'
}

export function collectUnverified(registry: CardTypeRegistry): UnverifiedItem[] {
  const items: UnverifiedItem[] = []

  for (const fact of unverifiedRuleFacts()) {
    items.push({
      id: fact.id,
      kind: fact.kind,
      tier: tierFor(fact.observable),
      what: fact.what,
      basis: `${fact.source} ${fact.reason}`,
      pendingRef: fact.pendingRef,
    })
  }

  for (const type of registry.unverified()) {
    items.push({
      id: `card_type:${type.id}`,
      kind: 'card_type',
      // A contribution weight feeds every threshold count, so a wrong one moves
      // real squads. Always live.
      tier: tierFor(true),
      what: `${type.displayName} chemistry contribution`,
      basis: type.source,
      pendingRef: type.pendingRef ?? null,
    })
  }

  return items.sort((a, b) => a.id.localeCompare(b.id))
}

/** A reading that would clear one or more rule values. An instrument, not a risk. */
export interface QueuedReading {
  fixtureId: string
  pendingRef: string | null
  /** Rule value ids this reading would clear. */
  clears: string[]
}

export function queuedReadings(
  fixtures: readonly GroundTruthFixture[],
  items: readonly UnverifiedItem[],
): QueuedReading[] {
  return fixtures
    .filter((fixture) => fixture.pending_verification === true)
    .map((fixture) => ({
      fixtureId: fixture.id,
      pendingRef: fixture.pendingRef ?? null,
      clears: items
        .filter((item) => item.pendingRef !== null && item.pendingRef === fixture.pendingRef)
        .map((item) => item.id),
    }))
}

export function liveItems(items: readonly UnverifiedItem[]): UnverifiedItem[] {
  return items.filter((item) => item.tier === 'live')
}

export function unobservableItems(items: readonly UnverifiedItem[]): UnverifiedItem[] {
  return items.filter((item) => item.tier === 'unobservable')
}

export function formatStartupWarning(
  items: readonly UnverifiedItem[],
  readings: readonly QueuedReading[] = [],
): string {
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

  if (readings.length > 0) {
    lines.push('')
    lines.push(
      `${readings.length} reading(s) queued in PENDING.md. These are instruments, not extra`,
    )
    lines.push('risks: each one clears rule values already counted above.')
    lines.push('')
    for (const reading of readings) {
      const ref = reading.pendingRef === null ? 'no PENDING entry' : reading.pendingRef
      const clears = reading.clears.length === 0 ? 'nothing currently listed' : reading.clears.join(', ')
      lines.push(`  ${reading.fixtureId} (${ref}) clears: ${clears}`)
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
