/**
 * THE AUDIT METHOD, AS A TEST FILE. TypeScript half.
 *
 * Companion to `solver/tests/test_degraded_states.py`. Same rule: if a function
 * returns a sentence a person will act on, it belongs here with its degraded
 * state FORCED, not reasoned about. Two output paths have now been cleared by
 * reading what they print while the code did something else.
 */

import { describe, expect, it } from 'vitest'
import { defaultCardTypeRegistry } from './cardTypes'
import { assessAvailability, formatAvailability, relaxationOffer } from './exclusions'
import { getFormation } from './formations'
import { parseRequirementText } from './parseRequirementText'
import { uncheckedRequirements, squadPasses, validateSquad } from './validateSquad'
import { collectUnverified, formatStartupWarning, liveItems } from './verification'
import { describeCoverage, loadClub } from '../data/clubImport'
import { loadCardDefinitions } from '../data/cardDefinitions'
import { buildPool } from '../cli/pool'
import { formatDiagnosis, formatRequirements, formatSpend } from '../cli/report'
import { ConflictingSquadSizeError, squadSizeOf } from '../solver/queueGuards'
import type { CardDefinition, OwnedCard, ResolvedCard } from '../types/cards'
import type { Requirement } from '../types/requirements'
import type { Squad } from '../types/squad'

const SLOTS = getFormation('4-4-2').slots

function definition(index: number, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    defId: `d${index}`,
    name: `Player ${index}`,
    rating: 84,
    positions: [SLOTS[index] ?? 'CM'],
    nation: 'Albion',
    league: 'Premier Division',
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

function resolved(index: number, overrides: Partial<OwnedCard> = {}): ResolvedCard {
  const card = definition(index)
  return {
    owned: owned(index, overrides),
    definition: card,
    type: defaultCardTypeRegistry.get('rare'),
    effectivePositions: card.positions,
  }
}

function squad(): Squad {
  return {
    formation: getFormation('4-4-2'),
    players: SLOTS.map((slot, index) => ({
      card: resolved(index),
      slotIndex: index,
      slotPosition: slot,
    })),
  }
}

describe('validateSquad, on a requirement type this build does not know', () => {
  // Requirements arrive from pasted SBC text, from JSON and from HTTP bodies,
  // none of which the compiler has seen. The switch used to fall off the end and
  // return undefined, which JSON rendered as a null row.
  const invented = { type: 'inventedByEA', op: 'min', value: 2 } as unknown as Requirement

  it('returns a result rather than undefined', () => {
    const results = validateSquad(squad(), [invented])
    expect(results).toHaveLength(1)
    expect(results[0]).toBeDefined()
  })

  it('says NOT CHECKED rather than reporting a failure it did not measure', () => {
    const [result] = validateSquad(squad(), [invented])
    expect(String(result?.achieved)).toContain('NOT CHECKED')
    expect(String(result?.required)).toBe('inventedByEA')
  })

  it('does not pass, because the safe direction is to refuse', () => {
    expect(squadPasses(squad(), [invented])).toBe(false)
  })

  it('does not throw, which is what it used to do', () => {
    expect(() => squadPasses(squad(), [invented])).not.toThrow()
  })

  it('is separable from a genuine failure', () => {
    const real = { type: 'totwCount', op: 'min', value: 1 } as Requirement
    const unchecked = uncheckedRequirements(squad(), [invented, real])
    expect(unchecked).toHaveLength(1)
    expect(unchecked[0]?.requirement).toBe(invented)
  })
})

describe('validateSquad, on a squad it cannot score', () => {
  it('says "incomplete squad" rather than quoting a rating it did not compute', () => {
    const short = { ...squad(), players: squad().players.slice(0, 9) }
    const [result] = validateSquad(short, [
      { type: 'teamRating', op: 'min', value: 84 } as Requirement,
    ])
    expect(result?.achieved).toBe('incomplete squad')
    expect(result?.passed).toBe(false)
  })
})

describe('squadSizeOf, on a challenge that states two different sizes', () => {
  it('REFUSES rather than taking the first', () => {
    expect(() =>
      squadSizeOf([
        { type: 'squadSize', value: 11 },
        { type: 'squadSize', value: 8 },
      ] as Requirement[]),
    ).toThrow(ConflictingSquadSizeError)
  })

  it('names both sizes, because one of them is what the game will enforce', () => {
    try {
      squadSizeOf([
        { type: 'squadSize', value: 11 },
        { type: 'squadSize', value: 8 },
      ] as Requirement[])
    } catch (error) {
      expect((error as Error).message).toContain('11, 8')
    }
  })

  it('accepts a harmless duplicate that states the same size twice', () => {
    expect(
      squadSizeOf([
        { type: 'squadSize', value: 11 },
        { type: 'squadSize', value: 11 },
      ] as Requirement[]),
    ).toBe(11)
  })
})

describe('the paste parser, on text it does not understand', () => {
  it('returns the unrecognised line rather than dropping it', () => {
    const result = parseRequirementText('Squad Rating: Min. 85\nSomething Invented: Min. 2')
    expect(result.lines).toHaveLength(2)
    expect(result.unrecognised).toHaveLength(1)
    expect(result.unrecognised[0]?.problem).toContain('label was not recognised')
  })

  it('refuses to turn a word into a number', () => {
    const result = parseRequirementText('Rare: a few')
    expect(result.requirements).toEqual([])
    expect(result.unrecognised[0]?.problem).toContain('no number in it')
  })
})

describe('the import loaders, on a file they cannot use', () => {
  it('a missing required column loads NOTHING and names the column', () => {
    const result = loadCardDefinitions('name,rating\nA,84\n')
    expect(result.rows).toEqual([])
    expect(result.errors.map((error) => error.column)).toContain('defId')
  })

  it('a club file with no status pass reports coverage as DEFAULTED, not as no', () => {
    const result = loadClub('defId,quantity\np1,3\n')
    const described = describeCoverage(result.coverage)
    expect(described).toContain('untradeable known for 0 of 3')
    expect(described).toContain('DEFAULTED rather than seen')
  })

  it('a fully covered club says nothing about defaults', () => {
    const result = loadClub(
      'defId,quantity,observed\np1,2,untradeable|isLoan|locked|inActiveSquad\n',
    )
    expect(describeCoverage(result.coverage)).not.toContain('DEFAULTED')
  })
})

describe('buildPool, on a rating it cannot price', () => {
  it('reports the rating and sends a null price rather than a made up one', () => {
    const result = buildPool([owned(0, { estimatedPrice: null })], [definition(0, { rating: 72 })], {
      prices: {},
    })
    expect(result.unpricedRatings).toEqual([72])
    expect(result.cards[0]?.market_price).toBeNull()
  })
})

describe('the availability line, when everything is excluded', () => {
  it('counts by reason rather than reporting one number', () => {
    const report = assessAvailability([
      resolved(0, { isLoan: true }),
      resolved(1, { inActiveSquad: true }),
      resolved(2, { locked: true }),
    ])
    const line = formatAvailability(report)
    expect(line).toContain('0 of 3')
    expect(line).toContain('loans')
    expect(line).toContain('in active squads')
    expect(line).toContain('locked')
  })

  it('offers relaxation only for what relaxing would actually return', () => {
    // A loan can never be submitted, so offering to relax for it would be a lie.
    const onlyIneligible = assessAvailability([resolved(0, { isLoan: true })])
    expect(relaxationOffer(onlyIneligible)).toBeNull()

    const protectedOnly = assessAvailability([resolved(0, { locked: true })])
    expect(relaxationOffer(protectedOnly)).not.toBeNull()
  })
})

describe('the startup warning, when rule values are unverified', () => {
  it('names them rather than reporting a count', () => {
    const items = collectUnverified(defaultCardTypeRegistry)
    const live = liveItems(items)
    expect(live.length).toBeGreaterThan(0)
    const warning = formatStartupWarning(items)
    expect(warning).toContain('UNVERIFIED AND LIVE')
    for (const item of live) expect(warning).toContain(item.what)
  })

  it('says all clear only when there is nothing live', () => {
    expect(formatStartupWarning([])).toContain('All game rules')
  })
})

describe('the report formatters, on the degraded inputs', () => {
  it('an unpriced shortfall is printed with NO coin figure', () => {
    const text = formatDiagnosis({
      mode: 'supply',
      blocking: [],
      explanation: 'the club running out of cards',
      supply: [
        { rating: 91, needed: 4, held: 0, missing: 4, unit_cost: null, basis: 'unknown', cost_to_close: null },
      ],
      limits: [],
    })
    expect(text).toContain('NO PRICE, so no coin figure is quoted')
    expect(text).not.toMatch(/\d+ each/)
  })

  it('no requirements says so rather than printing an empty checklist', () => {
    expect(formatRequirements([])).toContain('no requirements')
  })

  it('coins and value are never added together', () => {
    const text = formatSpend(0, 263400, 271200)
    expect(text).toContain('0 coins spent')
    expect(text).toContain('263400 value burned')
    expect(text).toContain('not coins')
    expect(text).not.toContain('263400 coins')
  })
})
