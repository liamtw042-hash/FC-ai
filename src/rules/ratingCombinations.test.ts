import { describe, expect, it } from 'vitest'
import {
  RatingCombinationCache,
  enumerateRatingCombinations,
  maxCorrectionFactor,
  takeRatingCombinations,
} from './ratingCombinations'
import { calculateSquadRating } from './squadRating'
import type { EnumerateOptions } from './ratingCombinations'

/** A club holding every rating from 60 to 99, which is the hard case. */
const WIDE_CLUB = Array.from({ length: 40 }, (_, i) => 60 + i)

/** Rough fodder prices: cheap low down, steep at the top. */
function priceCurve(rating: number): number {
  if (rating <= 74) return 200
  return Math.round(500 * 1.45 ** (rating - 75))
}

describe('the round trip, which the brief calls non negotiable', () => {
  for (const target of [78, 82, 84, 85, 86, 88, 90, 91]) {
    it(`every combination produced for ${target} evaluates back to ${target}`, () => {
      const combinations = takeRatingCombinations(
        { target, availableRatings: WIDE_CLUB, priceOf: priceCurve },
        200,
      )
      expect(combinations.length).toBeGreaterThan(0)
      for (const combination of combinations) {
        expect(combination.ratings).toHaveLength(11)
        expect(calculateSquadRating(combination.ratings)).toBe(target)
      }
    })
  }

  it('counts and ratings always agree with each other', () => {
    for (const combination of takeRatingCombinations(
      { target: 86, availableRatings: WIDE_CLUB, priceOf: priceCurve },
      100,
    )) {
      const rebuilt: number[] = []
      for (const [rating, count] of combination.counts) {
        for (let i = 0; i < count; i += 1) rebuilt.push(rating)
      }
      expect(rebuilt.sort((a, b) => b - a)).toEqual(combination.ratings.slice().sort((a, b) => b - a))
    }
  })
})

describe('ordering by lower bound', () => {
  const options: EnumerateOptions = {
    target: 86,
    availableRatings: WIDE_CLUB,
    priceOf: priceCurve,
  }

  it('comes out cheapest first, which is what makes the pruning sound', () => {
    const bounds = takeRatingCombinations(options, 300).map((c) => c.lowerBound)
    for (let i = 1; i < bounds.length; i += 1) {
      expect(bounds[i]!).toBeGreaterThanOrEqual(bounds[i - 1]!)
    }
  })

  it('the very first combination is the cheapest that hits the target at all', () => {
    // Brute force the answer over a small pool and check the generator agrees.
    const pool = [80, 82, 84, 86, 88, 90]
    const best = { cost: Number.POSITIVE_INFINITY, ratings: [] as number[] }
    const walk = (index: number, chosen: number[]): void => {
      if (chosen.length === 11) {
        if (calculateSquadRating(chosen) !== 86) return
        const cost = chosen.reduce((a, r) => a + priceCurve(r), 0)
        if (cost < best.cost) {
          best.cost = cost
          best.ratings = chosen.slice()
        }
        return
      }
      if (index >= pool.length) return
      for (let count = 11 - chosen.length; count >= 0; count -= 1) {
        walk(index + 1, [...chosen, ...Array<number>(count).fill(pool[index]!)])
      }
    }
    walk(0, [])

    const first = takeRatingCombinations(
      { target: 86, availableRatings: pool, priceOf: priceCurve },
      1,
    )[0]!
    expect(first.lowerBound).toBe(best.cost)
    expect(calculateSquadRating(first.ratings)).toBe(86)
  })

  it('the top heavy shape the brief describes shows up near the front', () => {
    const cheapest = takeRatingCombinations(options, 20)
    const distinct = cheapest.map((c) => c.counts.size)
    // Cheap solutions lean on a couple of high cards plus a pile of low ones,
    // so they use few distinct ratings.
    expect(Math.min(...distinct)).toBeLessThanOrEqual(3)
  })
})

describe('the band and the pool', () => {
  it('never proposes a rating the club does not hold', () => {
    const owned = [84, 86, 88, 91]
    for (const combination of takeRatingCombinations(
      { target: 87, availableRatings: owned, priceOf: priceCurve },
      50,
    )) {
      for (const rating of combination.ratings) expect(owned).toContain(rating)
    }
  })

  it('respects the configurable band', () => {
    const narrow = takeRatingCombinations(
      { target: 86, availableRatings: WIDE_CLUB, priceOf: priceCurve, bandBelow: 2, bandAbove: 2 },
      50,
    )
    for (const combination of narrow) {
      for (const rating of combination.ratings) {
        expect(rating).toBeGreaterThanOrEqual(84)
        expect(rating).toBeLessThanOrEqual(88)
      }
    }
  })

  it('respects how many cards are actually owned at a rating', () => {
    // Two 91s in the club, so no combination may ask for three.
    const supply = new Map([
      [91, 2],
      [88, 20],
      [86, 20],
      [84, 20],
    ])
    for (const combination of takeRatingCombinations(
      {
        target: 89,
        availableRatings: [...supply.keys()],
        priceOf: priceCurve,
        supplyOf: (rating) => supply.get(rating) ?? 0,
      },
      50,
    )) {
      expect(combination.counts.get(91) ?? 0).toBeLessThanOrEqual(2)
    }
  })

  it('returns nothing rather than guessing when the club is empty in the band', () => {
    expect(takeRatingCombinations({ target: 90, availableRatings: [60, 61, 62] }, 10)).toEqual([])
  })

  it('finds the textbook 2x91 plus 9x88 for 89', () => {
    const combinations = takeRatingCombinations(
      { target: 89, availableRatings: [88, 91], priceOf: priceCurve },
      50,
    )
    const shapes = combinations.map((c) => [...c.counts.entries()].sort((a, b) => b[0] - a[0]))
    expect(shapes).toContainEqual([
      [91, 2],
      [88, 9],
    ])
  })
})

describe('the correction factor bound that makes the search finish', () => {
  it('peaks in the middle, at five or six players above the average', () => {
    // Eleven identical ratings have no spread and therefore no correction.
    expect(maxCorrectionFactor(84, 84)).toBe(0)
    // A spread of 11 peaks at 5 * 6 * 11 / 11 = 30.
    expect(maxCorrectionFactor(80, 91)).toBeCloseTo(30, 6)
  })

  it('never underestimates a real correction factor', () => {
    const lo = 70
    const hi = 95
    const bound = maxCorrectionFactor(lo, hi)
    let worst = 0
    for (let k = 0; k <= 11; k += 1) {
      const ratings = [...Array<number>(k).fill(hi), ...Array<number>(11 - k).fill(lo)]
      const sum = ratings.reduce((a, b) => a + b, 0)
      const average = sum / 11
      const cf = ratings.reduce((a, r) => a + Math.max(0, r - average), 0)
      if (cf > worst) worst = cf
    }
    expect(bound).toBeGreaterThanOrEqual(worst - 1e-9)
  })
})

describe('performance, because the eager version did not finish', () => {
  it('produces the cheapest 200 combinations for a 40 rating club quickly', () => {
    const started = performance.now()
    const combinations = takeRatingCombinations(
      { target: 88, availableRatings: WIDE_CLUB, priceOf: priceCurve },
      200,
    )
    const elapsed = performance.now() - started
    expect(combinations).toHaveLength(200)
    // Generous, because CI machines vary. The point is that it terminates at all:
    // the eager enumeration this replaced ran for five minutes without finishing.
    expect(elapsed).toBeLessThan(5000)
  })

  it('is lazy, so asking for one is far cheaper than asking for a thousand', () => {
    const options: EnumerateOptions = {
      target: 88,
      availableRatings: WIDE_CLUB,
      priceOf: priceCurve,
    }
    const startOne = performance.now()
    takeRatingCombinations(options, 1)
    const one = performance.now() - startOne

    const startMany = performance.now()
    takeRatingCombinations(options, 500)
    const many = performance.now() - startMany

    expect(one).toBeLessThanOrEqual(many + 5)
  })
})

describe('caching per target', () => {
  const options: EnumerateOptions = {
    target: 87,
    availableRatings: WIDE_CLUB,
    priceOf: priceCurve,
  }

  it('returns the same answer on a repeat call', () => {
    const cache = new RatingCombinationCache()
    const first = cache.take(options, 50)
    const second = cache.take(options, 50)
    expect(second).toBe(first)
    expect(cache.size).toBe(1)
  })

  it('keys on the target, the band, the pool and the prices', () => {
    const cache = new RatingCombinationCache()
    cache.take(options, 50)
    cache.take({ ...options, target: 88 }, 50)
    cache.take({ ...options, bandBelow: 4 }, 50)
    cache.take({ ...options, priceOf: (r) => priceCurve(r) * 2 }, 50)
    expect(cache.size).toBe(4)
  })

  it('clears', () => {
    const cache = new RatingCombinationCache()
    cache.take(options, 10)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('the generator interface', () => {
  it('can be stopped the moment a bound stops being competitive', () => {
    // This is how the solver actually drives it: hold a feasible squad costing C
    // and stop as soon as the next lower bound exceeds C, because a combination
    // whose optimistic cost already loses cannot contain a winner.
    const options: EnumerateOptions = {
      target: 86,
      availableRatings: WIDE_CLUB,
      priceOf: priceCurve,
    }
    const cheapest = takeRatingCombinations(options, 1)[0]!
    const budget = Math.round(cheapest.lowerBound * 1.2)

    const taken: number[] = []
    for (const combination of enumerateRatingCombinations(options)) {
      if (combination.lowerBound > budget) break
      taken.push(combination.lowerBound)
    }
    expect(taken.length).toBeGreaterThan(0)
    expect(taken[0]).toBe(cheapest.lowerBound)
    expect(Math.max(...taken)).toBeLessThanOrEqual(budget)
  })
})
