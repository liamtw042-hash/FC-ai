import { describe, expect, it } from 'vitest'
import { buildChemistryConfig } from './chemistryConfig'
import {
  CLUB_THRESHOLDS,
  LEAGUE_THRESHOLDS,
  MAX_PLAYER_CHEMISTRY,
  MAX_SQUAD_CHEMISTRY,
  NATION_THRESHOLDS,
} from '../rules/chemistry'
import { createCardTypeRegistry, defaultCardTypeRegistry } from '../rules/cardTypes'

describe('the chemistry config sent to the solver', () => {
  it('is read off the rules engine constants, not typed out again', () => {
    const config = buildChemistryConfig()
    expect(config.club_thresholds).toEqual(CLUB_THRESHOLDS.map(([c, p]) => [c, p]))
    expect(config.nation_thresholds).toEqual(NATION_THRESHOLDS.map(([c, p]) => [c, p]))
    expect(config.league_thresholds).toEqual(LEAGUE_THRESHOLDS.map(([c, p]) => [c, p]))
    expect(config.max_player_chemistry).toBe(MAX_PLAYER_CHEMISTRY)
    expect(config.max_squad_chemistry).toBe(MAX_SQUAD_CHEMISTRY)
  })

  it('carries every card type the registry knows, with its exact weights', () => {
    const config = buildChemistryConfig()
    for (const definition of defaultCardTypeRegistry.list()) {
      expect(config.contributions[definition.id]).toEqual({
        club: definition.contribution.club,
        league: definition.contribution.league,
        nation: definition.contribution.nation,
        applies_league_to_all: definition.contribution.appliesLeagueToAll,
        always_max_chem: definition.contribution.alwaysMaxChem,
      })
    }
  })

  it('carries an override file entry too, so a new promo class needs no solver change', () => {
    const registry = createCardTypeRegistry([
      {
        id: 'winter_wildcard',
        displayName: 'Winter Wildcard',
        group: 'promo',
        contribution: {
          club: 2,
          league: 2,
          nation: 2,
          appliesLeagueToAll: false,
          alwaysMaxChem: false,
        },
        isRare: true,
        isTotw: false,
        isIcon: false,
        isHero: false,
        verified: false,
        source: 'override file',
      },
    ])
    expect(buildChemistryConfig(registry).contributions['winter_wildcard']!.club).toBe(2)
  })

  it('includes a card type seen in the data but absent from the registry', () => {
    // The solver rejects an unknown card type rather than guessing, so anything
    // the pool contains must be described here even if it fell back to defaults.
    const config = buildChemistryConfig(defaultCardTypeRegistry, undefined, ['tots'])
    expect(config.contributions['tots']).toEqual({
      club: 1,
      league: 1,
      nation: 1,
      applies_league_to_all: false,
      always_max_chem: false,
    })
  })

  it('omits the manager entirely when there is none, rather than sending a blank one', () => {
    expect('manager' in buildChemistryConfig()).toBe(false)
    expect(buildChemistryConfig(defaultCardTypeRegistry, { nation: 'Italy', league: 'Serie A' }).manager)
      .toEqual({ nation: 'Italy', league: 'Serie A' })
  })
})
