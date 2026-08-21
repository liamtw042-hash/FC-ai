import { describe, expect, it } from 'vitest'
import type { CardDefinition, OwnedCard, ResolvedCard } from '../types/cards'
import { defaultCardTypeRegistry } from '../rules/cardTypes'
import { formatRequirements, formatSpend, rebuild } from './report'
import type { WireSquad } from './solverClient'

const SLOTS = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST']

function card(index: number, rating: number, club: string, linked = true): ResolvedCard {
  const definition: CardDefinition = {
    defId: `d${index}`,
    name: `Player ${index}`,
    rating,
    positions: [SLOTS[index] ?? 'CM'],
    // linked: everyone shares a nation and a league, which is 3 chemistry each.
    // unlinked: nobody shares anything with anybody, which is 0.
    nation: linked ? 'Albion' : `Nation ${index}`,
    league: linked ? 'Premier Division' : `League ${index}`,
    club,
    cardType: 'rare',
    isWomens: false,
  }
  const owned: OwnedCard = {
    id: `c${index}`,
    defId: definition.defId,
    quantity: 1,
    pool: 'club',
    untradeable: false,
    isLoan: false,
    isEvolved: false,
    locked: false,
    inActiveSquad: false,
    estimatedPrice: 1000,
  }
  return {
    owned,
    definition,
    type: defaultCardTypeRegistry.get('rare'),
    effectivePositions: definition.positions,
  }
}

function squadOf(ratings: number[], clubs: string[], chemistry: number[]): WireSquad {
  return {
    placements: ratings.map((rating, index) => ({
      card_id: `c${index}`,
      slot_index: index,
      slot_position: SLOTS[index] ?? 'CM',
      in_position: true,
      chemistry: chemistry[index] ?? 0,
    })),
    cost: 0,
    coins_spent: 0,
    value_burned: 0,
  }
}

function poolFor(ratings: number[], clubs: string[], linked = true): Map<string, ResolvedCard> {
  return new Map(
    ratings.map((rating, index) => [
      `c${index}`,
      card(index, rating, clubs[index] ?? 'Ashford United', linked),
    ]),
  )
}

const ELEVEN_84 = Array.from({ length: 11 }, () => 84)
const ALL_DIFFERENT = Array.from({ length: 11 }, (_, index) => `Club ${index}`)

describe('rebuild', () => {
  // The permanent rule: the Python service is told what the rules are and is
  // never trusted to have applied them.
  it('re-derives rating and chemistry with the TypeScript engine', () => {
    // Eleven cards from one nation and one league, each in position, is the top
    // of both ladders: 3 each and 33 in total.
    const byId = poolFor(ELEVEN_84, ALL_DIFFERENT)
    const result = rebuild(squadOf(ELEVEN_84, ALL_DIFFERENT, ELEVEN_84.map(() => 3)), '4-4-2', byId, [])
    expect(result.rating).toBe(84)
    expect(result.chemistry).toBe(33)
    expect(result.mismatches).toEqual([])
  })

  it('makes it 0 when nobody shares a nation, a league or a club', () => {
    const byId = poolFor(ELEVEN_84, ALL_DIFFERENT, false)
    const result = rebuild(squadOf(ELEVEN_84, ALL_DIFFERENT, ELEVEN_84.map(() => 0)), '4-4-2', byId, [])
    expect(result.chemistry).toBe(0)
    expect(result.mismatches).toEqual([])
  })

  it('reports a chemistry MISMATCH rather than preferring either side', () => {
    const byId = poolFor(ELEVEN_84, ALL_DIFFERENT, false)
    const lying = squadOf(ELEVEN_84, ALL_DIFFERENT, ELEVEN_84.map(() => 3))
    const result = rebuild(lying, '4-4-2', byId, [])
    expect(result.mismatches.length).toBe(11)
    expect(result.mismatches[0]).toContain('the solver scored 3 chemistry')
    expect(result.mismatches[0]).toContain('the rules engine makes it 0')
  })

  it('refuses a card the solver returned that was never in the pool', () => {
    const byId = poolFor(ELEVEN_84, ALL_DIFFERENT)
    byId.delete('c0')
    expect(() => rebuild(squadOf(ELEVEN_84, ALL_DIFFERENT, []), '4-4-2', byId, [])).toThrow(
      /not in the pool it was sent/,
    )
  })

  it('runs every requirement through validateSquad', () => {
    const byId = poolFor(ELEVEN_84, ALL_DIFFERENT)
    const result = rebuild(squadOf(ELEVEN_84, ALL_DIFFERENT, []), '4-4-2', byId, [
      { type: 'rareCount', op: 'min', value: 8 },
      { type: 'totwCount', op: 'min', value: 1 },
    ] as never)
    expect(result.results.map((entry) => entry.passed)).toEqual([true, false])
  })
})

describe('formatRequirements', () => {
  it('puts achieved next to required, per requirement', () => {
    const byId = poolFor(ELEVEN_84, ALL_DIFFERENT)
    const result = rebuild(squadOf(ELEVEN_84, ALL_DIFFERENT, []), '4-4-2', byId, [
      { type: 'totwCount', op: 'min', value: 1 },
    ] as never)
    const text = formatRequirements(result.results)
    expect(text).toContain('FAIL')
    expect(text).toContain('achieved 0, required min 1')
  })

  it('says so when there are none', () => {
    expect(formatRequirements([])).toContain('no requirements')
  })
})

describe('formatSpend', () => {
  // Money that left the account and value that was destroyed are different
  // afternoons, and one figure hides which.
  it('never adds coins and value together', () => {
    const text = formatSpend(0, 263400, 271200)
    expect(text).toContain('0 coins spent')
    expect(text).toContain('263400 value burned')
    expect(text).toContain('not coins')
  })
})
