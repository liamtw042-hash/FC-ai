import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  formatReport,
  runAllFixtures,
  runFixture,
  validateFixture,
} from './groundTruth'
import {
  collectUnverified,
  formatStartupWarning,
  liveItems,
  unobservableItems,
} from './verification'
import { defaultCardTypeRegistry } from './cardTypes'
import { getFormation, listFormations } from './formations'
import type { GroundTruthFixture } from '../types/squad'

const FIXTURES_PATH = fileURLToPath(
  new URL('../../tests/fixtures/ground-truth.json', import.meta.url),
)
const groundTruth: { fixtures: GroundTruthFixture[] } = JSON.parse(
  readFileSync(FIXTURES_PATH, 'utf8'),
)

function fixtureById(id: string): GroundTruthFixture {
  const found = groundTruth.fixtures.find((f) => f.id === id)
  if (found === undefined) throw new Error(`fixture ${id} missing`)
  return found
}

describe('every fixture runs in CI', () => {
  // Brief 4.3. If a fixture fails the engine is wrong, not the fixture.
  for (const fixture of groundTruth.fixtures) {
    it(`${fixture.id}${fixture.pending_verification === true ? ' (PENDING)' : ''}`, () => {
      const result = runFixture(fixture)
      expect(result.failures).toEqual([])
      expect(result.passed).toBe(true)
    })
  }

  it('the suite reports its own pending count', () => {
    const report = runAllFixtures(groundTruth.fixtures)
    expect(report.failed).toBe(0)
    expect(report.passed).toBe(groundTruth.fixtures.length)
    expect(report.pending).toBeGreaterThan(0)
  })
})

describe('fixture validation catches data entry errors before they waste an afternoon', () => {
  const base = (): GroundTruthFixture => structuredClone(fixtureById('gt-002-club-league-entanglement'))

  it('accepts a well formed fixture', () => {
    expect(validateFixture(base())).toEqual([])
  })

  it('rejects per player chemistry that does not sum to the stated total', () => {
    const fixture = base()
    fixture.displayedChemistry = 21 // the eleven values still add to 22
    const problems = validateFixture(fixture)
    expect(problems.join(' ')).toContain('sums to 22 but the squad total is recorded as 21')
  })

  it('rejects the wrong number of per player values', () => {
    const fixture = base()
    fixture.displayedPlayerChemistry = [3, 3, 3]
    expect(validateFixture(fixture).join(' ')).toContain('needs 11 per player chemistry values')
  })

  it('rejects a per player value outside 0 to 3', () => {
    const fixture = base()
    fixture.displayedPlayerChemistry = [4, 1, 2, 2, 2, 3, 3, 3, 3, 1, 1]
    expect(validateFixture(fixture).join(' ')).toContain('outside 0 to 3')
  })

  it('rejects a squad that is not eleven players', () => {
    const fixture = base()
    fixture.players = fixture.players.slice(0, 10)
    expect(validateFixture(fixture).join(' ')).toContain('needs exactly 11 players')
  })

  it('rejects an unknown formation', () => {
    const fixture = base()
    fixture.formation = '7-1-3'
    expect(validateFixture(fixture).join(' ')).toContain('unknown formation')
  })

  it('rejects a fixture using positions the formation does not field', () => {
    const fixture = base()
    fixture.players[0]!.slotPosition = 'ST' // 4-4-2 has one GK and two ST
    const problems = validateFixture(fixture).join(' ')
    expect(problems).toContain('has 1 GK slot(s) but the fixture records 0')
    expect(problems).toContain('has 2 ST slot(s) but the fixture records 3')
  })

  it('does not care about slot ORDER, because chemistry has no positional links', () => {
    const fixture = base()
    fixture.players.reverse()
    expect(validateFixture(fixture)).toEqual([])
  })

  it('rejects a chemistry fixture with no per player values', () => {
    const fixture = base()
    fixture.displayedPlayerChemistry = null
    expect(validateFixture(fixture).join(' ')).toContain('no per player chemistry values')
  })
})

describe('a failing fixture names the player and the category', () => {
  it('reports which slot disagreed rather than just that the squad is wrong', () => {
    const fixture = structuredClone(fixtureById('gt-003-league-asymmetry'))
    // Pretend the game told us the lone pair DID score. Sum stays consistent.
    fixture.displayedPlayerChemistry = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 0]
    fixture.displayedChemistry = 15

    const result = runFixture(fixture)
    expect(result.passed).toBe(false)
    const slots = result.failures.filter((f) => f.slotIndex !== undefined).map((f) => f.slotIndex)
    expect(slots).toEqual([0, 1])
    expect(result.failures[0]!.what).toBe('squad chemistry')
  })
})

describe('formations', () => {
  it('every formation has exactly eleven slots and one goalkeeper', () => {
    for (const formation of listFormations()) {
      expect(formation.slots).toHaveLength(11)
      expect(formation.slots.filter((s) => s === 'GK')).toHaveLength(1)
      expect(formation.slots[0]).toBe('GK')
    }
  })

  it('throws on an unknown formation rather than silently returning nothing', () => {
    expect(() => getFormation('4-4-3')).toThrow(/Unknown formation/)
  })
})

describe('the startup warning', () => {
  const items = collectUnverified(defaultCardTypeRegistry, groundTruth.fixtures)

  it('lists every inferred value with the PENDING entry that would clear it', () => {
    const ids = items.map((i) => i.id)
    expect(ids).toContain('card_type:fof_captain')
    expect(ids).toContain('fixture:gt-001-floor-vs-round')

    const captain = items.find((i) => i.id === 'card_type:fof_captain')!
    expect(captain.pendingRef).toBe('P-002')
    expect(captain.basis).toContain('INFERRED')
  })

  it('separates unverified-and-live from unverified-and-unobservable', () => {
    // Lumping the two together trains the reader to skim the warning, and then
    // the live items get skimmed past too.
    const live = liveItems(items).map((i) => i.id)
    const inert = unobservableItems(items).map((i) => i.id)
    expect(live).toContain('card_type:fof_captain')
    expect(live).toContain('formations:slot_labels')
    expect(inert).toEqual(['threshold:club@7'])
    expect(live).not.toContain('threshold:club@7')
    // The +3 steps that are NOT masked belong in the live tier.
    expect(live).toContain('threshold:league@8')
    expect(live).toContain('threshold:nation@8')
  })

  it('only the live tier is told it may produce wrong solutions', () => {
    const text = formatStartupWarning(items)
    expect(text).toContain('UNVERIFIED AND LIVE')
    expect(text).toContain('may be wrong in ways the tests cannot catch')

    const inertSection = text.slice(text.indexOf('Unverified but unobservable'))
    expect(inertSection).toContain('Club +3 at 7')
    expect(inertSection).not.toContain('may be wrong')
    expect(inertSection).toContain('no solution can depend on them')
  })

  it('an inert item never carries a PENDING reference, because no reading can clear it', () => {
    for (const item of unobservableItems(items)) expect(item.pendingRef).toBeNull()
  })

  it('does not quietly imply verified rules when nothing live is outstanding', () => {
    const inertOnly = unobservableItems(items)
    expect(formatStartupWarning(inertOnly)).toContain(
      'All game rules that can affect a solution are verified',
    )
  })
})

afterAll(() => {
  const report = runAllFixtures(groundTruth.fixtures)
  const items = collectUnverified(defaultCardTypeRegistry, groundTruth.fixtures)
  console.log(['', 'Ground truth', formatReport(report), '', formatStartupWarning(items)].join('\n'))
})
