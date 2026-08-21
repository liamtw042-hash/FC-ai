/**
 * Turning a solver answer into something a person reads.
 *
 * THE IMPORTANT PART IS THE RE-VALIDATION, not the layout. Every squad the
 * Python service returns is rebuilt here as a `Squad` and put back through the
 * TypeScript rules engine: `calculateSquadRating`, `calculateChemistry` and
 * `validateSquad`. The service is told what the rules are; it is never trusted
 * to have applied them. A mismatch between the two is printed as a MISMATCH in
 * capitals rather than quietly preferring one side.
 */

import { calculateChemistry } from '../rules/chemistry'
import { MAX_COPIES_PER_SQUAD, playerKeyOf } from '../rules/squadRules'
import { getFormation } from '../rules/formations'
import { calculateSquadRating } from '../rules/squadRating'
import { validateSquad } from '../rules/validateSquad'
import type { ResolvedCard } from '../types/cards'
import type { Requirement, RequirementResult } from '../types/requirements'
import type { Squad } from '../types/squad'
import type { WireDiagnosis, WirePlacement, WireSquad } from './solverClient'

export interface RebuiltSquad {
  squad: Squad
  rating: number
  chemistry: number
  results: RequirementResult[]
  /** Per player chemistry the service reported, when it did. */
  serviceChemistry: number | null
  mismatches: string[]
  /** Players used more than the per squad copy limit allows. */
  repeatedPlayers: { key: string; name: string; times: number }[]
}

export function rebuild(
  wire: WireSquad,
  formationName: string,
  byId: ReadonlyMap<string, ResolvedCard>,
  requirements: readonly Requirement[],
): RebuiltSquad {
  const formation = getFormation(formationName)
  const players = [...wire.placements]
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((placement: WirePlacement) => {
      const card = byId.get(placement.card_id)
      if (card === undefined) {
        throw new Error(
          `the solver returned card ${placement.card_id}, which is not in the pool it was sent`,
        )
      }
      return {
        card,
        slotIndex: placement.slot_index,
        slotPosition: placement.slot_position,
      }
    })

  const squad: Squad = { formation, players }
  const chemistry = calculateChemistry(players)
  const rating = calculateSquadRating(players.map((player) => player.card.definition.rating))
  const results = validateSquad(squad, requirements)

  const mismatches: string[] = []
  // Null means the service did not compute chemistry for this squad, which is not
  // a disagreement. Comparing a "not computed" against the engine's real value
  // reported a drift on every squad that had any chemistry at all, and a guard
  // that cries wolf gets ignored.
  const chemistryReported = wire.placements.some((placement) => placement.chemistry !== null)
  for (const placement of wire.placements) {
    const ours = chemistry.players.find((player) => player.slotIndex === placement.slot_index)
    if (ours === undefined) continue
    if (placement.chemistry !== null && placement.chemistry !== ours.chemistry) {
      mismatches.push(
        `slot ${placement.slot_index}: the solver scored ${placement.chemistry} chemistry, ` +
          `the rules engine makes it ${ours.chemistry}`,
      )
    }
    if (placement.in_position !== ours.inPosition) {
      mismatches.push(
        `slot ${placement.slot_index}: the solver called it ` +
          `${placement.in_position ? 'in' : 'out of'} position, the rules engine disagrees`,
      )
    }
  }

  // The copy limit, re-checked here for the same reason everything else is: the
  // service is TOLD the rule and is never trusted to have applied it. Before this
  // existed the solver would field one stack of eleven as an entire squad.
  const uses = new Map<string, { name: string; times: number }>()
  for (const player of players) {
    const key = playerKeyOf(player.card.definition)
    const seen = uses.get(key)
    if (seen === undefined) uses.set(key, { name: player.card.definition.name, times: 1 })
    else seen.times += 1
  }
  const repeatedPlayers = [...uses.entries()]
    .filter(([, entry]) => entry.times > MAX_COPIES_PER_SQUAD)
    .map(([key, entry]) => ({ key, name: entry.name, times: entry.times }))
  for (const repeat of repeatedPlayers) {
    mismatches.push(
      `${repeat.name} appears ${repeat.times} times in this squad, and the per squad ` +
        `limit is ${MAX_COPIES_PER_SQUAD}`,
    )
  }

  const serviceTotal = chemistryReported
    ? wire.placements.reduce((sum, placement) => sum + (placement.chemistry ?? 0), 0)
    : null
  return {
    squad,
    rating,
    chemistry: chemistry.total,
    results,
    serviceChemistry: serviceTotal,
    mismatches,
    repeatedPlayers,
  }
}

export interface SquadSpend {
  /** The weighted figure the solver minimised. NOT coins. */
  cost: number
  coinsSpent: number
  valueBurned: number
}

export function formatSquad(rebuilt: RebuiltSquad, index: number, spend: SquadSpend): string {
  // Three figures, each labelled. "23950 cost" on its own reads as coins, and it
  // is the weighted figure the solver minimised: with the untradeable weighting
  // applied it can be a fiftieth of what the cards list at.
  const lines = [
    `  Squad ${index}: rating ${rebuilt.rating}, chemistry ${rebuilt.chemistry}, ` +
      `${spend.coinsSpent} coins spent, ${spend.valueBurned} value burned ` +
      `(solver cost ${spend.cost}, weighted, not coins)`,
  ]
  // Once for the squad, not once per player. The per player figures are what the
  // ground truth fixtures record, so they are printed rather than the total alone.
  const perPlayer = new Map(
    calculateChemistry(rebuilt.squad.players).players.map((entry) => [
      entry.slotIndex,
      entry.chemistry,
    ]),
  )
  for (const player of rebuilt.squad.players) {
    const chemistry = perPlayer.get(player.slotIndex)
    const definition = player.card.definition
    const inPosition = player.card.effectivePositions.includes(player.slotPosition)
    lines.push(
      `    ${player.slotPosition.padEnd(4)} ${String(definition.rating).padStart(2)} ` +
        `${definition.name.padEnd(20)} ${(definition.club ?? 'no club').padEnd(16)} ` +
        `${(definition.league ?? 'no league').padEnd(18)} ${definition.nation.padEnd(12)} ` +
        `chem ${chemistry ?? 0}${inPosition ? '' : ' OUT OF POSITION'}`,
    )
  }
  if (rebuilt.mismatches.length > 0) {
    lines.push('    MISMATCH between the solver and the rules engine:')
    for (const mismatch of rebuilt.mismatches) lines.push(`      ${mismatch}`)
  }
  return lines.join('\n')
}

/** Achieved next to required, per requirement. Brief 6 and the results checklist. */
export function formatRequirements(results: readonly RequirementResult[]): string {
  if (results.length === 0) return '    (no requirements)'
  const width = Math.max(...results.map((result) => describe(result.requirement).length))
  return results
    .map((result) => {
      const mark = result.passed ? 'PASS' : 'FAIL'
      const achieved = result.achieved === null ? 'n/a' : String(result.achieved)
      const required = result.required === null ? 'n/a' : String(result.required)
      return `    ${mark}  ${describe(result.requirement).padEnd(width)}  achieved ${achieved}, required ${required}`
    })
    .join('\n')
}

export function describe(requirement: Requirement): string {
  const bits: string[] = [requirement.type]
  const extras = requirement as unknown as Record<string, unknown>
  for (const key of ['league', 'nation', 'club', 'cardType', 'promoName', 'quality', 'position']) {
    const value = extras[key]
    if (value !== undefined && value !== null) bits.push(`${key}=${String(value)}`)
  }
  if (extras.op !== undefined && extras.value !== undefined) {
    bits.push(`${String(extras.op)} ${String(extras.value)}`)
  } else if (extras.value !== undefined) {
    bits.push(String(extras.value))
  }
  if (extras.count !== undefined) bits.push(`count=${String(extras.count)}`)
  return bits.join(' ')
}

export function formatDiagnosis(diagnosis: WireDiagnosis): string {
  const lines = [`    Blocked by ${diagnosis.explanation}`]
  for (const limit of diagnosis.limits) lines.push(`      ${limit.description}`)
  for (const shortfall of diagnosis.supply) {
    const what = shortfall.rating === null ? 'cards' : `cards rated ${shortfall.rating}`
    const price =
      shortfall.unit_cost === null
        ? ', NO PRICE, so no coin figure is quoted'
        : `, ${shortfall.unit_cost} each from the ${shortfall.basis}`
    lines.push(`      short ${shortfall.missing} ${what}${price}`)
  }
  return lines.join('\n')
}

/**
 * Coins and value, never added together. Money that left the account and value
 * that was destroyed are different afternoons, and one figure hides which.
 */
export function formatSpend(coinsSpent: number, valueBurned: number, totalCost: number): string {
  return (
    `  ${coinsSpent} coins spent, ${valueBurned} value burned. ` +
    `Solver cost ${totalCost}, which is the weighted figure it minimised, not coins`
  )
}
