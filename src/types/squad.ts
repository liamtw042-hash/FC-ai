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

/** One starter placed into one slot. An INPUT to the rules engine. */
export interface PlacedPlayer {
  card: ResolvedCard
  slotIndex: number
  slotPosition: string
}

/** Per player chemistry, an OUTPUT. Ground truth fixtures record these individually. */
export interface PlayerChemistry {
  slotIndex: number
  /**
   * The positioning gate. False means this player earns 0 chemistry AND
   * contributes nothing to anyone else's thresholds.
   */
  inPosition: boolean
  clubPoints: number
  nationPoints: number
  leaguePoints: number
  managerBonus: number
  /** 0 to 3, after the cap. */
  chemistry: number
}

export interface ChemistryResult {
  /** Sum of the per player values. 0 to 33. */
  total: number
  players: PlayerChemistry[]
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
  chemistry: ChemistryResult
}

/**
 * One player row in a ground truth fixture.
 *
 * Fixtures are SELF CONTAINED. They carry the card facts they need rather than
 * pointing at a defId in the player database. A fixture is a permanent record of
 * what the game displayed on a given day, and it must not stop working because
 * the database was refreshed or because a defId scheme changed. defId is kept as
 * an optional cross reference only.
 */
export interface GroundTruthPlayer {
  defId: string | null
  name: string | null
  rating: number
  /** The slot this player was placed in. */
  slotPosition: string
  /** Card facts. Required for a fixture that verifies chemistry, omitted for rating only. */
  positions?: string[]
  nation?: string
  league?: string | null
  club?: string | null
  cardType?: string
  isWomens?: boolean
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
  /** PENDING.md entry id whose reading would clear pending_verification. */
  pendingRef?: string
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
