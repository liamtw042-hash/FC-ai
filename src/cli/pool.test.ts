import { describe, expect, it } from 'vitest'
import type { CardDefinition, OwnedCard } from '../types/cards'
import { buildPool, resolveClub, supplyAndPrices } from './pool'

function definition(defId: string, rating: number, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    defId,
    name: defId,
    rating,
    positions: ['CM'],
    nation: 'Albion',
    league: 'Premier Division',
    club: 'Ashford United',
    cardType: 'rare',
    isWomens: false,
    ...overrides,
  }
}

function owned(defId: string, overrides: Partial<OwnedCard> = {}): OwnedCard {
  return {
    id: `${defId}#0`,
    defId,
    quantity: 1,
    pool: 'club',
    untradeable: false,
    isLoan: false,
    isEvolved: false,
    locked: false,
    inActiveSquad: false,
    estimatedPrice: null,
    ...overrides,
  }
}

describe('resolveClub', () => {
  // Eleven cards that silently vanished is how a solve comes back "impossible"
  // for no visible reason.
  it('REPORTS a stack whose definition is missing rather than dropping it quietly', () => {
    const result = resolveClub([owned('known'), owned('ghost')], [definition('known', 84)])
    expect(result.resolved).toHaveLength(1)
    expect(result.missingDefinitions).toEqual(['ghost'])
  })

  it('prefers a position override over the definition positions', () => {
    const result = resolveClub(
      [owned('a', { positionOverride: ['CDM'] })],
      [definition('a', 84, { positions: ['CM'] })],
    )
    expect(result.resolved[0]?.effectivePositions).toEqual(['CDM'])
  })
})

describe('buildPool', () => {
  it('leaves out what the game will not accept and says why', () => {
    const definitions = [definition('a', 84), definition('b', 84), definition('c', 84)]
    const result = buildPool(
      [owned('a'), owned('b', { isLoan: true }), owned('c', { inActiveSquad: true })],
      definitions,
      { prices: { 84: 1900 } },
    )
    expect(result.cards.map((card) => card.id)).toEqual(['a#0'])
    expect(result.availability.countsByReason.loan).toBe(1)
    expect(result.availability.countsByReason.in_active_squad).toBe(1)
  })

  // The distinction the whole cost model turns on.
  it('separates coins spent from value burned', () => {
    const result = buildPool([owned('a')], [definition('a', 84)], { prices: { 84: 1900 } })
    expect(result.cards[0]?.coins_spent).toBe(0)
    expect(result.cards[0]?.value_burned).toBe(1900)
  })

  it('burns nothing for an untradeable card, because nothing sellable is lost', () => {
    const result = buildPool([owned('a', { untradeable: true })], [definition('a', 84)], {
      prices: { 84: 1900 },
    })
    expect(result.cards[0]?.value_burned).toBe(0)
    expect(result.cards[0]?.coins_spent).toBe(0)
  })

  /**
   * `cost` is the weighted figure the solver minimises and can be a fiftieth of
   * what a card lists at. `market_price` is the coin price. Sending only the
   * first is how a shortfall ends up quoting "50 each" for a 4000 coin card.
   */
  it('sends the coin price SEPARATELY from the weighted solver cost', () => {
    const result = buildPool([owned('a', { untradeable: true })], [definition('a', 86)], {
      prices: { 86: 4200 },
    })
    expect(result.cards[0]?.market_price).toBe(4200)
    expect(result.cards[0]?.cost).not.toBe(4200)
  })

  it('reports a rating it cannot price rather than inventing a number', () => {
    const seen: number[] = []
    const result = buildPool([owned('a')], [definition('a', 72)], {
      prices: { 84: 1900 },
      onUnpriced: (rating) => seen.push(rating),
    })
    expect(result.unpricedRatings).toEqual([72])
    expect(seen).toEqual([72])
    expect(result.cards[0]?.market_price).toBeNull()
  })

  it('falls back to the price the card was imported at before giving up', () => {
    const result = buildPool([owned('a', { estimatedPrice: 3000 })], [definition('a', 72)], {
      prices: {},
    })
    expect(result.cards[0]?.market_price).toBe(3000)
    expect(result.unpricedRatings).toEqual([])
  })

  // The auto lock rules are protections the owner chose, and the pool has to
  // respect them or a solve quietly burns a card they said to keep.
  it('honours the auto lock on rating', () => {
    const result = buildPool([owned('a')], [definition('a', 91)], { prices: { 91: 100000 } })
    expect(result.cards).toHaveLength(0)
    expect(result.availability.countsByReason.auto_locked_rating).toBe(1)
  })
})

describe('supplyAndPrices', () => {
  it('counts copies rather than stacks, because a stack of four feeds four squads', () => {
    const result = buildPool(
      [owned('a', { quantity: 4 }), owned('b', { quantity: 2 })],
      [definition('a', 84), definition('b', 84)],
      { prices: { 84: 1900 } },
    )
    expect(supplyAndPrices(result.cards).supply.get(84)).toBe(6)
  })
})
