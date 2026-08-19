/**
 * SBC requirement types.
 *
 * Section 4.4 of the brief, implemented as written. Every requirement is a
 * first class object, never free text.
 *
 * RESEARCH.md 5.1 proposes one addition, perPlayerChemistry, which real SBCs use
 * and which teamChemistry cannot express. It is not added here pending a decision.
 */

import type { Rarity, Quality } from './cards'

export type CountOp = 'min' | 'max' | 'exact'
export type MinMaxOp = 'min' | 'max'

export type Requirement =
  | { type: 'squadSize'; value: number }
  | { type: 'teamRating'; op: CountOp; value: number }
  | { type: 'teamChemistry'; op: 'min'; value: number }
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
  | { type: 'rareCount'; op: MinMaxOp; value: number }
  | { type: 'totwCount'; op: 'min'; value: number }
  | { type: 'cardTypeCount'; rarity: Rarity; op: MinMaxOp; value: number }
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
