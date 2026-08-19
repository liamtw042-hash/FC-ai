/**
 * Squad, chemistry and solve result types.
 */

import type { ResolvedCard } from './cards'
import type { Requirement, RequirementResult } from './requirements'

/** A formation, as its name plus the 11 position slots it fields. */
export interface Formation {
  name: string
  /** Exactly 11 position codes, index 0 is the goalkeeper slot. */
  slots: string[]
}

/** One starter placed into one slot. */
export interface PlacedPlayer {
  card: ResolvedCard
  slotIndex: number
  slotPosition: string
  /**
   * The positioning gate. False means this player earns 0 chemistry AND
   * contributes nothing to anyone else's thresholds.
   */
  inPosition: boolean
  /** 0 to 3. */
  chemistry: number
}

/** An optional manager. Off by default. */
export interface Manager {
  nation: string
  league: string
}

export interface Squad {
  formation: Formation
  players: PlacedPlayer[]
  manager?: Manager
}

export interface SquadEvaluation {
  /** Section 4.1. floor(round(SUM + CF) / 11). */
  rating: number
  /** Sum over the 11 starters, capped at 3 each, so at most 33. */
  chemistry: number
  perPlayerChemistry: number[]
}

/** One entry in tests/fixtures/ground-truth.json. */
export interface GroundTruthFixture {
  id: string
  description: string
  formation: string
  /** 11 entries, in slot order. */
  players: { defId: string; rating: number; position: string }[]
  /** What the game actually displayed. The fixture is right, the engine is wrong. */
  displayedRating: number
  displayedChemistry: number
  source: string
}

export interface Solution {
  squad: Squad
  evaluation: SquadEvaluation
  requirements: RequirementResult[]
  /** Market purchases only. */
  coinsSpent: number
  /** Market value of tradeable club cards consumed. Never blended with coinsSpent. */
  valueBurned: number
  /** False when the solve hit its time budget before proving optimality. */
  provenOptimal: boolean
}

export interface Challenge {
  id: string
  name: string
  requirements: Requirement[]
  reward?: string
  expiry?: string
  repeatable: boolean
}
