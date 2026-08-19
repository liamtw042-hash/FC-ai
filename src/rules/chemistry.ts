/**
 * Chemistry. Section 4.2 of the brief.
 *
 * Pure TypeScript, zero dependencies.
 *
 * Each starter earns 0 to 3, squad chemistry is the sum, maximum 33.
 *
 * THE POSITIONING GATE IS ABSOLUTE. A player earns chemistry only when placed in
 * one of their preferred positions. Out of position means 0 chemistry AND no
 * contribution to anyone else's thresholds. It is the number one source of bugs
 * in solvers because the second half is easy to forget: an out of position player
 * does not merely score nothing, they stop propping up everyone else.
 *
 * Thresholds, all six steps confirmed, see RESEARCH.md 2:
 *
 *   Club    2 = +1, 4 = +2, 7 = +3
 *   Nation  2 = +1, 5 = +2, 8 = +3
 *   League  3 = +1, 5 = +2, 8 = +3
 *
 * Note the asymmetry. League needs 3 for its first point, club and nation need 2.
 */

import type { Manager, PlayerChemistry, ChemistryResult, PlacedPlayer } from '../types/squad'

export const MAX_PLAYER_CHEMISTRY = 3
export const MAX_SQUAD_CHEMISTRY = 33

/** Descending, so the first step a count reaches is the answer. */
export type ThresholdLadder = readonly (readonly [count: number, points: number])[]

export const CLUB_THRESHOLDS: ThresholdLadder = [
  [7, 3],
  [4, 2],
  [2, 1],
]
export const NATION_THRESHOLDS: ThresholdLadder = [
  [8, 3],
  [5, 2],
  [2, 1],
]
export const LEAGUE_THRESHOLDS: ThresholdLadder = [
  [8, 3],
  [5, 2],
  [3, 1],
]

/** The three ladders together, so a caller can substitute a hypothetical set. */
export interface ChemistryLadders {
  club: ThresholdLadder
  nation: ThresholdLadder
  league: ThresholdLadder
}

export const DEFAULT_LADDERS: ChemistryLadders = {
  club: CLUB_THRESHOLDS,
  nation: NATION_THRESHOLDS,
  league: LEAGUE_THRESHOLDS,
}

export function pointsFor(count: number, ladder: ThresholdLadder): number {
  for (const [needed, points] of ladder) {
    if (count >= needed) return points
  }
  return 0
}

/** Increment tallies over the in-position starters only. */
interface EntityCounts {
  clubs: Map<string, number>
  nations: Map<string, number>
  leagues: Map<string, number>
  /** Icons add to EVERY league, so their weight is held apart and added to each lookup. */
  allLeagues: number
}

function add(counts: Map<string, number>, key: string | null, weight: number): void {
  // A null club or league is an absent entity, not a shared blank. Two Icons both
  // having no club must not link to each other. Skipping the null does that.
  if (key === null || weight === 0) return
  counts.set(key, (counts.get(key) ?? 0) + weight)
}

function tally(players: readonly PlacedPlayer[], inPosition: readonly boolean[]): EntityCounts {
  const counts: EntityCounts = {
    clubs: new Map(),
    nations: new Map(),
    leagues: new Map(),
    allLeagues: 0,
  }

  players.forEach((placed, index) => {
    if (!inPosition[index]) return // the gate, second half
    const { definition, type } = placed.card
    const contribution = type.contribution

    add(counts.clubs, definition.club, contribution.club)
    add(counts.nations, definition.nation, contribution.nation)

    if (contribution.appliesLeagueToAll) {
      // Icons. One increment to every league in the squad, including leagues
      // contributed by players tallied later, which is why this is a separate term.
      counts.allLeagues += contribution.league
    } else {
      add(counts.leagues, definition.league, contribution.league)
    }
  })

  return counts
}

function leagueCount(counts: EntityCounts, league: string | null): number {
  if (league === null) return 0
  return (counts.leagues.get(league) ?? 0) + counts.allLeagues
}

export function isInPosition(placed: PlacedPlayer): boolean {
  return placed.card.effectivePositions.includes(placed.slotPosition)
}

/**
 * A manager gives +1 to any player sharing their nation OR league.
 * Capped at +1 per player even when both match. Optional, off by default.
 */
function managerBonusFor(placed: PlacedPlayer, manager: Manager | undefined): number {
  if (manager === undefined) return 0
  const { definition } = placed.card
  const matches =
    definition.nation === manager.nation ||
    (definition.league !== null && definition.league === manager.league)
  return matches ? 1 : 0
}

/**
 * ladders is substitutable so that observability can be MEASURED rather than
 * asserted. See ruleFacts.ts and observability.test.ts: a threshold step counts
 * as live only if perturbing it actually changes some squad's chemistry.
 */
export function calculateChemistry(
  players: readonly PlacedPlayer[],
  manager?: Manager,
  ladders: ChemistryLadders = DEFAULT_LADDERS,
): ChemistryResult {
  const gate = players.map(isInPosition)
  const counts = tally(players, gate)

  const perPlayer: PlayerChemistry[] = players.map((placed, index) => {
    const { definition, type } = placed.card

    if (!gate[index]) {
      // The gate, first half. Nothing else about this player matters.
      return {
        slotIndex: placed.slotIndex,
        inPosition: false,
        clubPoints: 0,
        nationPoints: 0,
        leaguePoints: 0,
        managerBonus: 0,
        chemistry: 0,
      }
    }

    const clubPoints =
      definition.club === null
        ? 0
        : pointsFor(counts.clubs.get(definition.club) ?? 0, ladders.club)
    const nationPoints = pointsFor(counts.nations.get(definition.nation) ?? 0, ladders.nation)
    const leaguePoints = pointsFor(leagueCount(counts, definition.league), ladders.league)
    const managerBonus = managerBonusFor(placed, manager)

    // Icons, Heroes and Festival of Football Captains sit at 3 when in position,
    // whatever the rest of the squad looks like. Still gated on position above.
    const chemistry = type.contribution.alwaysMaxChem
      ? MAX_PLAYER_CHEMISTRY
      : Math.min(MAX_PLAYER_CHEMISTRY, clubPoints + nationPoints + leaguePoints + managerBonus)

    return {
      slotIndex: placed.slotIndex,
      inPosition: true,
      clubPoints,
      nationPoints,
      leaguePoints,
      managerBonus,
      chemistry,
    }
  })

  return {
    total: perPlayer.reduce((sum, p) => sum + p.chemistry, 0),
    players: perPlayer,
  }
}
