/**
 * What may be fed to an SBC, and what may not. Brief 7.1.
 *
 * Two different kinds of unusable, kept apart on purpose:
 *
 *   ineligible   the GAME will not accept it. Loans, and anything sitting in an
 *                active squad. Not a preference and not negotiable.
 *   protected    the game would accept it but I do not want to lose it. Locked,
 *                manually excluded, or caught by an auto lock rule.
 *
 * The distinction matters when a solve fails. Relaxing a protection is a real
 * option to offer. Relaxing an eligibility rule is not an option at all, it just
 * produces a squad the game rejects.
 *
 * Exclusions are NEVER relaxed automatically. A failed solve reports whether
 * relaxing would fix it and leaves the decision alone.
 */

import type { OwnedCard, ResolvedCard } from '../types/cards'

export type ExclusionReason =
  | 'loan'
  | 'in_active_squad'
  | 'locked'
  | 'manually_excluded'
  | 'auto_locked_rating'
  | 'auto_locked_value'
  | 'auto_locked_promo'
  | 'auto_locked_favourite'

const INELIGIBLE: ReadonlySet<ExclusionReason> = new Set(['loan', 'in_active_squad'])

export function isIneligible(reason: ExclusionReason): boolean {
  return INELIGIBLE.has(reason)
}

export interface AutoLockRules {
  /** Lock anything rated above this. Null disables. */
  aboveRating: number | null
  /** Lock anything valued above this many coins. Null disables. */
  aboveValue: number | null
  /** Lock anything carrying a promo treatment. */
  promoCards: boolean
  /** Lock anything flagged a favourite. */
  favourites: boolean
}

export const DEFAULT_AUTO_LOCK: AutoLockRules = {
  aboveRating: 86,
  aboveValue: null,
  promoCards: true,
  favourites: true,
}

export interface ExclusionSettings {
  /** Defaults to true, as the brief requires. */
  excludeActiveSquads: boolean
  autoLock: AutoLockRules
  /** OwnedCard ids I have excluded by hand. */
  manualExclusions: ReadonlySet<string>
}

export const DEFAULT_EXCLUSION_SETTINGS: ExclusionSettings = {
  excludeActiveSquads: true,
  autoLock: DEFAULT_AUTO_LOCK,
  manualExclusions: new Set(),
}

export interface ExcludedCard {
  card: ResolvedCard
  reasons: ExclusionReason[]
}

export interface AvailabilityReport {
  available: ResolvedCard[]
  excluded: ExcludedCard[]
  totalCards: number
  availableCards: number
  /** Reason to how many cards it caught. A card can appear under several. */
  countsByReason: Record<ExclusionReason, number>
  /**
   * Cards held back only by protections, which relaxing would return. Never
   * includes anything the game itself rejects.
   */
  releasableByRelaxing: number
}

function priceOf(owned: OwnedCard): number | null {
  return owned.estimatedPrice
}

export function reasonsFor(card: ResolvedCard, settings: ExclusionSettings): ExclusionReason[] {
  const reasons: ExclusionReason[] = []
  const { owned, definition } = card

  // Eligibility. The game decides these and no setting can override them.
  if (owned.isLoan) reasons.push('loan')
  if (settings.excludeActiveSquads && owned.inActiveSquad) reasons.push('in_active_squad')

  // Protection. Mine to relax.
  if (owned.locked) reasons.push('locked')
  if (settings.manualExclusions.has(owned.id)) reasons.push('manually_excluded')

  const rules = settings.autoLock
  if (rules.aboveRating !== null && definition.rating > rules.aboveRating) {
    reasons.push('auto_locked_rating')
  }
  const price = priceOf(owned)
  if (rules.aboveValue !== null && price !== null && price > rules.aboveValue) {
    reasons.push('auto_locked_value')
  }
  if (rules.promoCards && definition.promoName !== undefined) reasons.push('auto_locked_promo')
  if (rules.favourites && owned.favourite === true) reasons.push('auto_locked_favourite')

  return reasons
}

const ALL_REASONS: ExclusionReason[] = [
  'loan',
  'in_active_squad',
  'locked',
  'manually_excluded',
  'auto_locked_rating',
  'auto_locked_value',
  'auto_locked_promo',
  'auto_locked_favourite',
]

export function assessAvailability(
  cards: readonly ResolvedCard[],
  settings: ExclusionSettings = DEFAULT_EXCLUSION_SETTINGS,
): AvailabilityReport {
  const available: ResolvedCard[] = []
  const excluded: ExcludedCard[] = []
  const countsByReason = Object.fromEntries(ALL_REASONS.map((r) => [r, 0])) as Record<
    ExclusionReason,
    number
  >
  let releasableByRelaxing = 0

  for (const card of cards) {
    const reasons = reasonsFor(card, settings)
    if (reasons.length === 0) {
      available.push(card)
      continue
    }
    excluded.push({ card, reasons })
    for (const reason of reasons) countsByReason[reason] += 1
    if (!reasons.some(isIneligible)) releasableByRelaxing += 1
  }

  return {
    available,
    excluded,
    totalCards: cards.length,
    availableCards: available.length,
    countsByReason,
    releasableByRelaxing,
  }
}

const REASON_LABELS: Record<ExclusionReason, string> = {
  loan: 'loans',
  in_active_squad: 'in active squads',
  locked: 'locked',
  manually_excluded: 'manually excluded',
  auto_locked_rating: 'auto locked on rating',
  auto_locked_value: 'auto locked on value',
  auto_locked_promo: 'auto locked as promo cards',
  auto_locked_favourite: 'auto locked as favourites',
}

/** The solve screen line from brief 7.1. */
export function formatAvailability(report: AvailabilityReport): string {
  const excludedCount = report.totalCards - report.availableCards
  const head = `${report.availableCards} of ${report.totalCards} cards available.`
  if (excludedCount === 0) return head

  // A card can trip several rules. Counting each reason separately is the honest
  // reading, so the parts can add up to more than the whole and the line says so.
  const parts = ALL_REASONS.filter((reason) => report.countsByReason[reason] > 0).map(
    (reason) => `${report.countsByReason[reason]} ${REASON_LABELS[reason]}`,
  )
  return `${head} ${excludedCount} excluded: ${parts.join(', ')}.`
}

/**
 * What relaxing would buy, for a failed solve. Reports and does not act.
 *
 * Eligibility is never offered, because relaxing it produces a squad the game
 * rejects, which is worse than no squad at all.
 */
export function relaxationOffer(report: AvailabilityReport): string | null {
  if (report.releasableByRelaxing === 0) return null
  return (
    `Relaxing exclusions would return ${report.releasableByRelaxing} more card(s) to the pool. ` +
    `Loans and cards in active squads are not included, because the game rejects those ` +
    `whatever this tool does.`
  )
}
