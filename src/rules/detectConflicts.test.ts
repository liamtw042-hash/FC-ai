import { describe, expect, it } from 'vitest'
import { detectConflicts } from './detectConflicts'
import type { Requirement } from '../types/requirements'

function reasons(requirements: Requirement[]): string[] {
  return detectConflicts(requirements).map((c) => c.reason)
}

function expectClean(requirements: Requirement[]): void {
  expect(detectConflicts(requirements)).toEqual([])
}

describe('contradictory bounds on one quantity', () => {
  it('catches a rating that must be both high and low', () => {
    expect(
      reasons([
        { type: 'teamRating', op: 'min', value: 90 },
        { type: 'teamRating', op: 'max', value: 85 },
      ]).join(' '),
    ).toContain('squad rating is required to be at least 90 and at most 85')
  })

  it('catches an exact rating below a forced minimum player rating', () => {
    expect(
      reasons([
        { type: 'teamRating', op: 'exact', value: 82 },
        { type: 'minPlayerRating', value: 84 },
      ]).join(' '),
    ).toContain('at most 82 is impossible when every player must be at least 84')
  })

  it('catches a rating target above the maximum any player may be', () => {
    expect(
      reasons([
        { type: 'teamRating', op: 'min', value: 88 },
        { type: 'maxPlayerRating', value: 85 },
      ]).join(' '),
    ).toContain('a squad rating of 88 is impossible when no player may exceed 85')
  })

  it('catches a player rating window that is empty', () => {
    expect(
      reasons([{ type: 'minPlayerRating', value: 86 }, { type: 'maxPlayerRating', value: 84 }]).join(' '),
    ).toContain('at least 86 and at most 84')
  })

  it('catches contradictory counts for one named league', () => {
    expect(
      reasons([
        { type: 'playersFromLeague', league: 'Premier League', op: 'min', value: 6 },
        { type: 'playersFromLeague', league: 'Premier League', op: 'max', value: 4 },
      ]).join(' '),
    ).toContain('players from Premier League must be at least 6 and at most 4')
  })
})

describe('counts that do not fit in eleven players', () => {
  it('catches named minimums across different leagues that overflow the squad', () => {
    expect(
      reasons([
        { type: 'playersFromLeague', league: 'Premier League', op: 'min', value: 6 },
        { type: 'playersFromLeague', league: 'La Liga', op: 'min', value: 6 },
      ]).join(' '),
    ).toContain('require 12 players between them')
  })

  it('allows named minimums that just fit', () => {
    expectClean([
      { type: 'playersFromLeague', league: 'Premier League', op: 'min', value: 6 },
      { type: 'playersFromLeague', league: 'La Liga', op: 'min', value: 5 },
    ])
  })

  it('catches quality band minimums that overflow', () => {
    expect(
      reasons([
        { type: 'qualityCount', quality: 'gold', op: 'min', value: 8 },
        { type: 'qualityCount', quality: 'silver', op: 'min', value: 5 },
      ]).join(' '),
    ).toContain('quality band minimums require 13 players')
  })

  it('catches more distinct nations than there are players', () => {
    expect(reasons([{ type: 'distinctNations', op: 'min', value: 12 }]).join(' ')).toContain(
      'needs at least 12, but the squad only has 11',
    )
  })

  it('catches a large shared block alongside many distinct entities', () => {
    // 8 in one league plus 5 distinct leagues needs 8 + 4 = 12 cards.
    expect(
      reasons([
        { type: 'sameLeagueCount', op: 'min', value: 8 },
        { type: 'distinctLeagues', op: 'min', value: 5 },
      ]).join(' '),
    ).toContain('needs 12 players, more than')
  })

  it('allows the same pairing when it fits exactly', () => {
    expectClean([
      { type: 'sameLeagueCount', op: 'min', value: 7 },
      { type: 'distinctLeagues', op: 'min', value: 5 },
    ])
  })
})

describe('chemistry impossibilities', () => {
  it('catches a squad chemistry above 33', () => {
    expect(reasons([{ type: 'teamChemistry', op: 'min', value: 34 }]).join(' ')).toContain(
      'cannot exceed 33',
    )
  })

  it('catches a per player chemistry above 3', () => {
    expect(reasons([{ type: 'perPlayerChemistry', op: 'min', value: 4 }]).join(' ')).toContain(
      'cannot exceed 3 chemistry',
    )
  })

  it('accepts the maximum, which is exactly reachable', () => {
    expectClean([
      { type: 'teamChemistry', op: 'min', value: 33 },
      { type: 'perPlayerChemistry', op: 'min', value: 3 },
    ])
  })
})

describe('structural conflicts', () => {
  it('catches two different formations', () => {
    expect(
      reasons([
        { type: 'formation', value: '4-4-2' },
        { type: 'formation', value: '4-3-3' },
      ]).join(' '),
    ).toContain('two different formations')
  })

  it('accepts the same formation stated twice', () => {
    expectClean([
      { type: 'formation', value: '4-4-2' },
      { type: 'formation', value: '4-4-2' },
    ])
  })

  it('catches a squad size this solver does not build', () => {
    expect(reasons([{ type: 'squadSize', value: 8 }]).join(' ')).toContain('is not supported')
  })
})

describe('scope: requirements alone, never the club', () => {
  // The brief's example of one distinct league alongside five distinct nations is
  // NOT a conflict in the requirements. Plenty of eleven card squads satisfy it.
  // Whether MY club can is a different question, and it belongs to the
  // impossibility diagnosis at checkpoint 12, which has the pool to answer it.
  it('does not flag one league with five nations, which is perfectly buildable', () => {
    expectClean([
      { type: 'distinctLeagues', op: 'exact', value: 1 },
      { type: 'distinctNations', op: 'min', value: 5 },
    ])
  })

  it('reports nothing for an ordinary, satisfiable SBC', () => {
    expectClean([
      { type: 'squadSize', value: 11 },
      { type: 'teamRating', op: 'min', value: 84 },
      { type: 'teamChemistry', op: 'min', value: 25 },
      { type: 'playersFromLeague', league: 'Premier League', op: 'min', value: 4 },
      { type: 'rareCount', op: 'min', value: 11 },
      { type: 'minPlayerRating', value: 80 },
    ])
  })
})

describe('conflicts carry the requirements that caused them', () => {
  it('so the UI can point at the offending lines', () => {
    const requirements: Requirement[] = [
      { type: 'teamRating', op: 'min', value: 90 },
      { type: 'maxPlayerRating', value: 85 },
    ]
    const conflicts = detectConflicts(requirements)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.requirements).toEqual(expect.arrayContaining(requirements))
  })
})
