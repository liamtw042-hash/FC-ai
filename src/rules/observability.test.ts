import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LADDERS,
  calculateChemistry,
  type ChemistryLadders,
  type ThresholdLadder,
} from './chemistry'
import { RULE_FACTS, type RuleFact } from './ruleFacts'
import { tierFor } from './verification'
import { calculateSquadRating } from './squadRating'
import { placeAll, resolvedCard } from '../../tests/support/factories'

/**
 * THE TIER CRITERION, MEASURED.
 *
 * A rule fact is live when a wrong value could change a returned squad. This file
 * does not take that on trust. For every threshold step it perturbs the value,
 * recomputes chemistry across a corpus of squads built to exercise that ladder,
 * and reports whether anything actually moved. The measurement is then compared
 * against the flag declared in ruleFacts.ts.
 *
 * If someone later marks a live step unobservable to quieten the startup warning,
 * or leaves a genuinely inert step in the live tier, this fails.
 */

type Category = 'club' | 'nation' | 'league'

/** k linked players plus filler, respecting how each entity behaves in real data. */
function corpusFor(category: Category): (() => ReturnType<typeof placeAll>)[] {
  const squads: (() => ReturnType<typeof placeAll>)[] = []
  for (let k = 1; k <= 11; k += 1) {
    squads.push(() => {
      const cards = Array.from({ length: 11 }, (_, i) => {
        if (i >= k) return resolvedCard({ positions: ['CM'] })
        if (category === 'club') {
          // Clubmates are always league mates. Modelling them otherwise would
          // measure a squad the game cannot produce.
          return resolvedCard({ positions: ['CM'], club: 'Alpha', league: 'League A' })
        }
        if (category === 'league') {
          // League mates at distinct clubs, so the club ladder stays out of it.
          return resolvedCard({ positions: ['CM'], league: 'League A' })
        }
        // Countrymen at distinct clubs in distinct leagues. Nation entangles
        // with nothing, so it reads cleanly.
        return resolvedCard({ positions: ['CM'], nation: 'Shared Nation' })
      })
      return placeAll(cards, cards.map(() => 'CM'))
    })
  }
  return squads
}

function withStep(
  base: ChemistryLadders,
  category: Category,
  stepIndex: number,
  change: (step: readonly [number, number]) => [number, number],
): ChemistryLadders {
  const ladder: ThresholdLadder = base[category].map((step, i) =>
    i === stepIndex ? change(step) : [step[0], step[1]],
  )
  return { ...base, [category]: ladder }
}

/** Does any squad in the corpus score differently under the perturbed ladder? */
function anythingMoves(category: Category, perturbed: ChemistryLadders): boolean {
  for (const build of corpusFor(category)) {
    const players = build()
    const before = calculateChemistry(players, undefined, DEFAULT_LADDERS)
    const after = calculateChemistry(players, undefined, perturbed)
    if (before.total !== after.total) return true
    for (let i = 0; i < before.players.length; i += 1) {
      if (before.players[i]!.chemistry !== after.players[i]!.chemistry) return true
    }
  }
  return false
}

/**
 * A step is observable when SOME plausible wrong value changes SOME squad. Three
 * perturbations: the step firing one player later, one player earlier, and
 * awarding one point less.
 */
function measureObservable(category: Category, requiredCount: number): boolean {
  const index = DEFAULT_LADDERS[category].findIndex(([count]) => count === requiredCount)
  expect(index, `${category} ladder has no step at ${requiredCount}`).toBeGreaterThanOrEqual(0)

  const perturbations: ((step: readonly [number, number]) => [number, number])[] = [
    ([count, points]) => [count + 1, points],
    ([count, points]) => [Math.max(1, count - 1), points],
    ([count, points]) => [count, Math.max(0, points - 1)],
  ]
  return perturbations.some((change) =>
    anythingMoves(category, withStep(DEFAULT_LADDERS, category, index, change)),
  )
}

function parseStep(fact: RuleFact): { category: Category; count: number } {
  const match = /^threshold:(club|nation|league)@(\d+)$/.exec(fact.id)
  if (match === null) throw new Error(`not a threshold step: ${fact.id}`)
  return { category: match[1] as Category, count: Number(match[2]) }
}

const thresholdFacts = RULE_FACTS.filter((fact) => fact.kind === 'threshold_step')

describe('the tier criterion is measured, not declared', () => {
  it('covers every threshold step in the ladders, with none missing and none invented', () => {
    const declared = thresholdFacts.map((f) => f.id).sort()
    const actual: string[] = []
    for (const category of ['club', 'nation', 'league'] as const) {
      for (const [count] of DEFAULT_LADDERS[category]) actual.push(`threshold:${category}@${count}`)
    }
    expect(declared).toEqual(actual.sort())
  })

  for (const fact of thresholdFacts) {
    it(`${fact.what} is ${fact.observable ? 'observable' : 'unobservable'}, and behaves that way`, () => {
      const { category, count } = parseStep(fact)
      expect(measureObservable(category, count)).toBe(fact.observable)
    })
  }

  it('the tier follows from observability and from nothing else', () => {
    for (const fact of thresholdFacts) {
      expect(tierFor(fact.observable)).toBe(fact.observable ? 'live' : 'unobservable')
    }
  })

  it('exactly one step is unobservable, and it is the masked club step', () => {
    const inert = thresholdFacts.filter((f) => !f.observable).map((f) => f.id)
    expect(inert).toEqual(['threshold:club@7'])
  })

  it('the +3 steps for league and nation are live, unlike the club one', () => {
    // They read 3 with eight linked players and 2 without, and nothing caps them
    // early, so a wrong value here really does change squads.
    for (const id of ['threshold:league@8', 'threshold:nation@8']) {
      const fact = RULE_FACTS.find((f) => f.id === id)!
      expect(fact.observable).toBe(true)
      expect(fact.pendingRef).not.toBeNull()
    }
  })

  it('a queued reading is not what makes something live', () => {
    // The criterion is whether a wrong value could change a returned squad. A
    // step with no reading queued is still live if it could.
    const noReading = RULE_FACTS.filter((f) => f.pendingRef === null)
    for (const fact of noReading) {
      expect(fact.observable, `${fact.id} has no reading queued`).toBe(false)
    }
  })
})

describe('the unobservable step really cannot be seen from anywhere downstream', () => {
  it('no club group size scores differently under any club +3 step from 5 to 11', () => {
    const index = DEFAULT_LADDERS.club.findIndex(([count]) => count === 7)
    for (let moved = 5; moved <= 11; moved += 1) {
      const perturbed = withStep(DEFAULT_LADDERS, 'club', index, ([, points]) => [moved, points])
      expect(anythingMoves('club', perturbed), `club +3 moved to ${moved}`).toBe(false)
    }
  })

  it('and removing the club +3 step entirely still changes nothing', () => {
    const perturbed: ChemistryLadders = {
      ...DEFAULT_LADDERS,
      club: DEFAULT_LADDERS.club.filter(([count]) => count !== 7),
    }
    expect(anythingMoves('club', perturbed)).toBe(false)
  })
})

describe('the rating step 5 fact is live, and here is the squad that shows it', () => {
  it('floor and round disagree on one 95 with ten 84s', () => {
    const fact = RULE_FACTS.find((f) => f.id === 'rating:step5_floor')!
    expect(fact.observable).toBe(true)
    expect(calculateSquadRating([95, ...Array<number>(10).fill(84)])).toBe(85)
  })
})
