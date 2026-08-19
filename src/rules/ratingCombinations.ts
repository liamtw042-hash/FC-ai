/**
 * Rating combination enumeration. Brief 5.
 *
 * The squad rating depends only on the multiset of ratings, never on which cards
 * carry them. That property is asserted in squadRating.test.ts and it is what
 * makes this decomposition legal: choose the rating multiset first, then worry
 * about which real cards fill it.
 *
 * WHY THIS IS A LAZY BEST FIRST SEARCH AND NOT A LIST.
 *
 * The brief says enumerate every multiset producing the target, then order by
 * lower bound and prune. Enumerating first does not survive contact with the
 * numbers: eleven slots from a 19 wide band is C(29,11), about 34.6 million
 * multisets before any filtering, and a prototype that tried it ran for five
 * minutes without finishing. Every guarantee the brief wanted is kept and only
 * the eager list is dropped. Combinations come out in ascending cost, generated
 * on demand, so the solver stops the moment the next bound cannot beat the best
 * squad it already holds. Still provably cheapest.
 *
 * HOW IT IS FAST.
 *
 * Two exact devices, no heuristics that might be wrong.
 *
 * 1. An exact cost to go table. dp[i][m][rem] is the true cheapest way to take m
 *    more cards, summing to exactly rem, from the ratings at index i and beyond.
 *    Using it as the search priority makes the ordering exactly ascending cost
 *    and stops the heap from exploring anything that cannot be on a cheap path.
 *    Computed once, independent of the target sum.
 *
 * 2. An exact algebraic gate. Fix the squad total SUM and the average is fixed at
 *    SUM/11, so "above the average" is a fixed partition of the rating values. Walk
 *    the values in descending order and the moment the walk crosses below the
 *    average, the count above (k) and their sum (A) are final. The squad rating is
 *    then fully determined, because
 *
 *        N = SUM * (11 - k) + 11 * A,     T = round(N / 11),     rating = floor(T / 11)
 *
 *    so the whole subtree can be accepted or discarded on the spot rather than
 *    being walked to the leaves and tested there.
 */

import { SQUAD_SIZE, calculateSquadRating } from './squadRating'

export interface RatingCombination {
  /** Eleven ratings, descending. */
  ratings: number[]
  /** Distinct rating to how many of them. */
  counts: Map<number, number>
  /**
   * Cheapest conceivable cost of filling this multiset, using the cheapest
   * available card at each rating. A real solution can only cost more.
   */
  lowerBound: number
}

export interface EnumerateOptions {
  target: number
  /** Distinct ratings actually owned. Nothing outside this is ever proposed. */
  availableRatings: readonly number[]
  /** Cheapest available card at a rating. Drives the bound and the ordering. */
  priceOf?: (rating: number) => number
  /**
   * How many cards are owned at a rating. Stops the enumerator proposing eleven
   * 91s when three are owned, which would make the lower bound a lie.
   */
  supplyOf?: (rating: number) => number
  /** Default target minus 12 to target plus 6. */
  bandBelow?: number
  bandAbove?: number
}

export const DEFAULT_BAND_BELOW = 12
export const DEFAULT_BAND_ABOVE = 6

/**
 * Largest correction factor a squad drawn from [lo, hi] can produce.
 *
 * With k players at hi and 11 - k at lo, CF is k(11 - k)(hi - lo) / 11, peaking
 * at k = 5 or 6. Used to bound SUM from below, since a large CF is exactly what
 * lets a low SUM still reach the target.
 */
export function maxCorrectionFactor(lo: number, hi: number): number {
  const spread = Math.max(0, hi - lo)
  let best = 0
  for (let k = 0; k <= SQUAD_SIZE; k += 1) {
    const cf = (k * (SQUAD_SIZE - k) * spread) / SQUAD_SIZE
    if (cf > best) best = cf
  }
  return best
}

/** The integer window N must land in for the squad to rate exactly target. */
export function nWindowFor(target: number): { lo: number; hi: number } {
  // rating = floor(T / 11) = target means T is in [11 target, 11 target + 10].
  // T = round(N / 11) means N is in [11 T - 5, 11 T + 5] for integer N.
  return { lo: 121 * target - 5, hi: 11 * (SQUAD_SIZE * target + SQUAD_SIZE - 1) + 5 }
}

interface Node {
  /** Squad total this branch is committed to. */
  sum: number
  index: number
  cardsLeft: number
  /** Ratings still to be accounted for in this branch's total. */
  remaining: number
  cost: number
  /** True cost including the exact cheapest completion. Drives the heap order. */
  priority: number
  /** Count and sum of the ratings above this branch's average, once settled. */
  above: number
  aboveSum: number
  counts: Int8Array
}

class MinHeap {
  private readonly items: Node[] = []

  get size(): number {
    return this.items.length
  }

  push(node: Node): void {
    const items = this.items
    items.push(node)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent]!.priority <= items[i]!.priority) break
      ;[items[parent], items[i]] = [items[i]!, items[parent]!]
      i = parent
    }
  }

  pop(): Node | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < items.length && items[left]!.priority < items[smallest]!.priority) smallest = left
        if (right < items.length && items[right]!.priority < items[smallest]!.priority) smallest = right
        if (smallest === i) break
        ;[items[smallest], items[i]] = [items[i]!, items[smallest]!]
        i = smallest
      }
    }
    return top
  }
}

const IMPOSSIBLE = Number.POSITIVE_INFINITY

/**
 * dp[i][m][rem]: cheapest way to take m cards summing to exactly rem, drawn from
 * values[i..]. Exact, so it is both the pruning test and the search priority.
 */
function buildCostToGo(
  values: readonly number[],
  prices: readonly number[],
  supply: readonly number[],
  maxSum: number,
): Float64Array[][] {
  const n = values.length
  const table: Float64Array[][] = []
  for (let i = 0; i <= n; i += 1) {
    const perCards: Float64Array[] = []
    for (let m = 0; m <= SQUAD_SIZE; m += 1) {
      perCards.push(new Float64Array(maxSum + 1).fill(IMPOSSIBLE))
    }
    table.push(perCards)
  }
  table[n]![0]![0] = 0

  for (let i = n - 1; i >= 0; i -= 1) {
    const value = values[i]!
    const price = prices[i]!
    const cap = supply[i]!
    for (let m = 0; m <= SQUAD_SIZE; m += 1) {
      const row = table[i]![m]!
      for (let rem = 0; rem <= maxSum; rem += 1) {
        let best = IMPOSSIBLE
        const maxTake = Math.min(m, cap, Math.floor(rem / value))
        for (let take = 0; take <= maxTake; take += 1) {
          const rest = table[i + 1]![m - take]![rem - take * value]!
          if (rest === IMPOSSIBLE) continue
          const total = rest + take * price
          if (total < best) best = total
        }
        row[rem] = best
      }
    }
  }
  return table
}

export function* enumerateRatingCombinations(
  options: EnumerateOptions,
): Generator<RatingCombination> {
  const {
    target,
    availableRatings,
    priceOf = () => 0,
    supplyOf = () => Number.POSITIVE_INFINITY,
    bandBelow = DEFAULT_BAND_BELOW,
    bandAbove = DEFAULT_BAND_ABOVE,
  } = options

  const values = [...new Set(availableRatings)]
    .filter((r) => r >= target - bandBelow && r <= target + bandAbove && r > 0)
    .sort((a, b) => b - a)
  if (values.length === 0) return

  const n = values.length
  const prices = values.map(priceOf)
  const supply = values.map((v) => Math.min(SQUAD_SIZE, Math.max(0, Math.floor(supplyOf(v)))))
  if (supply.reduce((a, b) => a + b, 0) < SQUAD_SIZE) return

  const highest = values[0]!
  const lowest = values[n - 1]!
  const sumCeiling = SQUAD_SIZE * target + SQUAD_SIZE - 1
  const sumFloor = Math.max(
    SQUAD_SIZE * lowest,
    Math.ceil(SQUAD_SIZE * target - 0.5 - maxCorrectionFactor(lowest, highest)),
  )
  const maxSum = Math.min(sumCeiling, SQUAD_SIZE * highest)
  if (maxSum < sumFloor) return

  const dp = buildCostToGo(values, prices, supply, maxSum)
  const window = nWindowFor(target)
  const heap = new MinHeap()

  // One root per candidate squad total. Fixing SUM is what makes the "above the
  // average" partition, and therefore the rating, decidable partway down.
  for (let sum = sumFloor; sum <= maxSum; sum += 1) {
    const floorCost = dp[0]![SQUAD_SIZE]![sum]!
    if (floorCost === IMPOSSIBLE) continue
    heap.push({
      sum,
      index: 0,
      cardsLeft: SQUAD_SIZE,
      remaining: sum,
      cost: 0,
      priority: floorCost,
      above: 0,
      aboveSum: 0,
      counts: new Int8Array(n),
    })
  }

  while (heap.size > 0) {
    const node = heap.pop()!

    if (node.cardsLeft === 0) {
      const ratings: number[] = []
      const counts = new Map<number, number>()
      for (let i = 0; i < n; i += 1) {
        const count = node.counts[i]!
        if (count === 0) continue
        counts.set(values[i]!, count)
        for (let c = 0; c < count; c += 1) ratings.push(values[i]!)
      }
      yield { ratings, counts, lowerBound: node.cost }
      continue
    }

    if (node.index >= n) continue

    const value = values[node.index]!

    // The algebraic gate. Descending order means that once this value sits at or
    // below the average, every value left does too, so k and A are final and the
    // rating is decided here rather than eleven levels down.
    if (SQUAD_SIZE * value <= node.sum) {
      const nValue = node.sum * (SQUAD_SIZE - node.above) + SQUAD_SIZE * node.aboveSum
      if (nValue < window.lo || nValue > window.hi) continue
    }

    const price = prices[node.index]!
    const isAbove = SQUAD_SIZE * value > node.sum
    const maxTake = Math.min(node.cardsLeft, supply[node.index]!, Math.floor(node.remaining / value))

    for (let take = 0; take <= maxTake; take += 1) {
      const cardsLeft = node.cardsLeft - take
      const remaining = node.remaining - take * value
      const completion = dp[node.index + 1]![cardsLeft]![remaining]!
      if (completion === IMPOSSIBLE) continue
      const cost = node.cost + take * price
      const counts = node.counts.slice()
      counts[node.index] = take
      heap.push({
        sum: node.sum,
        index: node.index + 1,
        cardsLeft,
        remaining,
        cost,
        priority: cost + completion,
        above: isAbove ? node.above + take : node.above,
        aboveSum: isAbove ? node.aboveSum + take * value : node.aboveSum,
        counts,
      })
    }
  }
}

/** Convenience for tests and the UI. Pulls at most limit combinations. */
export function takeRatingCombinations(
  options: EnumerateOptions,
  limit: number,
): RatingCombination[] {
  const out: RatingCombination[] = []
  if (limit <= 0) return out
  for (const combination of enumerateRatingCombinations(options)) {
    out.push(combination)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Cache per target, as the brief asks. Combinations for a given target, band and
 * pool never change, so a repeat solve pays nothing. Prices affect ORDER, so they
 * are part of the key.
 */
export class RatingCombinationCache {
  private readonly entries = new Map<string, RatingCombination[]>()

  private static key(options: EnumerateOptions, limit: number): string {
    const ratings = [...new Set(options.availableRatings)].sort((a, b) => a - b)
    const priced = ratings.map(
      (r) => `${r}:${options.priceOf?.(r) ?? 0}:${options.supplyOf?.(r) ?? -1}`,
    )
    return [
      options.target,
      options.bandBelow ?? DEFAULT_BAND_BELOW,
      options.bandAbove ?? DEFAULT_BAND_ABOVE,
      limit,
      priced.join(','),
    ].join('|')
  }

  take(options: EnumerateOptions, limit: number): RatingCombination[] {
    const key = RatingCombinationCache.key(options, limit)
    const hit = this.entries.get(key)
    if (hit !== undefined) return hit
    const computed = takeRatingCombinations(options, limit)
    this.entries.set(key, computed)
    return computed
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }
}

/** Exported for the round trip test, which the brief calls non negotiable. */
export function evaluatesToTarget(combination: RatingCombination, target: number): boolean {
  return calculateSquadRating(combination.ratings) === target
}
