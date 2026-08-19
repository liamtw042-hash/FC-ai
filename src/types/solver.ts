/**
 * Solver configuration.
 *
 * Time budgets are split by scope. See RESEARCH.md 5.4: a single challenge and a
 * joint queue solve are different problems and cannot share one wall clock promise.
 */

export type RatingMode = 'exact' | 'minimum'

export interface TimeBudget {
  /** Single challenge target. 5 seconds on a 600 card club. */
  singleSolveSeconds: number
  /** Queue and repeat modes. Anytime, with progress reporting. */
  queueSolveSeconds: number
}

export const DEFAULT_TIME_BUDGET: TimeBudget = {
  singleSolveSeconds: 5,
  queueSolveSeconds: 60,
}

export interface CostWeights {
  untradeableCost: number
  /** Negative, so burning duplicates is preferred. */
  duplicateBonus: number
  sbcStorageBonus: number
  /** Never treat an unpriced card as free. */
  unknownPriceDefault: number
  overshootPenaltyPerPoint: number
}

export const DEFAULT_COST_WEIGHTS: CostWeights = {
  untradeableCost: 0,
  duplicateBonus: -100,
  sbcStorageBonus: -50,
  unknownPriceDefault: 1000,
  overshootPenaltyPerPoint: 50,
}

/** A price, always stamped with when it was fetched. Prices are indicative, not live. */
export interface PricePoint {
  defId: string
  coins: number
  /** ISO 8601. FutDB refreshes between 30 minutes and 24 hours depending on the card. */
  fetchedAt: string
  source: 'futdb' | 'file' | 'manual'
}

/** File backed by default. FutDB is an optional provider behind the same interface. */
export interface PriceProvider {
  readonly name: string
  get(defId: string): Promise<PricePoint | null>
  getMany(defIds: string[]): Promise<Map<string, PricePoint>>
}
