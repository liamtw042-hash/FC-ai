/**
 * Serialises the chemistry rules for the Python solver.
 *
 * THE POINT OF THIS FILE. The solver needs chemistry as constraints, which means
 * the numbers have to reach it somehow. They reach it as data, from here, read
 * straight off the rules engine constants and the card type registry. The solver
 * holds no defaults and rejects a request that omits them.
 *
 * That keeps exactly one implementation of every game rule. If a threshold is
 * corrected, it is corrected in chemistry.ts and the solver picks it up on the
 * next request with no second edit and no chance of the two drifting apart.
 */

import {
  CLUB_THRESHOLDS,
  LEAGUE_THRESHOLDS,
  MAX_PLAYER_CHEMISTRY,
  MAX_SQUAD_CHEMISTRY,
  NATION_THRESHOLDS,
  type ThresholdLadder,
} from '../rules/chemistry'
import { defaultCardTypeRegistry, type CardTypeRegistry } from '../rules/cardTypes'
import type { Manager } from '../types/squad'

export interface WireContribution {
  club: number
  league: number
  nation: number
  applies_league_to_all: boolean
  always_max_chem: boolean
}

export interface WireChemistryConfig {
  club_thresholds: [number, number][]
  nation_thresholds: [number, number][]
  league_thresholds: [number, number][]
  contributions: Record<string, WireContribution>
  max_player_chemistry: number
  max_squad_chemistry: number
  manager?: { nation: string; league: string }
}

function ladder(source: ThresholdLadder): [number, number][] {
  return source.map(([count, points]) => [count, points])
}

export function buildChemistryConfig(
  registry: CardTypeRegistry = defaultCardTypeRegistry,
  manager?: Manager,
  extraCardTypes: readonly string[] = [],
): WireChemistryConfig {
  const contributions: Record<string, WireContribution> = {}
  const ids = new Set<string>([...registry.list().map((d) => d.id), ...extraCardTypes])
  for (const id of ids) {
    const definition = registry.get(id)
    contributions[id] = {
      club: definition.contribution.club,
      league: definition.contribution.league,
      nation: definition.contribution.nation,
      applies_league_to_all: definition.contribution.appliesLeagueToAll,
      always_max_chem: definition.contribution.alwaysMaxChem,
    }
  }

  const config: WireChemistryConfig = {
    club_thresholds: ladder(CLUB_THRESHOLDS),
    nation_thresholds: ladder(NATION_THRESHOLDS),
    league_thresholds: ladder(LEAGUE_THRESHOLDS),
    contributions,
    max_player_chemistry: MAX_PLAYER_CHEMISTRY,
    max_squad_chemistry: MAX_SQUAD_CHEMISTRY,
  }
  return manager === undefined ? config : { ...config, manager }
}
