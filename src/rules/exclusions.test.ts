import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXCLUSION_SETTINGS,
  assessAvailability,
  formatAvailability,
  isIneligible,
  reasonsFor,
  relaxationOffer,
  type ExclusionSettings,
} from './exclusions'
import { resolvedCard } from '../../tests/support/factories'
import type { OwnedCard, ResolvedCard } from '../types/cards'

function card(owned: Partial<OwnedCard> = {}, rating = 80, promoName?: string): ResolvedCard {
  const base = resolvedCard(promoName === undefined ? { rating } : { rating, promoName })
  return { ...base, owned: { ...base.owned, ...owned } }
}

const NO_AUTO_LOCK: ExclusionSettings = {
  ...DEFAULT_EXCLUSION_SETTINGS,
  autoLock: { aboveRating: null, aboveValue: null, promoCards: false, favourites: false },
}

describe('eligibility versus protection', () => {
  // The game decides eligibility. Protection is mine. Only the second is
  // relaxable, and confusing them would offer me a squad the game rejects.
  it('loans and active squad members are ineligible', () => {
    expect(isIneligible('loan')).toBe(true)
    expect(isIneligible('in_active_squad')).toBe(true)
  })

  it('everything else is protection, which is mine to relax', () => {
    for (const reason of [
      'locked',
      'manually_excluded',
      'auto_locked_rating',
      'auto_locked_value',
      'auto_locked_promo',
      'auto_locked_favourite',
    ] as const) {
      expect(isIneligible(reason)).toBe(false)
    }
  })
})

describe('what makes a card unusable', () => {
  it('a loan, always', () => {
    expect(reasonsFor(card({ isLoan: true }), NO_AUTO_LOCK)).toEqual(['loan'])
  })

  it('a card in an active squad, and excludeActiveSquads defaults to true', () => {
    expect(DEFAULT_EXCLUSION_SETTINGS.excludeActiveSquads).toBe(true)
    expect(reasonsFor(card({ inActiveSquad: true }), NO_AUTO_LOCK)).toEqual(['in_active_squad'])
    expect(
      reasonsFor(card({ inActiveSquad: true }), { ...NO_AUTO_LOCK, excludeActiveSquads: false }),
    ).toEqual([])
  })

  it('a locked card, or one I excluded by hand', () => {
    expect(reasonsFor(card({ locked: true }), NO_AUTO_LOCK)).toEqual(['locked'])
    const manual = card({ id: 'keep-me' })
    expect(
      reasonsFor(manual, { ...NO_AUTO_LOCK, manualExclusions: new Set(['keep-me']) }),
    ).toEqual(['manually_excluded'])
  })

  it('untradeable status is not a reason, it only affects cost', () => {
    expect(reasonsFor(card({ untradeable: true }), NO_AUTO_LOCK)).toEqual([])
  })

  it('a card can trip several rules at once and reports all of them', () => {
    const reasons = reasonsFor(card({ isLoan: true, locked: true }), NO_AUTO_LOCK)
    expect(reasons).toEqual(['loan', 'locked'])
  })
})

describe('auto lock rules, so a good card cannot be fed by accident', () => {
  it('locks anything rated above the threshold, 86 by default', () => {
    expect(DEFAULT_EXCLUSION_SETTINGS.autoLock.aboveRating).toBe(86)
    expect(reasonsFor(card({}, 86), DEFAULT_EXCLUSION_SETTINGS)).toEqual([])
    expect(reasonsFor(card({}, 87), DEFAULT_EXCLUSION_SETTINGS)).toEqual(['auto_locked_rating'])
  })

  it('locks anything valued above a coin threshold', () => {
    const settings: ExclusionSettings = {
      ...NO_AUTO_LOCK,
      autoLock: { ...NO_AUTO_LOCK.autoLock, aboveValue: 10_000 },
    }
    expect(reasonsFor(card({ estimatedPrice: 9_000 }), settings)).toEqual([])
    expect(reasonsFor(card({ estimatedPrice: 11_000 }), settings)).toEqual(['auto_locked_value'])
    // An unpriced card is not silently treated as expensive OR as cheap.
    expect(reasonsFor(card({ estimatedPrice: null }), settings)).toEqual([])
  })

  it('locks promo cards and favourites', () => {
    expect(reasonsFor(card({}, 80, 'FUTTIES'), DEFAULT_EXCLUSION_SETTINGS)).toEqual([
      'auto_locked_promo',
    ])
    expect(reasonsFor(card({ favourite: true }), DEFAULT_EXCLUSION_SETTINGS)).toEqual([
      'auto_locked_favourite',
    ])
  })

  it('every rule is switchable off', () => {
    const everything = card({ favourite: true, estimatedPrice: 999_999 }, 99, 'TOTS')
    expect(reasonsFor(everything, DEFAULT_EXCLUSION_SETTINGS).length).toBeGreaterThan(0)
    expect(reasonsFor(everything, NO_AUTO_LOCK)).toEqual([])
  })
})

describe('the availability report on the solve screen', () => {
  const pool: ResolvedCard[] = [
    ...Array.from({ length: 6 }, () => card()),
    ...Array.from({ length: 3 }, () => card({ locked: true })),
    ...Array.from({ length: 2 }, () => card({ inActiveSquad: true })),
    card({ isLoan: true }),
  ]

  it('counts what is available and why the rest is not', () => {
    const report = assessAvailability(pool, NO_AUTO_LOCK)
    expect(report.totalCards).toBe(12)
    expect(report.availableCards).toBe(6)
    expect(report.countsByReason.locked).toBe(3)
    expect(report.countsByReason.in_active_squad).toBe(2)
    expect(report.countsByReason.loan).toBe(1)
  })

  it('reads as the line from the brief', () => {
    expect(formatAvailability(assessAvailability(pool, NO_AUTO_LOCK))).toBe(
      '6 of 12 cards available. 6 excluded: 1 loans, 2 in active squads, 3 locked.',
    )
  })

  it('says so plainly when nothing is excluded', () => {
    const clean = assessAvailability([card(), card()], NO_AUTO_LOCK)
    expect(formatAvailability(clean)).toBe('2 of 2 cards available.')
  })
})

describe('relaxation is offered, never taken', () => {
  it('reports how many cards relaxing would return', () => {
    const pool = [card({ locked: true }), card({ locked: true }), card({ isLoan: true }), card()]
    const report = assessAvailability(pool, NO_AUTO_LOCK)
    expect(report.releasableByRelaxing).toBe(2)
    expect(relaxationOffer(report)).toContain('2 more card(s)')
  })

  it('never counts loans or active squad members as releasable', () => {
    // Relaxing these would produce a squad the game rejects, which is worse than
    // no squad at all, so they are not on the table.
    const pool = [card({ isLoan: true }), card({ inActiveSquad: true })]
    const report = assessAvailability(pool, NO_AUTO_LOCK)
    expect(report.releasableByRelaxing).toBe(0)
    expect(relaxationOffer(report)).toBeNull()
  })

  it('assessAvailability itself never relaxes anything', () => {
    const pool = [card({ locked: true })]
    expect(assessAvailability(pool, NO_AUTO_LOCK).available).toEqual([])
  })
})
