import { describe, expect, it } from 'vitest'
import { describeCoverage, loadClub } from './clubImport'

const HEADER =
  'defId,quantity,pool,untradeable,isLoan,isEvolved,locked,inActiveSquad,estimatedPrice,positionOverride,squadName,favourite,observed'

function load(rows: string[], options = {}) {
  return loadClub([HEADER, ...rows].join('\n') + '\n', options)
}

describe('loadClub', () => {
  it('reads a stack', () => {
    const result = load(['p1,3,club,no,no,no,no,no,2600,,,,'])
    expect(result.errors).toEqual([])
    const row = result.rows[0]
    expect(row?.defId).toBe('p1')
    expect(row?.quantity).toBe(3)
    expect(row?.estimatedPrice).toBe(2600)
  })

  it('reads a blank price as unknown rather than as free', () => {
    expect(load(['p1,1,club,no,no,no,no,no,,,,,']).rows[0]?.estimatedPrice).toBeNull()
  })

  it('reads a position override', () => {
    expect(load(['p1,1,club,no,no,no,no,no,,CDM|CM,,,']).rows[0]?.positionOverride).toEqual([
      'CDM',
      'CM',
    ])
  })
})

describe('provenance, RESEARCH.md 8.2', () => {
  // The whole point. A field nobody screenshotted is DEFAULTED, not known, and
  // the difference has to survive the import or the club page is quoting a guess.
  it('marks a field defaulted when the row does not say it was observed', () => {
    const row = load(['p1,1,club,no,no,no,no,no,,,,,']).rows[0]
    expect(row?.provenance).toEqual({
      untradeable: 'defaulted',
      isLoan: 'defaulted',
      locked: 'defaulted',
      inActiveSquad: 'defaulted',
    })
  })

  it('marks exactly the fields the row lists as observed', () => {
    const row = load(['p1,1,club,yes,no,no,no,no,,,,,untradeable|isLoan']).rows[0]
    expect(row?.provenance?.untradeable).toBe('observed')
    expect(row?.provenance?.isLoan).toBe('observed')
    expect(row?.provenance?.locked).toBe('defaulted')
  })

  it('rejects an observed field name it does not recognise', () => {
    const result = load(['p1,1,club,no,no,no,no,no,,,,,tradeable'])
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]?.message).toContain('untradeable, isLoan, locked, inActiveSquad')
  })

  it('treats a file with no observed column as nothing observed anywhere', () => {
    const text = 'defId,quantity,untradeable\np1,1,yes\n'
    const result = loadClub(text)
    expect(result.errors).toEqual([])
    expect(result.rows[0]?.provenance?.untradeable).toBe('defaulted')
    expect(result.coverage.observed.untradeable).toBe(0)
  })
})

describe('coverage', () => {
  // Counts CARDS, not rows. A stack of six untradeable duplicates is six cards
  // whose status is known, and counting rows understates a club full of fodder.
  it('counts cards rather than stacks', () => {
    const result = load([
      'p1,6,club,yes,no,no,no,no,,,,,untradeable',
      'p2,1,club,no,no,no,no,no,,,,,',
    ])
    expect(result.coverage.cards).toBe(7)
    expect(result.coverage.stacks).toBe(2)
    expect(result.coverage.observed.untradeable).toBe(6)
  })

  it('says how many were defaulted rather than leaving silence to read as no', () => {
    const result = load([
      'p1,6,club,yes,no,no,no,no,,,,,untradeable',
      'p2,1,club,no,no,no,no,no,,,,,',
    ])
    const described = describeCoverage(result.coverage)
    expect(described).toContain('untradeable known for 6 of 7')
    expect(described).toContain('the other 1 DEFAULTED rather than seen')
  })

  it('says nothing extra when a field is fully covered', () => {
    const result = load(['p1,2,club,yes,no,no,no,no,,,,,untradeable|isLoan|locked|inActiveSquad'])
    expect(describeCoverage(result.coverage)).not.toContain('DEFAULTED')
  })
})

describe('validation', () => {
  it('names defIds that are not in the card database', () => {
    const result = load(['p1,1,club,no,no,no,no,no,,,,,', 'ghost,1,club,no,no,no,no,no,,,,,'], {
      knownDefIds: new Set(['p1']),
    })
    expect(result.unknownDefIds).toEqual(['ghost'])
  })

  it('rejects a quantity that is not a whole number of at least one', () => {
    expect(load(['p1,0,club,no,no,no,no,no,,,,,']).errors[0]?.message).toContain('quantity')
    expect(load(['p1,1.5,club,no,no,no,no,no,,,,,']).errors[0]?.message).toContain('quantity')
  })

  it('rejects a pool it does not recognise', () => {
    expect(load(['p1,1,transfers,no,no,no,no,no,,,,,']).errors[0]?.message).toContain('pool')
  })

  it('rejects a fractional price, because the cost model refuses one anyway', () => {
    expect(load(['p1,1,club,no,no,no,no,no,25.5,,,,']).errors[0]?.message).toContain(
      'estimatedPrice',
    )
  })

  it('requires defId and quantity columns and loads nothing without them', () => {
    const result = loadClub('name,quantity\nA,1\n')
    expect(result.rows).toEqual([])
    expect(result.errors[0]?.column).toBe('defId')
  })
})
