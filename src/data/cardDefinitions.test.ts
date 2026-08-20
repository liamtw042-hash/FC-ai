import { describe, expect, it } from 'vitest'
import { DEFAULT_CARD_COLUMNS, loadCardDefinitions } from './cardDefinitions'

const HEADER = 'defId,name,rating,positions,nation,league,club,cardType,isWomens,promoName'
const SAKA = 'p1,B. Saka,86,RW|RM,England,Premier League,Arsenal,rare,no,'
const ICON = 'p2,R. Baggio,91,CAM|CF,Italy,,,icon,no,'

function load(...rows: string[]) {
  return loadCardDefinitions([HEADER, ...rows].join('\n') + '\n')
}

describe('loadCardDefinitions', () => {
  it('reads a row into a CardDefinition', () => {
    const result = load(SAKA)
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toEqual({
      defId: 'p1',
      name: 'B. Saka',
      rating: 86,
      positions: ['RW', 'RM'],
      nation: 'England',
      league: 'Premier League',
      club: 'Arsenal',
      cardType: 'rare',
      isWomens: false,
    })
  })

  it('reads a blank league and club as null rather than as an empty string', () => {
    const icon = load(ICON).rows[0]
    expect(icon?.league).toBeNull()
    expect(icon?.club).toBeNull()
  })

  it('omits promoName entirely when the cell is blank', () => {
    expect('promoName' in (load(SAKA).rows[0] ?? {})).toBe(false)
    const promo = load('p3,X. Y,88,ST,Brazil,Serie A,Milan,futties,no,FUTTIES').rows[0]
    expect(promo?.promoName).toBe('FUTTIES')
  })

  // Source agnostic means the column names are data, not something to edit the
  // export into.
  it('takes a different set of column names', () => {
    const text = 'ID,Player,OVR,Pos,Country,Comp,Team,Type,Womens\n' + 'x1,A. B,84,CB,Spain,LaLiga,Sevilla,rare,no\n'
    const result = loadCardDefinitions(text, {
      columns: {
        defId: 'ID',
        name: 'Player',
        rating: 'OVR',
        positions: 'Pos',
        nation: 'Country',
        league: 'Comp',
        club: 'Team',
        cardType: 'Type',
        isWomens: 'Womens',
      },
    })
    expect(result.errors).toEqual([])
    expect(result.rows[0]?.defId).toBe('x1')
  })

  it('matches headers regardless of case, spaces and underscores', () => {
    const text = 'Def ID,Name,Rating,Positions,Nation,League,Club,card_type,is-womens\n' + 'x1,A. B,84,CB,Spain,LaLiga,Sevilla,rare,no\n'
    expect(loadCardDefinitions(text).errors).toEqual([])
  })

  it('resolves aliases so womens items link to the same club', () => {
    const text = HEADER + '\nw1,A. Russo,88,ST,England,Barclays WSL,Arsenal Women,rare,yes,\n'
    const result = loadCardDefinitions(text, {
      aliases: { clubs: { 'Arsenal Women': 'Arsenal' }, leagues: {}, nations: {} },
    })
    expect(result.rows[0]?.club).toBe('Arsenal')
  })

  it('reports every unusable row with its line number rather than dropping it', () => {
    const result = load(SAKA, 'p9,,notanumber,,,,,,,')
    expect(result.rows).toHaveLength(1)
    const lines = result.errors.map((error) => error.line)
    expect(new Set(lines)).toEqual(new Set([3]))
    expect(result.errors.map((error) => error.message).join(' ')).toContain('rating')
  })

  it('rejects a duplicate defId, because two stacks would silently merge', () => {
    const result = load(SAKA, SAKA)
    expect(result.rows).toHaveLength(1)
    expect(result.errors[0]?.message).toContain('duplicate defId p1')
  })

  it('rejects an unrecognised isWomens value rather than reading it as no', () => {
    const result = load('p4,A. B,84,CB,Spain,LaLiga,Sevilla,rare,maybe,')
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]?.message).toContain('isWomens')
  })

  // An Icon has no league and no club. A file that omits the columns cannot be
  // told apart from one that forgot them, so the columns are required and the
  // CELLS are what may be blank.
  it('requires the league and club columns to exist even though the cells may be blank', () => {
    const text = 'defId,name,rating,positions,nation,cardType,isWomens\np1,A,84,CB,Spain,rare,no\n'
    const result = loadCardDefinitions(text)
    expect(result.rows).toHaveLength(0)
    expect(result.errors.map((error) => error.column)).toContain('league')
    expect(result.errors[0]?.message).toContain('Leave the cell empty')
  })

  it('names a missing required column once, at line 1, and loads nothing', () => {
    const result = loadCardDefinitions('name,rating\nA,84\n')
    expect(result.rows).toEqual([])
    expect(result.errors.every((error) => error.line === 1)).toBe(true)
    expect(result.errors.map((error) => error.column)).toContain(DEFAULT_CARD_COLUMNS.defId)
  })

  it('lists columns it did not use rather than failing on them', () => {
    const text = HEADER + ',pace,shooting\n' + SAKA + ',95,88\n'
    const result = loadCardDefinitions(text)
    expect(result.errors).toEqual([])
    expect(result.ignoredColumns).toEqual(['pace', 'shooting'])
  })
})
