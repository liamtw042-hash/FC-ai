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
  /** Section 4.1. floor(round(SUM + CF) / 11). Step 5 is floor, see RESEARCH.md 4.1. */
  rating: number
  /** Sum over the 11 starters, capped at 3 each, so at most 33. */
  chemistry: number
  perPlayerChemistry: number[]
}

/** One player row in a ground truth fixture. */
export interface GroundTruthPlayer {
  /** Null for a fixture that only exercises the rating path, where identity is irrelevant. */
  defId: string | null
  name: string | null
  rating: number
  /** The slot this player was placed in. */
  slotPosition: string
}

/**
 * One entry in tests/fixtures/ground-truth.json.
 *
 * The fixture is right and the engine is wrong. If a fixture fails, fix the engine.
 *
 * Per player chemistry is recorded, not just the total. See RESEARCH.md 6: a total
 * of 27 can be produced a dozen ways, so a total only fixture cannot say which
 * threshold misfired.
 */
export interface GroundTruthFixture {
  id: string
  description: string
  formation: string
  /** 11 entries, in slot order. */
  players: GroundTruthPlayer[]
  /** What the game actually displayed. */
  displayedRating: number
  /** Null when this fixture only exercises the rating path. */
  displayedChemistry: number | null
  /**
   * 11 individual chemistry values in slot order, or null alongside a null total.
   * Must sum to displayedChemistry. The entry UI rejects a mismatch before saving.
   */
  displayedPlayerChemistry: number[] | null
  /**
   * True when the expected values are documented behaviour rather than an observed
   * in game reading. Run and reported, visibly flagged, not treated as ground truth.
   */
  pending_verification?: boolean
  /** Which parts of the engine this fixture actually constrains. */
  verifies: ('squadRating' | 'chemistry')[]
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
