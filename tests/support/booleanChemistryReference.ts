/**
 * The chemistry algorithm as brief 4.2 literally specifies it, with Icons and
 * Heroes as hardcoded special cases rather than as rows in a data table.
 *
 * This exists for exactly one purpose: to prove that replacing the two booleans
 * with the contribution table did not change behaviour for Icons and Heroes.
 * It is the "before" side of that equivalence property test and is not used by
 * application code. If the two ever disagree on a squad of ordinary, Icon and
 * Hero cards, the generalisation broke something and we want to know.
 */

import type { Manager, PlacedPlayer } from '../../src/types/squad'
import {
  CLUB_THRESHOLDS,
  LEAGUE_THRESHOLDS,
  MAX_PLAYER_CHEMISTRY,
  NATION_THRESHOLDS,
  pointsFor,
} from '../../src/rules/chemistry'

export function booleanChemistryReference(
  players: readonly PlacedPlayer[],
  manager?: Manager,
): number[] {
  const inPosition = players.map((p) => p.card.effectivePositions.includes(p.slotPosition))

  const clubCounts = new Map<string, number>()
  const nationCounts = new Map<string, number>()
  const leagueCounts = new Map<string, number>()
  let iconLeagueIncrements = 0

  players.forEach((placed, index) => {
    if (!inPosition[index]) return
    const { definition, type } = placed.card

    if (type.isIcon) {
      // Icons contribute 2 increments to their nation and 1 to every league.
      // They have no club and no league of their own.
      nationCounts.set(definition.nation, (nationCounts.get(definition.nation) ?? 0) + 2)
      iconLeagueIncrements += 1
      return
    }

    if (type.isHero) {
      // Heroes contribute 1 to their nation and 2 to their league. No club.
      nationCounts.set(definition.nation, (nationCounts.get(definition.nation) ?? 0) + 1)
      if (definition.league !== null) {
        leagueCounts.set(definition.league, (leagueCounts.get(definition.league) ?? 0) + 2)
      }
      return
    }

    if (definition.club !== null) {
      clubCounts.set(definition.club, (clubCounts.get(definition.club) ?? 0) + 1)
    }
    nationCounts.set(definition.nation, (nationCounts.get(definition.nation) ?? 0) + 1)
    if (definition.league !== null) {
      leagueCounts.set(definition.league, (leagueCounts.get(definition.league) ?? 0) + 1)
    }
  })

  return players.map((placed, index) => {
    if (!inPosition[index]) return 0
    const { definition, type } = placed.card

    // Icons and Heroes always have 3 chemistry when in a preferred position.
    if (type.isIcon || type.isHero) return MAX_PLAYER_CHEMISTRY

    const club =
      definition.club === null
        ? 0
        : pointsFor(clubCounts.get(definition.club) ?? 0, CLUB_THRESHOLDS)
    const nation = pointsFor(nationCounts.get(definition.nation) ?? 0, NATION_THRESHOLDS)
    const league =
      definition.league === null
        ? 0
        : pointsFor(
            (leagueCounts.get(definition.league) ?? 0) + iconLeagueIncrements,
            LEAGUE_THRESHOLDS,
          )

    let bonus = 0
    if (manager !== undefined) {
      const matches =
        definition.nation === manager.nation ||
        (definition.league !== null && definition.league === manager.league)
      bonus = matches ? 1 : 0
    }

    return Math.min(MAX_PLAYER_CHEMISTRY, club + nation + league + bonus)
  })
}
