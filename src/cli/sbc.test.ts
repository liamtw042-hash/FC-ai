import { describe, expect, it } from 'vitest'
import { RequirementSyntaxError, parseRequirement, slug } from './sbc'

describe('parseRequirement', () => {
  it('reads type, op and value', () => {
    expect(parseRequirement('totwCount:min:1')).toEqual({
      type: 'totwCount',
      op: 'min',
      value: 1,
    })
  })

  it('reads key=value extras', () => {
    expect(parseRequirement('playersFromLeague:min:4:league=Premier Division')).toEqual({
      type: 'playersFromLeague',
      op: 'min',
      value: 4,
      league: 'Premier Division',
    })
  })

  it('reads a numeric extra as a number', () => {
    expect(parseRequirement('perPlayerChemistry:min:2:count=8')).toMatchObject({ count: 8 })
  })

  it('takes a type with no op or value', () => {
    expect(parseRequirement('excludeEvolved')).toEqual({ type: 'excludeEvolved' })
  })

  // A shorthand that guesses is a second requirement language with no tests.
  it('REFUSES an op it does not know rather than assuming min', () => {
    expect(() => parseRequirement('totwCount:atleast:1')).toThrow(RequirementSyntaxError)
  })

  it('refuses a value that is not a whole number', () => {
    expect(() => parseRequirement('totwCount:min:1.5')).toThrow(/whole number/)
  })

  it('refuses an extra that is not key=value', () => {
    expect(() => parseRequirement('playersFromLeague:min:4:PremierDivision')).toThrow(/key=value/)
  })

  it('refuses an empty type', () => {
    expect(() => parseRequirement(':min:4')).toThrow(RequirementSyntaxError)
  })
})

describe('slug', () => {
  it('makes a filename that keeps the name readable', () => {
    expect(slug('Premier Marquee!')).toBe('premier-marquee')
    expect(slug('eighty five')).toBe('eighty-five')
  })
})
