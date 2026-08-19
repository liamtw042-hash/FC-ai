import { describe, expect, it } from 'vitest'
import { validateSquad, squadPasses } from './validateSquad'
import { qualityOf } from './quality'
import { getFormation } from './formations'
import { placeAll, resolvedCard, unlinkedSquad } from '../../tests/support/factories'
import type { Requirement } from '../types/requirements'
import type { CardSpec } from '../../tests/support/factories'
import type { Manager, Squad } from '../types/squad'

const FORMATION = getFormation('4-4-2')

function squadOf(specs: readonly CardSpec[], manager?: Manager): Squad {
  const cards = specs.map((spec) => resolvedCard(spec))
  const players = placeAll(
    cards,
    cards.map((_, i) => FORMATION.slots[i]!),
  )
  const squad: Squad = { formation: FORMATION, players }
  return manager === undefined ? squad : { ...squad, manager }
}

/** Eleven cards sharing nothing, each already in its own slot. */
function plainSquad(overrides: Partial<Record<number, CardSpec>> = {}): Squad {
  const specs = FORMATION.slots.map((slot, index) => ({
    positions: [slot],
    rating: 84,
    ...(overrides[index] ?? {}),
  }))
  return squadOf(specs)
}

function check(squad: Squad, requirement: Requirement) {
  return validateSquad(squad, [requirement])[0]!
}

describe('quality bands', () => {
  it('is bronze up to 64, silver 65 to 74, gold from 75', () => {
    expect([0, 64, 65, 74, 75, 99].map(qualityOf)).toEqual([
      'bronze',
      'bronze',
      'silver',
      'silver',
      'gold',
      'gold',
    ])
  })
})

describe('squad level requirements', () => {
  it('checks squad size', () => {
    expect(check(plainSquad(), { type: 'squadSize', value: 11 }).passed).toBe(true)
    expect(check(plainSquad(), { type: 'squadSize', value: 10 }).passed).toBe(false)
  })

  it('checks team rating against min, max and exact', () => {
    const squad = plainSquad() // eleven 84s, so exactly 84
    expect(check(squad, { type: 'teamRating', op: 'min', value: 84 }).passed).toBe(true)
    expect(check(squad, { type: 'teamRating', op: 'min', value: 85 }).passed).toBe(false)
    expect(check(squad, { type: 'teamRating', op: 'max', value: 84 }).passed).toBe(true)
    expect(check(squad, { type: 'teamRating', op: 'exact', value: 84 }).passed).toBe(true)
    expect(check(squad, { type: 'teamRating', op: 'exact', value: 83 }).passed).toBe(false)
    expect(check(squad, { type: 'teamRating', op: 'min', value: 84 }).achieved).toBe(84)
  })

  it('checks team chemistry', () => {
    const shared = FORMATION.slots.map((slot) => ({ positions: [slot], club: 'Arsenal' }))
    expect(check(squadOf(shared), { type: 'teamChemistry', op: 'min', value: 33 }).passed).toBe(true)
    expect(check(plainSquad(), { type: 'teamChemistry', op: 'min', value: 1 }).passed).toBe(false)
  })

  it('checks per player chemistry, which team chemistry cannot express', () => {
    // Ten players on a shared club, one alone. Team total is 30, comfortably past
    // a min 25, but the eleventh player is on 0 and a per player floor catches it.
    const specs = FORMATION.slots.map((slot, index) => ({
      positions: [slot],
      club: index < 10 ? 'Arsenal' : 'Nowhere FC',
    }))
    const squad = squadOf(specs)
    expect(check(squad, { type: 'teamChemistry', op: 'min', value: 25 }).passed).toBe(true)
    expect(check(squad, { type: 'perPlayerChemistry', op: 'min', value: 1 }).passed).toBe(false)
    // With a count, only that many players need to clear the floor.
    expect(
      check(squad, { type: 'perPlayerChemistry', op: 'min', value: 1, count: 10 }).passed,
    ).toBe(true)
  })

  it('checks formation', () => {
    expect(check(plainSquad(), { type: 'formation', value: '4-4-2' }).passed).toBe(true)
    expect(check(plainSquad(), { type: 'formation', value: '4-3-3' }).passed).toBe(false)
  })
})

describe('named entity counts versus any-one-entity counts', () => {
  // The distinction the brief says must not be blurred.
  const squad = squadOf(
    FORMATION.slots.map((slot, index) => ({
      positions: [slot],
      league: index < 5 ? 'Premier League' : index < 9 ? 'La Liga' : 'Serie A',
    })),
  )

  it('min 5 from the Premier League is about that named league', () => {
    expect(check(squad, { type: 'playersFromLeague', league: 'Premier League', op: 'min', value: 5 }).passed).toBe(true)
    expect(check(squad, { type: 'playersFromLeague', league: 'La Liga', op: 'min', value: 5 }).passed).toBe(false)
  })

  it('same league count min 5 is about ANY one league, solver chooses', () => {
    expect(check(squad, { type: 'sameLeagueCount', op: 'min', value: 5 }).passed).toBe(true)
    expect(check(squad, { type: 'sameLeagueCount', op: 'min', value: 6 }).passed).toBe(false)
  })

  it('same league count MAX asks whether every league stays under, not whether one does', () => {
    // The largest group is 5, so max 4 fails even though two leagues are under it.
    expect(check(squad, { type: 'sameLeagueCount', op: 'max', value: 4 }).passed).toBe(false)
    expect(check(squad, { type: 'sameLeagueCount', op: 'max', value: 5 }).passed).toBe(true)
  })

  it('counts distinct entities', () => {
    expect(check(squad, { type: 'distinctLeagues', op: 'exact', value: 3 }).passed).toBe(true)
    expect(check(squad, { type: 'distinctLeagues', op: 'min', value: 4 }).passed).toBe(false)
  })

  it('does not count a null entity as a shared blank', () => {
    const icons = squadOf(
      FORMATION.slots.map((slot) => ({ positions: [slot], cardType: 'icon', club: null, league: null })),
    )
    expect(check(icons, { type: 'distinctClubs', op: 'exact', value: 0 }).passed).toBe(true)
    expect(check(icons, { type: 'sameClubCount', op: 'max', value: 0 }).passed).toBe(true)
  })
})

describe('card property counts', () => {
  it('counts rare, TOTW, card type and promo separately', () => {
    const squad = squadOf(
      FORMATION.slots.map((slot, index) => ({
        positions: [slot],
        cardType: index < 3 ? 'totw' : index < 6 ? 'common' : 'rare',
        ...(index === 0 ? { promoName: 'FUTTIES' } : {}),
      })),
    )
    expect(check(squad, { type: 'totwCount', op: 'min', value: 3 }).passed).toBe(true)
    expect(check(squad, { type: 'totwCount', op: 'min', value: 4 }).passed).toBe(false)
    // Rare is orthogonal to quality and includes TOTW.
    expect(check(squad, { type: 'rareCount', op: 'min', value: 8 }).passed).toBe(true)
    expect(check(squad, { type: 'cardTypeCount', cardType: 'common', op: 'exact', value: 3 }).passed).toBe(true)
    expect(check(squad, { type: 'promoCount', promoName: 'FUTTIES', op: 'min', value: 1 }).passed).toBe(true)
    expect(check(squad, { type: 'promoCount', promoName: 'TOTS', op: 'min', value: 1 }).passed).toBe(false)
  })

  it('counts quality bands derived from rating', () => {
    const squad = squadOf(
      FORMATION.slots.map((slot, index) => ({ positions: [slot], rating: index < 4 ? 80 : 70 })),
    )
    expect(check(squad, { type: 'qualityCount', quality: 'gold', op: 'exact', value: 4 }).passed).toBe(true)
    expect(check(squad, { type: 'qualityCount', quality: 'silver', op: 'min', value: 7 }).passed).toBe(true)
    expect(check(squad, { type: 'qualityCount', quality: 'bronze', op: 'max', value: 0 }).passed).toBe(true)
  })
})

describe('the all-eleven versus counted distinction on minPlayerRating', () => {
  const squad = squadOf(
    FORMATION.slots.map((slot, index) => ({ positions: [slot], rating: index < 3 ? 86 : 80 })),
  )

  it('with no count, every player must clear the bar', () => {
    const result = check(squad, { type: 'minPlayerRating', value: 84 })
    expect(result.passed).toBe(false)
    expect(result.required).toBe('all 11 at 84+')
  })

  it('with a count, only that many must', () => {
    const result = check(squad, { type: 'minPlayerRating', value: 84, count: 3 })
    expect(result.passed).toBe(true)
    expect(result.required).toBe('3 at 84+')
  })

  it('reports the interpretation it took, so the UI can surface it', () => {
    expect(check(squad, { type: 'minPlayerRating', value: 80 }).achieved).toBe('11 of 11 at 80+')
  })

  it('maxPlayerRating reports the highest rated player', () => {
    expect(check(squad, { type: 'maxPlayerRating', value: 86 }).passed).toBe(true)
    expect(check(squad, { type: 'maxPlayerRating', value: 85 }).passed).toBe(false)
    expect(check(squad, { type: 'maxPlayerRating', value: 85 }).achieved).toBe(86)
  })
})

describe('player, position, evolution and manager requirements', () => {
  it('finds a specific player by defId', () => {
    const squad = plainSquad()
    const target = squad.players[4]!.card.definition.defId
    expect(check(squad, { type: 'specificPlayer', defId: target }).passed).toBe(true)
    expect(check(squad, { type: 'specificPlayer', defId: 'not-in-this-squad' }).passed).toBe(false)
  })

  it('counts players in a named position slot', () => {
    expect(check(plainSquad(), { type: 'specificPosition', position: 'ST', op: 'min', value: 2 }).passed).toBe(true)
    expect(check(plainSquad(), { type: 'specificPosition', position: 'ST', op: 'min', value: 3 }).passed).toBe(false)
  })

  it('excludes evolved players', () => {
    const squad = plainSquad()
    expect(check(squad, { type: 'excludeEvolved' }).passed).toBe(true)
    const evolved: Squad = {
      ...squad,
      players: squad.players.map((p, i) =>
        i === 0 ? { ...p, card: { ...p.card, owned: { ...p.card.owned, isEvolved: true } } } : p,
      ),
    }
    expect(check(evolved, { type: 'excludeEvolved' }).passed).toBe(false)
  })

  it('checks the manager nation and league', () => {
    const withManager = squadOf(
      FORMATION.slots.map((slot) => ({ positions: [slot] })),
      { nation: 'Italy', league: 'Serie A' },
    )
    expect(check(withManager, { type: 'managerNation', nation: 'Italy' }).passed).toBe(true)
    expect(check(withManager, { type: 'managerLeague', league: 'La Liga' }).passed).toBe(false)
    expect(check(plainSquad(), { type: 'managerNation', nation: 'Italy' }).achieved).toBe('no manager')
  })
})

describe('the whole checklist', () => {
  it('reports every requirement, passing and failing, with achieved next to required', () => {
    const squad = plainSquad()
    const requirements: Requirement[] = [
      { type: 'squadSize', value: 11 },
      { type: 'teamRating', op: 'min', value: 84 },
      { type: 'teamRating', op: 'min', value: 90 },
      { type: 'teamChemistry', op: 'min', value: 1 },
    ]
    const results = validateSquad(squad, requirements)
    expect(results).toHaveLength(4)
    expect(results.map((r) => r.passed)).toEqual([true, true, false, false])
    expect(results[2]!.achieved).toBe(84)
    expect(results[2]!.required).toBe('min 90')
    expect(squadPasses(squad, requirements)).toBe(false)
    expect(squadPasses(squad, requirements.slice(0, 2))).toBe(true)
  })

  it('an out of position player fails a chemistry requirement it would otherwise pass', () => {
    const cards = unlinkedSquad(11, { positions: ['CM'], club: 'Arsenal' })
    const inPosition: Squad = { formation: FORMATION, players: placeAll(cards, cards.map(() => 'CM')) }
    const misplaced: Squad = {
      formation: FORMATION,
      players: placeAll(cards, cards.map((_, i) => (i === 0 ? 'GK' : 'CM'))),
    }
    const requirement: Requirement = { type: 'teamChemistry', op: 'min', value: 33 }
    expect(check(inPosition, requirement).passed).toBe(true)
    expect(check(misplaced, requirement).passed).toBe(false)
    expect(check(misplaced, requirement).achieved).toBe(30)
  })
})
