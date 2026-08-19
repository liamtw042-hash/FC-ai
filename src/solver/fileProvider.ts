/**
 * The file backed price provider, which is the PRIMARY implementation. See
 * RESEARCH.md 8.1.
 *
 * Prices are a table keyed on rating, roughly forty numbers, with per card
 * overrides on top. For SBC solving the cost of a specific card is almost never
 * the question, because fodder is fungible. The question is the cheapest price at
 * each rating.
 *
 * Resolution order: card override, then rating table, then unknownPriceDefault.
 * An unpriced card is NEVER free.
 */

import type {
  CardPriceOverride,
  PriceByRatingTable,
  PriceProvider,
  ResolvedPrice,
} from '../types/solver'
import { DEFAULT_COST_WEIGHTS } from '../types/solver'

export interface FilePriceData {
  table: PriceByRatingTable
  overrides?: CardPriceOverride[]
}

export class FilePriceProvider implements PriceProvider {
  readonly name = 'file'

  private readonly byRating: Map<number, number>
  private readonly overrides: Map<string, CardPriceOverride>

  constructor(
    private readonly data: FilePriceData,
    private readonly unknownPriceDefault: number = DEFAULT_COST_WEIGHTS.unknownPriceDefault,
  ) {
    this.byRating = new Map(data.table.entries.map((entry) => [entry.rating, entry.coins]))
    this.overrides = new Map((data.overrides ?? []).map((o) => [o.defId, o]))
  }

  async getRatingTable(): Promise<PriceByRatingTable> {
    return this.data.table
  }

  async getOverrides(): Promise<Map<string, CardPriceOverride>> {
    return new Map(this.overrides)
  }

  async resolve(defId: string, rating: number): Promise<ResolvedPrice> {
    const override = this.overrides.get(defId)
    if (override !== undefined) {
      return { coins: override.coins, basis: 'card_override', asOf: override.fetchedAt }
    }
    const fromTable = this.byRating.get(rating)
    if (fromTable !== undefined) {
      return { coins: fromTable, basis: 'rating_table', asOf: this.data.table.lastUpdated }
    }
    // Never free. An unpriced card that costs nothing would be picked first and
    // would make every reported total a lie.
    return { coins: this.unknownPriceDefault, basis: 'unknown_default', asOf: null }
  }

  /** Days since the rating table was refreshed, for the staleness badge. */
  ageInDays(now: Date): number | null {
    const stamped = Date.parse(this.data.table.lastUpdated)
    if (Number.isNaN(stamped)) return null
    return Math.floor((now.getTime() - stamped) / 86_400_000)
  }
}
