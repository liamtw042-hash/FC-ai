import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, afterAll } from 'vitest'
import {
  SQUAD_SIZE,
  InvalidSquadSizeError,
  calculateSquadRating,
  calculateSquadRatingReference,
  explainSquadRating,
} from './squadRating'

const FIXTURES_PATH = fileURLToPath(
  new URL('../../tests/fixtures/ground-truth.json', import.meta.url),
)

interface Fixture {
  id: string
  description: string
  players: { rating: number }[]
  displayedRating: number
  pending_verification?: boolean
  verifies: string[]
  source: string
}

const groundTruth: { fixtures: Fixture[] } = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'))

/** Deterministic PRNG so a property test failure is reproducible from its seed. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomSquad(rand: () => number, lo = 40, hi = 99): number[] {
  return Array.from({ length: SQUAD_SIZE }, () => lo + Math.floor(rand() * (hi - lo + 1)))
}

describe('calculateSquadRating: the four required vectors from brief 4.1', () => {
  const vectors: [string, number[], number][] = [
    ['83,82,81,80,75,82,80,76,77,78,78', [83, 82, 81, 80, 75, 82, 80, 76, 77, 78, 78], 80],
    ['2x 91 + 9x 88', [91, 91, 88, 88, 88, 88, 88, 88, 88, 88, 88], 89],
    ['2x 90 + 9x 87', [90, 90, 87, 87, 87, 87, 87, 87, 87, 87, 87], 88],
    ['11x 84', Array(11).fill(84), 84],
  ]

  // Written as a loop rather than it.each so the titles report the expected
  // squad rating rather than the first element of the ratings array.
  for (const [label, ratings, expected] of vectors) {
    it(`${label} gives ${expected}`, () => {
      expect(calculateSquadRating(ratings)).toBe(expected)
    })
  }

  it('shows its working, so a failure says which step drifted', () => {
    expect(explainSquadRating([83, 82, 81, 80, 75, 82, 80, 76, 77, 78, 78])).toEqual({
      sum: 872,
      averageRating: 872 / 11,
      correctionFactor: expect.closeTo(12.3636, 3),
      total: 884,
      rating: 80,
    })
  })
})

describe('the floor versus round discriminator', () => {
  // The single most damaging possible error in the rating layer, and the four
  // required vectors above cannot catch it: in every one of them T/11 is either
  // exact or below the .5 boundary, so floor and round agree.
  const ONE_95_TEN_84 = [95, ...Array(10).fill(84)]

  it('95 + 10x84 gives 85 under floor, and would give 86 under round', () => {
    const { total } = explainSquadRating(ONE_95_TEN_84)
    expect(total).toBe(945)
    expect(total / SQUAD_SIZE).toBeCloseTo(85.909, 3)

    // The two candidate implementations of step 5 genuinely disagree here.
    expect(Math.floor(total / SQUAD_SIZE)).toBe(85)
    expect(Math.round(total / SQUAD_SIZE)).toBe(86)

    // We implement floor.
    expect(calculateSquadRating(ONE_95_TEN_84)).toBe(85)
  })

  it('matches fixture gt-001-floor-vs-round, which is still PENDING in game verification', () => {
    const fixture = groundTruth.fixtures.find((f) => f.id === 'gt-001-floor-vs-round')
    expect(fixture, 'gt-001-floor-vs-round must exist').toBeDefined()
    expect(fixture!.pending_verification).toBe(true)

    const ratings = fixture!.players.map((p) => p.rating)
    expect(ratings.slice().sort((a, b) => b - a)).toEqual(ONE_95_TEN_84)
    expect(calculateSquadRating(ratings)).toBe(fixture!.displayedRating)
  })
})

describe('rating depends only on the multiset of ratings', () => {
  // Section 5 of the brief enumerates rating multisets and assumes order is
  // irrelevant. If that ever stopped being true the whole solver would be wrong,
  // so it is asserted rather than assumed.
  it('is invariant under every permutation of a fixed squad', () => {
    const base = [95, 88, 84, 84, 82, 81, 80, 79, 77, 75, 62]
    const expected = calculateSquadRating(base)
    const rand = makeRandom(20260819)

    for (let trial = 0; trial < 500; trial += 1) {
      const shuffled = base.slice()
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
      }
      expect(calculateSquadRating(shuffled)).toBe(expected)
    }
  })

  it('holds for randomly generated squads too', () => {
    const rand = makeRandom(7)
    for (let trial = 0; trial < 2000; trial += 1) {
      const squad = randomSquad(rand)
      const ascending = squad.slice().sort((a, b) => a - b)
      const descending = squad.slice().sort((a, b) => b - a)
      expect(calculateSquadRating(ascending)).toBe(calculateSquadRating(descending))
    }
  })
})

describe('the exact integer implementation is equivalent to the spec as written', () => {
  it('agrees with the literal floating point transcription over 50000 random squads', () => {
    const rand = makeRandom(1234567)
    for (let trial = 0; trial < 50000; trial += 1) {
      const squad = randomSquad(rand)
      expect(calculateSquadRating(squad)).toBe(calculateSquadRatingReference(squad))
    }
  })

  it('agrees on the pathological all-equal and maximum-spread squads', () => {
    for (let r = 40; r <= 99; r += 1) {
      const flat = Array(SQUAD_SIZE).fill(r)
      expect(calculateSquadRating(flat)).toBe(calculateSquadRatingReference(flat))
      expect(calculateSquadRating(flat)).toBe(r)
    }
    const spread = [99, ...Array(10).fill(40)]
    expect(calculateSquadRating(spread)).toBe(calculateSquadRatingReference(spread))
  })
})

describe('monotonicity, see RESEARCH.md 4.2', () => {
  // Brief 4.1 says upgrading your worst player can LOWER the squad rating and
  // instructs us to preserve that. Under the formula in 4.1 it cannot happen.
  // Increasing any one rating by d strictly increases SUM + CF, and round then
  // floor are both non-decreasing, so the rating can never fall. This test is
  // the executable form of that finding. If it ever fails, either the formula
  // changed or the claim was right and we need to know immediately.
  it('upgrading any single player never lowers the squad rating', () => {
    const rand = makeRandom(99)
    for (let trial = 0; trial < 20000; trial += 1) {
      const squad = randomSquad(rand)
      const before = calculateSquadRating(squad)
      const index = Math.floor(rand() * SQUAD_SIZE)
      const delta = 1 + Math.floor(rand() * 20)
      const upgraded = squad.slice()
      upgraded[index] = Math.min(99, squad[index]! + delta)
      expect(calculateSquadRating(upgraded)).toBeGreaterThanOrEqual(before)
    }
  })

  it('specifically, upgrading the worst player never lowers the squad rating', () => {
    const rand = makeRandom(4242)
    for (let trial = 0; trial < 20000; trial += 1) {
      const squad = randomSquad(rand)
      const before = calculateSquadRating(squad)
      const worst = Math.min(...squad)
      const index = squad.indexOf(worst)
      for (const delta of [1, 2, 5, 10]) {
        const upgraded = squad.slice()
        upgraded[index] = Math.min(99, worst + delta)
        expect(calculateSquadRating(upgraded)).toBeGreaterThanOrEqual(before)
      }
    }
  })

  it('the real trap is that upgrading usually buys nothing at all', () => {
    // This is the behaviour that actually costs coins, and it IS preserved.
    // Against ten 84s, replacing the eleventh 84 with anything up to an 89 moves
    // the squad rating not one point. Only at 90 does it finally tick over. Buy
    // the 89 and you have paid a lot of coins for exactly nothing.
    for (let upgrade = 84; upgrade <= 89; upgrade += 1) {
      expect(calculateSquadRating([upgrade, ...Array(10).fill(84)])).toBe(84)
    }
    expect(calculateSquadRating([90, ...Array(10).fill(84)])).toBe(85)
    expect(calculateSquadRating([95, ...Array(10).fill(84)])).toBe(85)
  })
})

describe('input validation', () => {
  for (const size of [0, 10, 12, 18]) {
    it(`rejects a squad of ${size}`, () => {
      expect(() => calculateSquadRating(Array(size).fill(84))).toThrow(InvalidSquadSizeError)
    })
  }
})

afterAll(() => {
  const pending = groundTruth.fixtures.filter((f) => f.pending_verification)
  if (pending.length === 0) return
  const lines = pending.map(
    (f) => `  PENDING  ${f.id}  expects ${f.displayedRating}  verifies ${f.verifies.join(', ')}`,
  )
  console.log(
    [
      '',
      `Ground truth fixtures awaiting in game verification (${pending.length}):`,
      ...lines,
      '  These pass against documented behaviour, not against an observed reading.',
      '',
    ].join('\n'),
  )
})
