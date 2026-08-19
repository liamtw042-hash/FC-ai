/**
 * What a card costs to burn. Brief 8.
 *
 * TWO NUMBERS, NEVER BLENDED.
 *
 *   coinsSpent   coins actually leaving the wallet, market purchases only
 *   valueBurned  market value of tradeable club cards consumed
 *
 * They are not the same kind of thing. Feeding an untradeable duplicate costs
 * nothing on either count: no coins leave, and nothing sellable was destroyed.
 * Feeding a tradeable 88 costs no coins but burns whatever it would have sold
 * for. Blending them into one "cost" hides which of those just happened.
 *
 * The solver optimises a THIRD number, the weighted cost, which is the real cost
 * plus preference bonuses. That one is a preference ordering and is never shown
 * as money.
 */

import type { ResolvedCard } from '../types/cards'
import type { CostWeights, PriceProvider, ResolvedPrice } from '../types/solver'
import { DEFAULT_COST_WEIGHTS } from '../types/solver'

export type CardSource = 'club' | 'market'

export interface CardCost {
  /** Coins leaving the wallet for one copy. */
  coinsSpent: number
  /** Market value destroyed by consuming one copy. */
  valueBurned: number
  /** What the solver minimises. Can be negative, which is the point. */
  weightedCost: number
  /** How the price was arrived at, so the UI can label an estimate as an estimate. */
  basis: ResolvedPrice['basis']
  asOf: string | null
}

export interface CostContext {
  weights: CostWeights
  /** Where this copy comes from. Market top up is off unless the caller says so. */
  source: CardSource
}

/**
 * Preference order from brief 8: untradeable duplicates, then SBC storage, then
 * unused tradeable club cards, then market top up.
 *
 * Expressed as bonuses rather than as a sort, because the solver has to trade
 * preference against price. A cheap tradeable card can still beat an untradeable
 * one, and it should.
 */
export function costOf(
  card: ResolvedCard,
  price: ResolvedPrice,
  context: CostContext = { weights: DEFAULT_COST_WEIGHTS, source: 'club' },
): CardCost {
  const { weights, source } = context
  const { owned } = card

  let coinsSpent = 0
  let valueBurned = 0

  if (source === 'market') {
    coinsSpent = price.coins
  } else if (owned.untradeable) {
    // Cannot be sold, so nothing sellable is destroyed and no coins move.
    // weights.untradeableCost exists to let that be overridden deliberately.
    valueBurned = 0
  } else {
    valueBurned = price.coins
  }

  let weightedCost = source === 'market' ? price.coins : owned.untradeable ? weights.untradeableCost : price.coins

  // A duplicate is the cheapest thing in the club to lose, whatever it lists for.
  if (owned.quantity > 1) weightedCost += weights.duplicateBonus
  if (owned.pool === 'sbc_storage') weightedCost += weights.sbcStorageBonus

  return {
    coinsSpent,
    valueBurned,
    weightedCost,
    basis: price.basis,
    asOf: price.asOf,
  }
}

export interface PricedCard {
  card: ResolvedCard
  cost: CardCost
}

/** Prices a whole pool in one pass, so the provider is hit once per card. */
export async function pricePool(
  cards: readonly ResolvedCard[],
  provider: PriceProvider,
  context: CostContext = { weights: DEFAULT_COST_WEIGHTS, source: 'club' },
): Promise<PricedCard[]> {
  const priced: PricedCard[] = []
  for (const card of cards) {
    const price = await provider.resolve(card.definition.defId, card.definition.rating)
    priced.push({ card, cost: costOf(card, price, context) })
  }
  return priced
}

export interface CostSummary {
  coinsSpent: number
  valueBurned: number
  weightedCost: number
  /** How many of the eleven were priced from a real number rather than the default. */
  pricedFromData: number
  unpricedAtDefault: number
  /** Oldest price stamp used, so staleness surfaces. */
  oldestPriceAsOf: string | null
}

export function summarise(costs: readonly CardCost[]): CostSummary {
  let coinsSpent = 0
  let valueBurned = 0
  let weightedCost = 0
  let pricedFromData = 0
  let unpricedAtDefault = 0
  let oldest: string | null = null

  for (const cost of costs) {
    coinsSpent += cost.coinsSpent
    valueBurned += cost.valueBurned
    weightedCost += cost.weightedCost
    if (cost.basis === 'unknown_default') unpricedAtDefault += 1
    else pricedFromData += 1
    if (cost.asOf !== null && (oldest === null || cost.asOf < oldest)) oldest = cost.asOf
  }

  return { coinsSpent, valueBurned, weightedCost, pricedFromData, unpricedAtDefault, oldestPriceAsOf: oldest }
}
