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
  for (const placement of wire.placements) {
    const ours = chemistry.players.find((player) => player.slotIndex === placement.slot_index)
    if (ours === undefined) continue
    if (placement.chemistry !== ours.chemistry) {
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

  const serviceTotal = wire.placements.reduce((sum, placement) => sum + placement.chemistry, 0)
  return {
    squad,
    rating,
    chemistry: chemistry.total,
    results,
    serviceChemistry: serviceTotal,
    mismatches,
  }
}

export function formatSquad(rebuilt: RebuiltSquad, index: number, cost: number): string {
  const lines = [`  Squad ${index}: rating ${rebuilt.rating}, chemistry ${rebuilt.chemistry}, ${cost} cost`]
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
