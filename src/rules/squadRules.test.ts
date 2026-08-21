/**
 * One copy of a player per squad, on the TypeScript side. PENDING P-009.
 *
 * Two jobs here. The pool builder must always send the key, or the solver has
 * nothing to group on and silently allows a repeat. And `rebuild` must catch a
 * repeat if one comes back anyway, because the service is TOLD the rule and is
 * never trusted to have applied it.
 */

import { describe, expect, it } from 'vitest'
import { defaultCardTypeRegistry } from './cardTypes'
import { getFormation } from './formations'
import { RULE_FACTS } from './ruleFacts'
import { MAX_COPIES_PER_SQUAD, copyLimitFact, playerKeyOf } from './squadRules'
import { buildPool } from '../cli/pool'
import { formatSquad, rebuild } from '../cli/report'
import type { CardDefinition, OwnedCard, ResolvedCard } from '../types/cards'
import type { WireSquad } from '../cli/solverClient'

const SLOTS = getFormation('4-4-2').slots

function definition(index: number, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    defId: `d${index}`,
    name: `Player ${index}`,
    rating: 84,
    positions: [SLOTS[index] ?? 'CM'],
    nation: `Nation ${index}`,
    league: `League ${index}`,
    club: `Club ${index}`,
    cardType: 'rare',
    isWomens: false,
    ...overrides,
  }
}

function owned(index: number, overrides: Partial<OwnedCard> = {}): OwnedCard {
  return {
    id: `c${index}`,
    defId: `d${index}`,
    quantity: 1,
    pool: 'club',
    untradeable: false,
    isLoan: false,
    isEvolved: false,
    locked: false,
    inActiveSquad: false,
    estimatedPrice: 1000,
    ...overrides,
  }
}

function resolvedCard(index: number, defIndex = index): ResolvedCard {
  const card = definition(defIndex)
  return {
    owned: owned(index, { defId: card.defId }),
    definition: card,
    type: defaultCardTypeRegistry.get('rare'),
    effectivePositions: [SLOTS[index] ?? 'CM'],
  }
}

/** A squad where `repeatAt` slots all hold the same card. */
function squadOf(repeats: number[]): { wire: WireSquad; byId: Map<string, ResolvedCard> } {
  const byId = new Map<string, ResolvedCard>()
  const placements = SLOTS.map((slot, index) => {
    const from = repeats.includes(index) ? 0 : index
    const card = resolvedCard(index, from)
    byId.set(`c${index}`, card)
    return {
      card_id: `c${index}`,
      slot_index: index,
      slot_position: slot,
      in_position: true,
      chemistry: 0,
    }
  })
  return { wire: { placements, cost: 0, coins_spent: 0, value_burned: 0 }, byId }
}

describe('the rule value', () => {
  it('is one, and is flagged as unverified', () => {
    expect(MAX_COPIES_PER_SQUAD).toBe(1)
    expect(copyLimitFact().verified).toBe(false)
    expect(copyLimitFact().pendingRef).toBe('P-009')
  })

  it('is LIVE, because a wrong value returns invalid squads rather than mis-scored ones', () => {
    expect(copyLimitFact().observable).toBe(true)
  })

  it('is in RULE_FACTS, so the startup warning names it', () => {
    expect(RULE_FACTS.some((fact) => fact.id === 'squad:one_copy_per_player')).toBe(true)
  })

  it('says in its source that no reading was taken', () => {
    // The evidence is secondary and unreadable at source from here. Recording
    // that is the difference between an unverified value and a guess.
    expect(copyLimitFact().source).toContain('Secondary sources only')
  })
})

describe('playerKeyOf', () => {
  it('keys on the card definition, which is the half P-009 settles', () => {
    expect(playerKeyOf({ defId: 'd7' })).toBe('d7')
  })

  it('gives two different versions of one footballer DIFFERENT keys today', () => {
    // Deliberate and recorded: if P-009 part two says the game blocks by
    // footballer, this is where the fix goes, and it needs a player id first.
    expect(playerKeyOf({ defId: 'saka-gold' })).not.toBe(playerKeyOf({ defId: 'saka-totw' }))
  })
})

describe('buildPool always sends the key', () => {
  // Without it the solver has nothing to group on and the constraint is inert.
  it('sets player_key on every card', () => {
    const result = buildPool(
      [owned(0), owned(1)],
      [definition(0), definition(1)],
      { prices: { 84: 1900 } },
    )
    expect(result.cards).toHaveLength(2)
    for (const card of result.cards) expect(card.player_key).not.toBe('')
  })

  it('sets it to the card definition, so two stacks of one definition share it', () => {
    const result = buildPool(
      [owned(0), { ...owned(1), defId: 'd0' }],
      [definition(0)],
      { prices: { 84: 1900 } },
    )
    expect(new Set(result.cards.map((card) => card.player_key)).size).toBe(1)
  })
})

describe('rebuild catches a repeat the solver should not have returned', () => {
  it('accepts a squad of eleven distinct players', () => {
    const { wire, byId } = squadOf([])
    const rebuilt = rebuild(wire, '4-4-2', byId, [])
    expect(rebuilt.repeatedPlayers).toEqual([])
    expect(rebuilt.mismatches).toEqual([])
  })

  it('names the player and the count when one appears twice', () => {
    const { wire, byId } = squadOf([5])
    const rebuilt = rebuild(wire, '4-4-2', byId, [])
    expect(rebuilt.repeatedPlayers).toHaveLength(1)
    expect(rebuilt.repeatedPlayers[0]?.times).toBe(2)
    expect(rebuilt.repeatedPlayers[0]?.name).toBe('Player 0')
  })

  it('reports it as a MISMATCH, next to the chemistry ones', () => {
    const { wire, byId } = squadOf([3, 7])
    const rebuilt = rebuild(wire, '4-4-2', byId, [])
    expect(rebuilt.mismatches.join(' ')).toContain('appears 3 times in this squad')
    expect(rebuilt.mismatches.join(' ')).toContain('the per squad limit is 1')
  })

  it('and formatSquad prints it, rather than leaving it in the object', () => {
    const { wire, byId } = squadOf([5])
    const rebuilt = rebuild(wire, '4-4-2', byId, [])
    const text = formatSquad(rebuilt, 1, { cost: 0, coinsSpent: 0, valueBurned: 0 })
    expect(text).toContain('MISMATCH')
    expect(text).toContain('appears 2 times')
  })
})

describe('the per squad line says which number is which', () => {
  /**
   * "23950 cost" on its own reads as coins. It is the weighted figure the solver
   * minimises, and with the untradeable weighting applied it can be a fiftieth of
   * what the cards list at. Same class as the two already fixed.
   */
  it('labels coins, value burned and the weighted figure separately', () => {
    const { wire, byId } = squadOf([])
    const rebuilt = rebuild(wire, '4-4-2', byId, [])
    const text = formatSquad(rebuilt, 1, { cost: 23950, coinsSpent: 0, valueBurned: 21400 })
    expect(text).toContain('0 coins spent')
    expect(text).toContain('21400 value burned')
    expect(text).toContain('solver cost 23950')
    expect(text).toContain('weighted, not coins')
  })

  it('never prints a bare "N cost" that could be read as coins', () => {
    const { wire, byId } = squadOf([])
    const rebuilt = rebuild(wire, '4-4-2', byId, [])
    const text = formatSquad(rebuilt, 1, { cost: 23950, coinsSpent: 0, valueBurned: 21400 })
    expect(text).not.toMatch(/\b23950 cost\b/)
  })
})
