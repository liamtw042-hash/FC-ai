import { describe, expect, it } from 'vitest'
import { parseRequirementText } from './parseRequirementText'

function parse(text: string) {
  return parseRequirementText(text)
}

describe('the shapes the game actually writes', () => {
  it('reads a minimum', () => {
    expect(parse('Squad Rating: Min. 85').requirements[0]).toEqual({
      type: 'teamRating',
      op: 'min',
      value: 85,
    })
  })

  it('reads a maximum', () => {
    expect(parse('Nations: Max. 5').requirements[0]).toMatchObject({
      type: 'distinctNations',
      op: 'max',
      value: 5,
    })
  })

  it('reads an exact count', () => {
    expect(parse('Number of players in the Squad: 11').requirements[0]).toMatchObject({
      type: 'squadSize',
      op: 'exact',
      value: 11,
    })
  })

  it('reads chemistry', () => {
    expect(parse('Team Chemistry: Min. 27').requirements[0]).toMatchObject({
      type: 'teamChemistry',
      op: 'min',
      value: 27,
    })
  })

  it('reads a named league', () => {
    expect(parse('Players from Premier League: Min. 4').requirements[0]).toMatchObject({
      type: 'playersFromLeague',
      league: 'Premier League',
      op: 'min',
      value: 4,
    })
  })

  it('reads a nationality, where the name is to the right of the colon', () => {
    expect(parse('Nationality: Spain: Min. 3').requirements[0]).toMatchObject({
      type: 'playersFromNation',
      nation: 'Spain',
      op: 'min',
      value: 3,
    })
  })

  it('reads a nation name with a space in it', () => {
    expect(parse('Nationality: Republic of Ireland: Min. 2').requirements[0]).toMatchObject({
      nation: 'Republic of Ireland',
      value: 2,
    })
  })

  it('keeps the word League in a league name, because it is part of the name', () => {
    expect(parse('Players from Serie A: Min. 3').requirements[0]).toMatchObject({
      league: 'Serie A',
    })
  })

  it('reads the same league count', () => {
    expect(parse('Same League Count: Min. 4').requirements[0]).toMatchObject({
      type: 'sameLeagueCount',
      op: 'min',
      value: 4,
    })
  })

  it('reads rare and team of the week', () => {
    const result = parse('Rare: Min. 11\nTeam of the Week Players: Min. 1')
    expect(result.requirements.map((requirement) => requirement.type)).toEqual([
      'rareCount',
      'totwCount',
    ])
  })

  it('reads player quality as a quality rather than a number', () => {
    expect(parse('Player Quality: Exactly Gold').requirements[0]).toMatchObject({
      type: 'qualityCount',
      quality: 'gold',
    })
  })

  it('reads a whole pasted block', () => {
    const result = parse(`
      Number of players in the Squad: 11
      Squad Rating: Min. 85
      Team Chemistry: Min. 27
      Rare: Min. 11
    `)
    expect(result.requirements).toHaveLength(4)
    expect(result.unrecognised).toEqual([])
  })

  it('ignores blank lines rather than calling them unrecognised', () => {
    const result = parse('\n\nSquad Rating: Min. 85\n\n')
    expect(result.lines).toHaveLength(1)
    expect(result.unrecognised).toEqual([])
  })
})

describe('it never silently drops a line', () => {
  // The whole reason this file exists. A parser that ignores what it does not
  // understand produces a squad that satisfies four of five requirements and
  // looks like a success.
  it('returns an unrecognised label with its text and line number intact', () => {
    const result = parse('Squad Rating: Min. 85\nSomething The Game Invented: Min. 2')
    expect(result.requirements).toHaveLength(1)
    expect(result.unrecognised).toHaveLength(1)
    expect(result.unrecognised[0]?.text).toBe('Something The Game Invented: Min. 2')
    expect(result.unrecognised[0]?.line).toBe(2)
    expect(result.unrecognised[0]?.problem).toContain('label was not recognised')
  })

  it('keeps the original line numbering when earlier lines were blank', () => {
    const result = parse('\n\nNonsense\n')
    expect(result.unrecognised[0]?.line).toBe(3)
  })

  it('reports a recognised label with no number rather than assuming one', () => {
    const result = parse('Squad Rating: quite high')
    expect(result.requirements).toEqual([])
    expect(result.unrecognised[0]?.problem).toContain('no number in it')
  })

  it('NEVER guesses a number from a word', () => {
    const result = parse('Rare: a few')
    expect(result.requirements).toEqual([])
    expect(result.unrecognised).toHaveLength(1)
  })

  it('refuses a quality it does not know', () => {
    const result = parse('Player Quality: Exactly Platinum')
    expect(result.unrecognised[0]?.problem).toContain('not bronze, silver or gold')
  })

  it('returns every line, parsed or not, so the confirmation screen can show both', () => {
    const result = parse('Squad Rating: Min. 85\nNonsense\nRare: Min. 11')
    expect(result.lines).toHaveLength(3)
    expect(result.lines.map((entry) => entry.requirement !== null)).toEqual([true, false, true])
  })
})

describe('operators', () => {
  it('accepts the long spellings as well as the short ones', () => {
    expect(parse('Squad Rating: at least 85').requirements[0]).toMatchObject({ op: 'min' })
    expect(parse('Nations: no more than 5').requirements[0]).toMatchObject({ op: 'max' })
    expect(parse('Same Club Count: exactly 3').requirements[0]).toMatchObject({ op: 'exact' })
  })

  it('treats a bare number as exact where the requirement is a count', () => {
    expect(parse('Same Nation Count: 4').requirements[0]).toMatchObject({ op: 'min' })
    expect(parse('Number of players in the Squad: 11').requirements[0]).toMatchObject({
      op: 'exact',
    })
  })

  it('reads a maximum player rating as a maximum even with no operator word', () => {
    expect(parse('Max Player Rating: 84').requirements[0]).toMatchObject({
      type: 'maxPlayerRating',
      op: 'max',
      value: 84,
    })
  })
})
