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
 *
 * AND A FOURTH, WHICH IS THE ONE THE SOLVER ACTUALLY GETS.
 *
 * The preference bonuses are negative, so weighted cost can go below zero. Inside
 * one squad that is harmless, because squad size is fixed at eleven and a constant
 * shift cannot reorder anything. Across a MULTI SQUAD solve it is a live bug: if a
 * squad can cost less than nothing, an optimiser choosing between seven squads and
 * eight sees the eighth as a gain and burns fodder for no reason.
 *
 * The fix is a re-parameterisation, not a clamp. A clamp would flatten two squads
 * that both came out negative and destroy the ordering the bonuses exist to
 * create. Instead every card carries a constant offset large enough to absorb the
 * worst possible bonus:
 *
 *     solverCost = weightedCost + offset,  offset = -(sum of the negative weights)
 *
 * Prices are never negative, so solverCost is never negative. The offset is the
 * same for every card, so an eleven card squad shifts by exactly 11 * offset and
 * the within squad ordering is IDENTICAL. Across squads the total grows with the
 * squad count, so an extra squad can never reduce the objective.
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
  /** Real cost plus preference bonuses. May be negative. For display and reasoning. */
  weightedCost: number
  /**
   * What is actually sent to the solver. weightedCost shifted by a constant so it
   * can never be negative. Same ordering within a squad, safe across many squads.
   */
  solverCost: number
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
 * The constant that makes the solver objective non negative.
 *
 * Equal to the most negative total the preference weights can contribute to one
 * card. Only the negative weights count: a positive weight cannot push a cost
 * below zero, so including it would inflate the offset for nothing.
 */
export function solverCostOffset(weights: CostWeights): number {
  const negatives =
    Math.min(0, weights.untradeableCost) +
    Math.min(0, weights.duplicateBonus) +
    Math.min(0, weights.sbcStorageBonus)
  return -negatives
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

  // A negative price would break the non negativity proof, and nothing sane
  // produces one, so it is treated as an input error rather than absorbed.
  if (price.coins < 0) {
    throw new RangeError(`a price cannot be negative, got ${price.coins} for ${card.definition.defId}`)
  }

  return {
    coinsSpent,
    valueBurned,
    weightedCost,
    solverCost: weightedCost + solverCostOffset(weights),
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
  solverCost: number
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
  let solverCost = 0
  let pricedFromData = 0
  let unpricedAtDefault = 0
  let oldest: string | null = null

  for (const cost of costs) {
    coinsSpent += cost.coinsSpent
    valueBurned += cost.valueBurned
    weightedCost += cost.weightedCost
    solverCost += cost.solverCost
    if (cost.basis === 'unknown_default') unpricedAtDefault += 1
    else pricedFromData += 1
    if (cost.asOf !== null && (oldest === null || cost.asOf < oldest)) oldest = cost.asOf
  }

  return {
    coinsSpent,
    valueBurned,
    weightedCost,
    solverCost,
    pricedFromData,
    unpricedAtDefault,
    oldestPriceAsOf: oldest,
  }
}
