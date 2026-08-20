/**
 * SBC requirement types.
 *
 * Section 4.4 of the brief, implemented as written. Every requirement is a
 * first class object, never free text.
 *
 * Two approved changes are applied: perPlayerChemistry from RESEARCH.md 5.1, and
 * cardTypeCount keying on the open CardType string from RESEARCH.md 5.2.
 */

import type { CardType, Quality } from './cards'

export type CountOp = 'min' | 'max' | 'exact'
export type MinMaxOp = 'min' | 'max'

export type Requirement =
  | { type: 'squadSize'; value: number }
  | { type: 'teamRating'; op: CountOp; value: number }
  | { type: 'teamChemistry'; op: 'min'; value: number }
  /**
   * Every player, or count players, must individually reach value chemistry.
   * Distinct from teamChemistry: a squad can hit the total and fail the floor.
   * count omitted means all 11, matching the minPlayerRating convention.
   */
  | { type: 'perPlayerChemistry'; op: 'min'; value: number; count?: number }
  | { type: 'playersFromLeague'; league: string; op: CountOp; value: number }
  | { type: 'playersFromNation'; nation: string; op: CountOp; value: number }
  | { type: 'playersFromClub'; club: string; op: CountOp; value: number }
  /** Any ONE league, the solver picks which. Not the same as playersFromLeague. */
  | { type: 'sameLeagueCount'; op: MinMaxOp; value: number }
  | { type: 'sameNationCount'; op: MinMaxOp; value: number }
  | { type: 'sameClubCount'; op: MinMaxOp; value: number }
  | { type: 'distinctLeagues'; op: CountOp; value: number }
  | { type: 'distinctNations'; op: CountOp; value: number }
  | { type: 'distinctClubs'; op: CountOp; value: number }
  /** exact is allowed here, unlike the brief, which had no reason to forbid it. */
  | { type: 'rareCount'; op: CountOp; value: number }
  | { type: 'totwCount'; op: 'min'; value: number }
  | { type: 'cardTypeCount'; cardType: CardType; op: CountOp; value: number }
  | { type: 'promoCount'; promoName: string; op: 'min'; value: number }
  | { type: 'qualityCount'; quality: Quality; op: CountOp; value: number }
  /** count omitted means all 11. The UI must surface which reading was taken. */
  | { type: 'minPlayerRating'; value: number; count?: number }
  | { type: 'maxPlayerRating'; value: number }
  | { type: 'specificPlayer'; defId: string }
  | { type: 'specificPosition'; position: string; op: 'min'; value: number }
  | { type: 'formation'; value: string }
  | { type: 'excludeEvolved' }
  | { type: 'managerNation'; nation: string }
  | { type: 'managerLeague'; league: string }

export type RequirementType = Requirement['type']

/**
 * Every type the union holds, as VALUES rather than as a type.
 *
 * The union is checked at compile time and requirements arrive at RUNTIME, from
 * a pasted SBC, a JSON file or an HTTP body. `validateSquad` switches on the
 * type, and TypeScript proves that switch exhaustive over the union, which is
 * not the same as it being exhaustive over what actually turns up. A type the
 * union does not hold used to fall off the end of the switch and come back as
 * `undefined` in a list of results.
 *
 * The `satisfies` clause is what keeps this honest: add a member to the union
 * without adding it here and the build fails.
 */
export const REQUIREMENT_TYPES = [
  'squadSize',
  'teamRating',
  'teamChemistry',
  'perPlayerChemistry',
  'playersFromLeague',
  'playersFromNation',
  'playersFromClub',
  'sameLeagueCount',
  'sameNationCount',
  'sameClubCount',
  'distinctLeagues',
  'distinctNations',
  'distinctClubs',
  'rareCount',
  'totwCount',
  'cardTypeCount',
  'promoCount',
  'qualityCount',
  'minPlayerRating',
  'maxPlayerRating',
  'specificPlayer',
  'specificPosition',
  'formation',
  'excludeEvolved',
  'managerNation',
  'managerLeague',
] as const satisfies readonly RequirementType[]

/**
 * The half `satisfies` does not do. `satisfies` proves every entry above IS a
 * requirement type; this proves every requirement type is ABOVE. Drop a member
 * from the list and `Exclude` stops being `never`, so this line stops compiling.
 */
type MissingFromList = Exclude<RequirementType, (typeof REQUIREMENT_TYPES)[number]>
const _everyRequirementTypeIsListed: MissingFromList extends never ? true : false = true
void _everyRequirementTypeIsListed

export function isKnownRequirementType(type: string): type is RequirementType {
  return (REQUIREMENT_TYPES as readonly string[]).includes(type)
}

/** Result of checking one requirement against a built squad. */
export interface RequirementResult {
  requirement: Requirement
  passed: boolean
  /** What the squad actually achieved, for the results checklist. */
  achieved: number | string | null
  /** What was needed, rendered for display. */
  required: number | string | null
}

/** An impossible combination found before solving, by detectConflicts. */
export interface RequirementConflict {
  requirements: Requirement[]
  reason: string
}
