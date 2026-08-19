import { describe, expect, it } from 'vitest'
import {
  CLUB_THRESHOLDS,
  LEAGUE_THRESHOLDS,
  MAX_SQUAD_CHEMISTRY,
  NATION_THRESHOLDS,
  calculateChemistry,
  pointsFor,
} from './chemistry'
import { applyAliases, createAliasTable } from './aliases'
import { createCardTypeRegistry, defaultCardTypeRegistry } from './cardTypes'
import { placeAll, resolvedCard, unlinkedSquad } from '../../tests/support/factories'
import { booleanChemistryReference } from '../../tests/support/booleanChemistryReference'
import type { ResolvedCard } from '../types/cards'
import type { PlacedPlayer } from '../types/squad'

function chemOf(cards: readonly ResolvedCard[], slots?: readonly string[]): number[] {
  return calculateChemistry(placeAll(cards, slots)).players.map((p) => p.chemistry)
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('threshold ladders', () => {
  it('club is 2 = +1, 4 = +2, 7 = +3', () => {
    const got = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => pointsFor(n, CLUB_THRESHOLDS))
    expect(got).toEqual([0, 0, 1, 1, 2, 2, 2, 3, 3])
  })

  it('nation is 2 = +1, 5 = +2, 8 = +3', () => {
    const got = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => pointsFor(n, NATION_THRESHOLDS))
    expect(got).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 3])
  })

  it('league is 3 = +1, 5 = +2, 8 = +3, which is the asymmetry', () => {
    const got = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => pointsFor(n, LEAGUE_THRESHOLDS))
    expect(got).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 3])
  })

  it('two players share a league for nothing, but share a club for a point', () => {
    // The second most common bug in solvers, asserted directly.
    expect(pointsFor(2, LEAGUE_THRESHOLDS)).toBe(0)
    expect(pointsFor(2, CLUB_THRESHOLDS)).toBe(1)
    expect(pointsFor(2, NATION_THRESHOLDS)).toBe(1)
  })
})

describe('the positioning gate', () => {
  it('a player outside their preferred positions earns nothing', () => {
    const three = Array.from({ length: 3 }, () =>
      resolvedCard({ positions: ['CM'], club: 'Arsenal' }),
    )
    expect(chemOf(three)).toEqual([1, 1, 1])
    // Shove the third into a slot they do not play. They score 0, and the club
    // count falls 3 to 2, which is still above the +1 step, so the other two hold.
    expect(chemOf(three, ['CM', 'CM', 'ST'])).toEqual([1, 1, 0])
  })

  it('and takes the last link down with them when the count cannot spare it', () => {
    const two = Array.from({ length: 2 }, () =>
      resolvedCard({ positions: ['CM'], club: 'Arsenal' }),
    )
    expect(chemOf(two)).toEqual([1, 1])
    // With only two, the misplaced one drops the in position club count to 1, so
    // the player still in position loses their point as well. Nothing is left.
    expect(chemOf(two, ['CM', 'ST'])).toEqual([0, 0])
  })

  it('and stops contributing to everyone else, collapsing the squad', () => {
    // Eight Premier League players, unique clubs and nations, so league is the
    // only link in play. Three unrelated players make up the eleven.
    const premierLeague = Array.from({ length: 8 }, () =>
      resolvedCard({ positions: ['CM'], league: 'Premier League' }),
    )
    const rest = unlinkedSquad(3, { positions: ['CM'] })
    const squad = [...premierLeague, ...rest]

    // All in position: 8 sharing a league is +3 each.
    const before = calculateChemistry(placeAll(squad))
    expect(before.players.slice(0, 8).map((p) => p.chemistry)).toEqual([3, 3, 3, 3, 3, 3, 3, 3])
    expect(before.total).toBe(24)

    // Move ONE of them out of position. In position league count falls 8 to 7,
    // which is below the +3 step, so the other seven drop to +2 as well.
    const slots = ['CM', 'CM', 'CM', 'CM', 'CM', 'CM', 'CM', 'ST', 'CM', 'CM', 'CM']
    const after = calculateChemistry(placeAll(squad, slots))
    expect(after.players.slice(0, 7).map((p) => p.chemistry)).toEqual([2, 2, 2, 2, 2, 2, 2])
    expect(after.players[7]!.chemistry).toBe(0)
    expect(after.total).toBe(14)

    // One misplacement, ten chemistry gone.
    expect(before.total - after.total).toBe(10)
  })

  it('applies to Icons too, who are 3 in position and 0 out of it', () => {
    const icon = resolvedCard({ positions: ['ST'], cardType: 'icon', club: null, league: null })
    expect(chemOf([icon], ['ST'])).toEqual([3])
    expect(chemOf([icon], ['GK'])).toEqual([0])
  })

  it('a player with several preferred positions is in position in any of them', () => {
    const card = resolvedCard({ positions: ['CM', 'CAM', 'CDM'] })
    for (const slot of ['CM', 'CAM', 'CDM']) {
      expect(calculateChemistry(placeAll([card], [slot])).players[0]!.inPosition).toBe(true)
    }
    expect(calculateChemistry(placeAll([card], ['LB'])).players[0]!.inPosition).toBe(false)
  })
})

describe('threshold counting end to end', () => {
  function sharing(n: number, key: 'club' | 'league' | 'nation'): ResolvedCard[] {
    const shared = key === 'club' ? 'Arsenal' : key === 'league' ? 'Premier League' : 'England'
    return Array.from({ length: n }, () => resolvedCard({ [key]: shared }))
  }

  it('counts include the player themselves', () => {
    expect(chemOf(sharing(1, 'club'))).toEqual([0])
    expect(chemOf(sharing(2, 'club'))).toEqual([1, 1])
  })

  it('walks the club ladder', () => {
    expect(chemOf(sharing(4, 'club')).every((c) => c === 2)).toBe(true)
    expect(chemOf(sharing(7, 'club')).every((c) => c === 3)).toBe(true)
  })

  it('walks the nation ladder', () => {
    expect(chemOf(sharing(2, 'nation')).every((c) => c === 1)).toBe(true)
    expect(chemOf(sharing(5, 'nation')).every((c) => c === 2)).toBe(true)
    expect(chemOf(sharing(8, 'nation')).every((c) => c === 3)).toBe(true)
  })

  it('walks the league ladder, which starts at 3 not 2', () => {
    expect(chemOf(sharing(2, 'league')).every((c) => c === 0)).toBe(true)
    expect(chemOf(sharing(3, 'league')).every((c) => c === 1)).toBe(true)
    expect(chemOf(sharing(5, 'league')).every((c) => c === 2)).toBe(true)
    expect(chemOf(sharing(8, 'league')).every((c) => c === 3)).toBe(true)
  })

  it('sums the three categories and caps each player at 3', () => {
    // Four players sharing club, nation and league: 2 + 1 + 1 = 4, capped to 3.
    const cards = Array.from({ length: 4 }, () =>
      resolvedCard({ club: 'Arsenal', nation: 'England', league: 'Premier League' }),
    )
    const result = calculateChemistry(placeAll(cards))
    const first = result.players[0]!
    expect([first.clubPoints, first.nationPoints, first.leaguePoints]).toEqual([2, 1, 1])
    expect(first.chemistry).toBe(3)
  })

  it('caps the squad at 33', () => {
    const cards = Array.from({ length: 11 }, () =>
      resolvedCard({ club: 'Arsenal', nation: 'England', league: 'Premier League' }),
    )
    const result = calculateChemistry(placeAll(cards))
    expect(result.total).toBe(MAX_SQUAD_CHEMISTRY)
  })
})

describe('Icons', () => {
  it('always have 3 chemistry in position regardless of the squad', () => {
    const icon = resolvedCard({ cardType: 'icon', club: null, league: null })
    const squad = [icon, ...unlinkedSquad(10)]
    expect(chemOf(squad)[0]).toBe(3)
  })

  it('contribute 2 increments to their nation', () => {
    // Three ordinary Spaniards alone reach 3, which is only +1.
    expect(chemOf(Array.from({ length: 3 }, () => resolvedCard({ nation: 'Spain' })))).toEqual([
      1, 1, 1,
    ])
    // Three ordinary Spaniards plus a Spanish Icon reach 3 + 2 = 5, which is +2.
    const withIcon = [
      ...Array.from({ length: 3 }, () => resolvedCard({ nation: 'Spain' })),
      resolvedCard({ nation: 'Spain', cardType: 'icon', club: null, league: null }),
    ]
    expect(chemOf(withIcon)).toEqual([2, 2, 2, 3])
  })

  it('contribute 1 increment to EVERY league, not to one', () => {
    const sevenPl = Array.from({ length: 7 }, () => resolvedCard({ league: 'Premier League' }))
    // Seven alone is +2. The Icon lifts every league by one, so they reach 8 and +3.
    expect(chemOf(sevenPl).every((c) => c === 2)).toBe(true)

    const icon = resolvedCard({ cardType: 'icon', club: null, league: null })
    const lifted = calculateChemistry(placeAll([...sevenPl, icon]))
    expect(lifted.players.slice(0, 7).map((p) => p.leaguePoints)).toEqual([3, 3, 3, 3, 3, 3, 3])

    // Two different leagues both get the increment from the same Icon.
    const twoLeagues = [
      ...Array.from({ length: 2 }, () => resolvedCard({ league: 'Premier League' })),
      ...Array.from({ length: 2 }, () => resolvedCard({ league: 'La Liga' })),
      icon,
    ]
    const mixed = calculateChemistry(placeAll(twoLeagues))
    expect(mixed.players.slice(0, 4).map((p) => p.leaguePoints)).toEqual([1, 1, 1, 1])
  })
})

describe('Heroes', () => {
  it('always have 3 chemistry in position', () => {
    const hero = resolvedCard({ cardType: 'hero', club: null })
    expect(chemOf([hero, ...unlinkedSquad(10)])[0]).toBe(3)
  })

  it('contribute 1 to their nation and 2 to their league', () => {
    // Three ordinary Premier League players reach 3, which is +1.
    const three = Array.from({ length: 3 }, () => resolvedCard({ league: 'Premier League' }))
    expect(chemOf(three).every((c) => c === 1)).toBe(true)

    // Three plus a Premier League Hero reach 3 + 2 = 5, which is +2.
    const hero = resolvedCard({ league: 'Premier League', cardType: 'hero', club: null })
    const withHero = calculateChemistry(placeAll([...three, hero]))
    expect(withHero.players.slice(0, 3).map((p) => p.leaguePoints)).toEqual([2, 2, 2])

    // Nation is a single increment, unlike an Icon.
    const spaniards = Array.from({ length: 4 }, () => resolvedCard({ nation: 'Spain' }))
    const spanishHero = resolvedCard({ nation: 'Spain', cardType: 'hero', club: null })
    const nationResult = calculateChemistry(placeAll([...spaniards, spanishHero]))
    expect(nationResult.players.slice(0, 4).map((p) => p.nationPoints)).toEqual([2, 2, 2, 2])
  })
})

describe('Festival of Football Captains, the class the two booleans could not express', () => {
  const captain = () =>
    resolvedCard({
      cardType: 'fof_captain',
      nation: 'Brazil',
      club: 'Real Madrid',
      league: 'La Liga',
    })

  it('are inherently 3 chemistry with no other links at all', () => {
    expect(chemOf([captain(), ...unlinkedSquad(10)])[0]).toBe(3)
  })

  it('contribute three nation links', () => {
    // Two ordinary Brazilians reach 2, which is +1.
    const two = Array.from({ length: 2 }, () => resolvedCard({ nation: 'Brazil' }))
    expect(chemOf(two).every((c) => c === 1)).toBe(true)
    // Two plus a Brazilian captain reach 2 + 3 = 5, which is +2.
    const withCaptain = calculateChemistry(placeAll([...two, captain()]))
    expect(withCaptain.players.slice(0, 2).map((p) => p.nationPoints)).toEqual([2, 2])
  })

  it('contribute one club link and one league link, like an ordinary card', () => {
    const clubMate = resolvedCard({ club: 'Real Madrid' })
    const leagueMates = Array.from({ length: 2 }, () => resolvedCard({ league: 'La Liga' }))
    const result = calculateChemistry(placeAll([captain(), clubMate, ...leagueMates]))
    expect(result.players[1]!.clubPoints).toBe(1)
    expect(result.players[2]!.leaguePoints).toBe(1)
  })
})

describe('the contribution table reproduces the old boolean logic exactly', () => {
  // The binding condition on approving the table, see RESEARCH.md 2.1. If these
  // ever disagree, generalising the two booleans changed behaviour, which was
  // not the deal.
  const CLUBS = ['Arsenal', 'Chelsea', 'Real Madrid', null]
  const NATIONS = ['England', 'Spain', 'Brazil', 'France']
  const LEAGUES = ['Premier League', 'La Liga', 'Serie A', null]
  const TYPES = ['common', 'rare', 'totw', 'icon', 'hero']

  function randomSquad(rand: () => number): PlacedPlayer[] {
    const cards = Array.from({ length: 11 }, () => {
      const cardType = TYPES[Math.floor(rand() * TYPES.length)]!
      const isIcon = cardType === 'icon'
      const isHero = cardType === 'hero'
      return resolvedCard({
        positions: ['CM'],
        cardType,
        nation: NATIONS[Math.floor(rand() * NATIONS.length)]!,
        club: isIcon || isHero ? null : CLUBS[Math.floor(rand() * CLUBS.length)]!,
        league: isIcon ? null : LEAGUES[Math.floor(rand() * LEAGUES.length)]!,
      })
    })
    // Roughly one in five placed out of position, so the gate is exercised too.
    return placeAll(
      cards,
      cards.map(() => (rand() < 0.2 ? 'ST' : 'CM')),
    )
  }

  it('agrees on 20000 random squads of ordinary, Icon and Hero cards', () => {
    const rand = makeRandom(20260819)
    for (let trial = 0; trial < 20000; trial += 1) {
      const squad = randomSquad(rand)
      const table = calculateChemistry(squad).players.map((p) => p.chemistry)
      expect(table).toEqual(booleanChemistryReference(squad))
    }
  })

  it('agrees with a manager attached as well', () => {
    const rand = makeRandom(555)
    const manager = { nation: 'England', league: 'Premier League' }
    for (let trial = 0; trial < 5000; trial += 1) {
      const squad = randomSquad(rand)
      const table = calculateChemistry(squad, manager).players.map((p) => p.chemistry)
      expect(table).toEqual(booleanChemistryReference(squad, manager))
    }
  })
})

describe('null clubs and leagues', () => {
  it('a null club is an absent entity, never a shared blank', () => {
    // Two ordinary cards with no club must not link to each other through the null.
    const cards = Array.from({ length: 4 }, () => resolvedCard({ club: null }))
    const result = calculateChemistry(placeAll(cards))
    expect(result.players.map((p) => p.clubPoints)).toEqual([0, 0, 0, 0])
  })

  it('a null league is an absent entity, never a shared blank', () => {
    const cards = Array.from({ length: 5 }, () => resolvedCard({ league: null }))
    const result = calculateChemistry(placeAll(cards))
    expect(result.players.map((p) => p.leaguePoints)).toEqual([0, 0, 0, 0, 0])
  })

  it('Icons having no club and no league does not crash or link them', () => {
    const icons = Array.from({ length: 4 }, () =>
      resolvedCard({ cardType: 'icon', club: null, league: null, nation: 'Brazil' }),
    )
    const result = calculateChemistry(placeAll(icons))
    expect(result.players.map((p) => p.clubPoints)).toEqual([0, 0, 0, 0])
    expect(result.players.map((p) => p.chemistry)).toEqual([3, 3, 3, 3])
  })

  it('eleven Icons is exactly 33', () => {
    const icons = Array.from({ length: 11 }, () =>
      resolvedCard({ cardType: 'icon', club: null, league: null }),
    )
    expect(calculateChemistry(placeAll(icons)).total).toBe(MAX_SQUAD_CHEMISTRY)
  })
})

describe("women's players link by club and nation, never by league", () => {
  const aliases = createAliasTable({
    clubs: { 'Arsenal Women': 'Arsenal', 'Chelsea Women': 'Chelsea' },
  })

  function womensSquad(table = aliases): ResolvedCard[] {
    const womens = resolvedCard({
      name: 'Arsenal womens player',
      club: 'Arsenal Women',
      league: "Barclays Women's Super League",
      nation: 'England',
      isWomens: true,
    })
    const mens = resolvedCard({
      name: 'Arsenal mens player',
      club: 'Arsenal',
      league: 'Premier League',
      nation: 'England',
    })
    return [womens, mens].map((card) => ({
      ...card,
      definition: applyAliases(card.definition, table),
    }))
  }

  it('club links across the men and women split once the alias table resolves it', () => {
    const result = calculateChemistry(placeAll(womensSquad()))
    expect(result.players.map((p) => p.clubPoints)).toEqual([1, 1])
    expect(result.players.map((p) => p.nationPoints)).toEqual([1, 1])
  })

  it('and never league links, because the competitions are genuinely different', () => {
    const result = calculateChemistry(placeAll(womensSquad()))
    expect(result.players.map((p) => p.leaguePoints)).toEqual([0, 0])
  })

  it('without the alias table the club link silently breaks, which is the whole risk', () => {
    const result = calculateChemistry(placeAll(womensSquad(createAliasTable({}))))
    expect(result.players.map((p) => p.clubPoints)).toEqual([0, 0])
  })
})

describe('manager chemistry', () => {
  const card = () => resolvedCard({ nation: 'Italy', league: 'Serie A', club: 'Milan' })

  it('is off by default', () => {
    expect(calculateChemistry(placeAll([card()])).players[0]!.managerBonus).toBe(0)
  })

  it('gives +1 for a shared nation', () => {
    const result = calculateChemistry(placeAll([card()]), { nation: 'Italy', league: 'La Liga' })
    expect(result.players[0]!.managerBonus).toBe(1)
    expect(result.players[0]!.chemistry).toBe(1)
  })

  it('gives +1 for a shared league', () => {
    const result = calculateChemistry(placeAll([card()]), { nation: 'Spain', league: 'Serie A' })
    expect(result.players[0]!.managerBonus).toBe(1)
  })

  it('gives +1 and no more when both match', () => {
    const result = calculateChemistry(placeAll([card()]), { nation: 'Italy', league: 'Serie A' })
    expect(result.players[0]!.managerBonus).toBe(1)
    expect(result.players[0]!.chemistry).toBe(1)
  })

  it('gives nothing when neither matches', () => {
    const result = calculateChemistry(placeAll([card()]), { nation: 'Spain', league: 'La Liga' })
    expect(result.players[0]!.managerBonus).toBe(0)
  })

  it('cannot push a player past 3', () => {
    const cards = Array.from({ length: 7 }, () =>
      resolvedCard({ club: 'Milan', nation: 'Italy', league: 'Serie A' }),
    )
    const result = calculateChemistry(placeAll(cards), { nation: 'Italy', league: 'Serie A' })
    expect(result.players.every((p) => p.chemistry === 3)).toBe(true)
  })

  it('does not reach a player who is out of position', () => {
    const result = calculateChemistry(placeAll([card()], ['GK']), {
      nation: 'Italy',
      league: 'Serie A',
    })
    expect(result.players[0]!.managerBonus).toBe(0)
    expect(result.players[0]!.chemistry).toBe(0)
  })
})

describe('the card type registry', () => {
  it('an unknown card type degrades to an ordinary card rather than throwing', () => {
    const unknown = defaultCardTypeRegistry.get('some_promo_that_ships_next_week')
    expect(unknown.contribution).toEqual({
      club: 1,
      league: 1,
      nation: 1,
      appliesLeagueToAll: false,
      alwaysMaxChem: false,
    })
    expect(defaultCardTypeRegistry.has('some_promo_that_ships_next_week')).toBe(false)
  })

  it('reports which card types in the data it does not describe', () => {
    expect(defaultCardTypeRegistry.unknown(['rare', 'icon', 'winter_wildcard', 'tots'])).toEqual([
      'tots',
      'winter_wildcard',
    ])
  })

  it('an override file can describe a new class without a code change', () => {
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
        source: 'Made up for this test.',
      },
    ])
    const wildcard = resolvedCard({ cardType: 'winter_wildcard', club: 'Arsenal' }, registry)
    const mate = resolvedCard({ club: 'Arsenal' }, registry)
    // The wildcard counts twice, so two cards reach a club count of 3.
    const result = calculateChemistry(placeAll([wildcard, mate]))
    expect(result.players.map((p) => p.clubPoints)).toEqual([1, 1])
    expect(registry.get('winter_wildcard').contribution.club).toBe(2)
  })
})
