/**
 * Building a solve request and reading the answer back.
 *
 * Shared by the /api/solve and /api/queue handlers so the two cannot drift, and
 * deliberately the same sequence the command line runs: build the pool with the
 * cost model, enumerate the rating multisets in TypeScript, send them, then
 * re-validate every returned squad with the rules engine.
 */

import 'server-only'

import { calculateChemistry } from '../../src/rules/chemistry'
import { getFormation } from '../../src/rules/formations'
import { takeRatingCombinations } from '../../src/rules/ratingCombinations'
import { buildChemistryConfig } from '../../src/solver/chemistryConfig'
import { rebuild, describe as describeRequirement } from '../../src/cli/report'
import type { WireQueueResponse, WireRepeatResponse, WireSquad } from '../../src/cli/solverClient'
import type { ResolvedCard } from '../../src/types/cards'
import type { Requirement } from '../../src/types/requirements'
import { buildPool, resolveClub, state, supplyAndPrices, type SbcDefinition } from './server'

export interface PreparedSolve {
  pool: ReturnType<typeof buildPool>
  byId: Map<string, ResolvedCard>
  multisets: Record<number, number>[] | null
  /** Null when the club cannot reach the target rating at all. */
  problem: string | null
}

export function prepare(definition: SbcDefinition, combinations = 60): PreparedSolve {
  const current = state()
  const pool = buildPool(current.club, current.cards, { prices: current.prices })
  const { resolved } = resolveClub(current.club, current.cards)
  const byId = new Map(resolved.map((card) => [card.owned.id, card]))

  let multisets: Record<number, number>[] | null = null
  let problem: string | null = null
  if (definition.teamRating !== undefined) {
    const { supply, cheapest } = supplyAndPrices(pool.cards)
    const found = takeRatingCombinations(
      {
        target: definition.teamRating,
        availableRatings: [...supply.keys()],
        priceOf: (rating) => cheapest.get(rating) ?? 0,
        supplyOf: (rating) => supply.get(rating) ?? 0,
      },
      combinations,
    )
    if (found.length === 0) {
      problem =
        `no combination of the ratings you own reaches ${definition.teamRating}. ` +
        `That is a fact about the club, not about the requirements.`
    } else {
      multisets = found.map((combination) => Object.fromEntries(combination.counts))
    }
  }
  return { pool, byId, multisets, problem }
}

export interface SquadView {
  rating: number
  chemistry: number
  /** The weighted figure the solver minimised. NOT coins. The two below are. */
  cost: number
  coinsSpent: number
  valueBurned: number
  players: {
    /**
     * The owned stack this came from. Carried because the submission write back
     * has to take the RIGHT stack out of the club, and name plus rating does not
     * identify one: a base gold and a special card can share both.
     */
    cardId: string
    slot: string
    rating: number
    name: string
    club: string | null
    league: string | null
    nation: string
    chemistry: number
    inPosition: boolean
  }[]
  requirements: { label: string; passed: boolean; achieved: string; required: string }[]
  mismatches: string[]
}

/**
 * Every squad the service returns, put back through the TypeScript engine.
 *
 * This is the invariant, not a nicety: the Python service is a constraint
 * compiler that was told what the rules are, and it is never trusted to have
 * applied them. Where the two disagree the disagreement is shown.
 */
export function view(
  squad: WireSquad,
  formation: string,
  byId: Map<string, ResolvedCard>,
  requirements: readonly Requirement[],
): SquadView {
  const rebuilt = rebuild(squad, formation, byId, requirements)
  const slots = getFormation(formation).slots
  // The ENGINE's per player values, computed once. The service may not have
  // computed any, and where it did, the engine is the authoritative one.
  const perPlayer = new Map(
    calculateChemistry(rebuilt.squad.players).players.map((entry) => [
      entry.slotIndex,
      entry.chemistry,
    ]),
  )
  return {
    rating: rebuilt.rating,
    chemistry: rebuilt.chemistry,
    cost: squad.cost,
    coinsSpent: squad.coins_spent,
    valueBurned: squad.value_burned,
    players: rebuilt.squad.players.map((player) => {
      return {
        cardId: player.card.owned.id,
        slot: slots[player.slotIndex] ?? player.slotPosition,
        rating: player.card.definition.rating,
        name: player.card.definition.name,
        club: player.card.definition.club,
        league: player.card.definition.league,
        nation: player.card.definition.nation,
        chemistry: perPlayer.get(player.slotIndex) ?? 0,
        inPosition: player.card.effectivePositions.includes(player.slotPosition),
      }
    }),
    requirements: rebuilt.results.map((result) => ({
      label: describeRequirement(result.requirement),
      passed: result.passed,
      achieved: result.achieved === null ? 'n/a' : String(result.achieved),
      required: result.required === null ? 'n/a' : String(result.required),
    })),
    mismatches: rebuilt.mismatches,
  }
}

export function chemistryConfig(): ReturnType<typeof buildChemistryConfig> {
  return buildChemistryConfig()
}

export type { WireQueueResponse, WireRepeatResponse }
