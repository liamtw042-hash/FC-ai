/**
 * Turning an imported club into the card list the solver is sent.
 *
 * Three jobs, in this order, and the order matters:
 *
 *   1. JOIN. An owned stack carries a defId and nothing else. Without its
 *      definition it has no rating, no positions and no league, so a stack whose
 *      definition is missing is REPORTED, never quietly dropped: eleven cards
 *      that silently vanished is how a solve comes back "impossible" for no
 *      visible reason.
 *   2. EXCLUDE. Loans and cards in active squads cannot be submitted; locked and
 *      auto locked cards are protections the owner chose. src/rules/exclusions.ts
 *      already decides all of that and reports what it caught.
 *   3. PRICE AND COST. src/solver/costModel.ts owns the whole cost model. This
 *      file calls it and copies the answer onto the wire shape. It does not
 *      compute a cost.
 */

import type { CardDefinition, OwnedCard, ResolvedCard } from '../types/cards'
import type { CardTypeRegistry } from '../rules/cardTypes'
import { defaultCardTypeRegistry } from '../rules/cardTypes'
import {
  DEFAULT_EXCLUSION_SETTINGS,
  assessAvailability,
  type AvailabilityReport,
  type ExclusionSettings,
} from '../rules/exclusions'
import { playerKeyOf } from '../rules/squadRules'
import { costOf } from '../solver/costModel'
import { DEFAULT_COST_WEIGHTS, type CostWeights, type ResolvedPrice } from '../types/solver'

/** The wire shape the Python service takes. Snake case, because it is Python. */
export interface WirePoolCard {
  id: string
  rating: number
  positions: string[]
  nation: string
  league: string | null
  club: string | null
  card_type: string
  promo_name: string | null
  is_rare: boolean
  is_totw: boolean
  is_evolved: boolean
  is_womens: boolean
  quantity: number
  /**
   * Which cards count as the same player for the per squad copy limit. Always
   * set, so the solver refuses a pool that arrived without one rather than
   * silently allowing a repeat. See src/rules/squadRules.ts.
   */
  player_key: string
  /** The weighted figure the solver minimises. NOT a coin price. */
  cost: number
  coins_spent: number
  value_burned: number
  /**
   * What one copy would cost to buy, in coins. The only field the shortfall
   * diagnosis prices a rating from, short of the price table. Null means
   * genuinely unpriced, and unpriced means no coin figure is quoted anywhere.
   */
  market_price: number | null
}

export interface BuildPoolOptions {
  prices: Record<number, number>
  registry?: CardTypeRegistry
  exclusions?: ExclusionSettings
  weights?: CostWeights
  /** Ratings with no price. Reported so no coin figure is ever invented. */
  onUnpriced?: (rating: number) => void
}

export interface PoolResult {
  cards: WirePoolCard[]
  availability: AvailabilityReport
  /** defIds in the club with no definition. Reported, never dropped in silence. */
  missingDefinitions: string[]
  /** Ratings held but not in the price table. */
  unpricedRatings: number[]
}

export function resolveClub(
  club: readonly OwnedCard[],
  definitions: readonly CardDefinition[],
  registry: CardTypeRegistry = defaultCardTypeRegistry,
): { resolved: ResolvedCard[]; missingDefinitions: string[] } {
  const byDefId = new Map(definitions.map((definition) => [definition.defId, definition]))
  const resolved: ResolvedCard[] = []
  const missing = new Set<string>()
  for (const owned of club) {
    const definition = byDefId.get(owned.defId)
    if (definition === undefined) {
      missing.add(owned.defId)
      continue
    }
    resolved.push({
      owned,
      definition,
      type: registry.get(definition.cardType),
      effectivePositions: owned.positionOverride ?? definition.positions,
    })
  }
  return { resolved, missingDefinitions: [...missing].sort() }
}

export function buildPool(
  club: readonly OwnedCard[],
  definitions: readonly CardDefinition[],
  options: BuildPoolOptions,
): PoolResult {
  const registry = options.registry ?? defaultCardTypeRegistry
  const weights = options.weights ?? DEFAULT_COST_WEIGHTS
  const { resolved, missingDefinitions } = resolveClub(club, definitions, registry)
  const availability = assessAvailability(resolved, options.exclusions ?? DEFAULT_EXCLUSION_SETTINGS)

  const unpriced = new Set<number>()
  const cards = availability.available.map((card): WirePoolCard => {
    const rating = card.definition.rating
    const listed = options.prices[rating]
    // An unpriced rating is NOT free and is not estimated either. It falls back
    // to what the card itself was imported at, and if that is missing too the
    // rating is reported so the caller can say so rather than quote a number.
    const coins = listed ?? card.owned.estimatedPrice
    if (listed === undefined && card.owned.estimatedPrice === null) {
      unpriced.add(rating)
      options.onUnpriced?.(rating)
    }
    const price: ResolvedPrice = {
      coins: coins ?? weights.unknownPriceDefault,
      basis: listed !== undefined ? 'rating_table' : coins !== null && coins !== undefined ? 'card_override' : 'unknown_default',
      asOf: null,
    }
    const cost = costOf(card, price, { weights, source: 'club' })
    return {
      id: card.owned.id,
      rating,
      positions: card.effectivePositions,
      nation: card.definition.nation,
      league: card.definition.league,
      club: card.definition.club,
      card_type: card.definition.cardType,
      promo_name: card.definition.promoName ?? null,
      is_rare: card.type.isRare,
      is_totw: card.type.isTotw,
      is_evolved: card.owned.isEvolved,
      is_womens: card.definition.isWomens,
      quantity: card.owned.quantity,
      player_key: playerKeyOf(card.definition),
      cost: cost.solverCost,
      coins_spent: cost.coinsSpent,
      value_burned: cost.valueBurned,
      market_price: coins ?? null,
    }
  })

  return {
    cards,
    availability,
    missingDefinitions,
    unpricedRatings: [...unpriced].sort((a, b) => a - b),
  }
}

/** Cheapest available card at each rating, for the enumerator's ordering. */
export function supplyAndPrices(cards: readonly WirePoolCard[]): {
  supply: Map<number, number>
  cheapest: Map<number, number>
} {
  const supply = new Map<number, number>()
  const cheapest = new Map<number, number>()
  for (const card of cards) {
    supply.set(card.rating, (supply.get(card.rating) ?? 0) + card.quantity)
    const current = cheapest.get(card.rating)
    if (current === undefined || card.cost < current) cheapest.set(card.rating, card.cost)
  }
  return { supply, cheapest }
}
