import { describe, expect, it } from 'vitest'
import { costOf, pricePool, summarise } from './costModel'
import { FilePriceProvider } from './fileProvider'
import { DEFAULT_COST_WEIGHTS } from '../types/solver'
import { resolvedCard } from '../../tests/support/factories'
import type { OwnedCard, ResolvedCard } from '../types/cards'
import type { ResolvedPrice } from '../types/solver'

function card(owned: Partial<OwnedCard> = {}, rating = 84): ResolvedCard {
  const base = resolvedCard({ rating })
  return { ...base, owned: { ...base.owned, ...owned } }
}

const price = (coins: number): ResolvedPrice => ({
  coins,
  basis: 'rating_table',
  asOf: '2026-08-19T00:00:00Z',
})

describe('coins spent and value burned are never blended', () => {
  it('an untradeable club card costs nothing on either count', () => {
    // No coins leave the wallet and nothing sellable is destroyed.
    const cost = costOf(card({ untradeable: true }), price(5000))
    expect(cost.coinsSpent).toBe(0)
    expect(cost.valueBurned).toBe(0)
  })

  it('a tradeable club card burns its market value and spends no coins', () => {
    const cost = costOf(card({ untradeable: false }), price(5000))
    expect(cost.coinsSpent).toBe(0)
    expect(cost.valueBurned).toBe(5000)
  })

  it('a market purchase spends coins and burns nothing', () => {
    const cost = costOf(card(), price(5000), {
      weights: DEFAULT_COST_WEIGHTS,
      source: 'market',
    })
    expect(cost.coinsSpent).toBe(5000)
    expect(cost.valueBurned).toBe(0)
  })
})

describe('the preference order from brief 8', () => {
  const weights = DEFAULT_COST_WEIGHTS

  function weighted(owned: Partial<OwnedCard>, coins = 1000): number {
    return costOf(card(owned), price(coins)).weightedCost
  }

  it('prefers an untradeable duplicate above everything else in the club', () => {
    const untradeableDupe = weighted({ untradeable: true, quantity: 3 })
    const untradeableSingle = weighted({ untradeable: true, quantity: 1 })
    const storage = weighted({ untradeable: false, quantity: 1, pool: 'sbc_storage' })
    const tradeable = weighted({ untradeable: false, quantity: 1 })

    expect(untradeableDupe).toBeLessThan(untradeableSingle)
    expect(untradeableSingle).toBeLessThan(storage)
    expect(storage).toBeLessThan(tradeable)
  })

  it('stacks the duplicate and storage bonuses', () => {
    expect(weighted({ untradeable: true, quantity: 2, pool: 'sbc_storage' })).toBe(
      weights.untradeableCost + weights.duplicateBonus + weights.sbcStorageBonus,
    )
  })

  it('lets a cheap tradeable card beat a preference, which is the point of weights', () => {
    // Preference is a thumb on the scale, not a sort. A 50 coin tradeable card
    // should still win over an untradeable one when the gap is small enough.
    const cheapTradeable = weighted({ untradeable: false, quantity: 1 }, 20)
    const untradeableSingle = weighted({ untradeable: true, quantity: 1 })
    expect(cheapTradeable).toBeLessThan(untradeableSingle + weights.duplicateBonus * -1)
  })

  it('the weighted cost can go negative, which is deliberate', () => {
    // Squad size is fixed at eleven, so a negative cost cannot cause the solver
    // to over fill. It just makes burning dupes strictly preferred.
    expect(weighted({ untradeable: true, quantity: 5 })).toBeLessThan(0)
  })
})

describe('an unpriced card is never free', () => {
  const provider = new FilePriceProvider({
    table: {
      lastUpdated: '2026-08-01T00:00:00Z',
      entries: [
        { rating: 84, coins: 900 },
        { rating: 85, coins: 1600 },
      ],
    },
    overrides: [{ defId: 'special', coins: 250_000, fetchedAt: '2026-08-18T00:00:00Z', source: 'manual' }],
  })

  it('falls back to the configured default and labels it as such', async () => {
    const resolved = await provider.resolve('whatever', 91)
    expect(resolved.coins).toBe(DEFAULT_COST_WEIGHTS.unknownPriceDefault)
    expect(resolved.basis).toBe('unknown_default')
    expect(resolved.asOf).toBeNull()
  })

  it('uses the rating table when it has the rating', async () => {
    const resolved = await provider.resolve('anything', 84)
    expect(resolved).toEqual({ coins: 900, basis: 'rating_table', asOf: '2026-08-01T00:00:00Z' })
  })

  it('a per card override beats the rating table', async () => {
    const resolved = await provider.resolve('special', 84)
    expect(resolved.coins).toBe(250_000)
    expect(resolved.basis).toBe('card_override')
  })

  it('reports how stale the table is, so the UI can say', () => {
    expect(provider.ageInDays(new Date('2026-08-19T00:00:00Z'))).toBe(18)
  })
})

describe('summarising a squad', () => {
  it('adds the two money numbers separately and counts the guesses', async () => {
    const provider = new FilePriceProvider({
      table: { lastUpdated: '2026-08-10T00:00:00Z', entries: [{ rating: 84, coins: 500 }] },
    })
    const cards = [
      card({ untradeable: false }, 84),
      card({ untradeable: true }, 84),
      card({ untradeable: false }, 91), // no price for 91, so it defaults
    ]
    const priced = await pricePool(cards, provider)
    const summary = summarise(priced.map((p) => p.cost))

    expect(summary.coinsSpent).toBe(0)
    expect(summary.valueBurned).toBe(500 + 0 + DEFAULT_COST_WEIGHTS.unknownPriceDefault)
    expect(summary.pricedFromData).toBe(2)
    expect(summary.unpricedAtDefault).toBe(1)
    expect(summary.oldestPriceAsOf).toBe('2026-08-10T00:00:00Z')
  })
})
