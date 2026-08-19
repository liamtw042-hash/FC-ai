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

/**
 * Prices. See RESEARCH.md 8.1.
 *
 * The primary model is a price BY RATING table, not per card prices. For SBC solving
 * the cost of a specific card is almost never the question, because fodder is fungible.
 * The question is the cheapest price at each rating, which is about 40 numbers that can
 * be typed in five minutes and refreshed weekly. Per card overrides layer on top for
 * anything genuinely expensive or specific.
 *
 * FutDB prices are premium only with no bulk endpoint, so the file backed provider is
 * the primary implementation. The interface stays intact so a premium FutDB provider
 * can drop in later without touching the cost model.
 */

/** The cheapest going rate at one rating. The optional second dimension is rarity. */
export interface RatingPrice {
  rating: number
  /** Cheapest at this rating regardless of rarity. */
  coins: number
  /** Set only where the rare and common gap is worth modelling. */
  rareCoins?: number
  commonCoins?: number
}

/** The whole table, stamped so staleness is visible in the UI. */
export interface PriceByRatingTable {
  /** ISO 8601. Surfaced in the UI so I know when this has gone stale. */
  lastUpdated: string
  /** Keyed by rating, roughly 60 to 99. */
  entries: RatingPrice[]
}

/** An override for one specific card, layered on top of the rating table. */
export interface CardPriceOverride {
  defId: string
  coins: number
  /** ISO 8601. */
  fetchedAt: string
  source: 'file' | 'manual' | 'futdb'
}

/** What the cost model actually consumes for one card. */
export interface ResolvedPrice {
  coins: number
  /** How this number was arrived at, so the UI can label an estimate as an estimate. */
  basis: 'card_override' | 'rating_table' | 'unknown_default'
  /** ISO 8601, from whichever source supplied the number. */
  asOf: string | null
}

export interface PriceProvider {
  readonly name: string
  /** The rating table is the primary path. */
  getRatingTable(): Promise<PriceByRatingTable>
  /** Overrides for specific cards, empty when none are configured. */
  getOverrides(): Promise<Map<string, CardPriceOverride>>
  /** Resolution order: card override, then rating table, then unknownPriceDefault. */
  resolve(defId: string, rating: number): Promise<ResolvedPrice>
}
