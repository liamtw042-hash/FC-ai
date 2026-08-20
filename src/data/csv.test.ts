import { describe, expect, it } from 'vitest'
import { CsvError, indexHeader, normaliseHeader, parseCsv, parseFlag } from './csv'

describe('parseCsv', () => {
  it('reads a plain file', () => {
    const table = parseCsv('a,b\n1,2\n3,4\n')
    expect(table.header).toEqual(['a', 'b'])
    expect(table.rows.map((row) => row.values)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('numbers lines the way an editor does, header included', () => {
    const table = parseCsv('a,b\n1,2\n3,4\n')
    expect(table.rows.map((row) => row.line)).toEqual([2, 3])
  })

  it('keeps commas and newlines that are inside quotes', () => {
    const table = parseCsv('a,b\n"one, two","line\nbreak"\n')
    expect(table.rows[0]?.values).toEqual(['one, two', 'line\nbreak'])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"say ""hi"""\n').rows[0]?.values).toEqual(['say "hi"'])
  })

  it('tolerates carriage returns and a missing final newline', () => {
    const table = parseCsv('a,b\r\n1,2\r\n3,4')
    expect(table.rows.map((row) => row.values)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('skips blank lines rather than reading them as a row', () => {
    expect(parseCsv('a\n1\n\n2\n').rows).toHaveLength(2)
  })

  // The point of the whole file: a short row is an error, not a repair. A row
  // padded with blanks is how a club ends up holding cards that do not exist.
  it('REFUSES a row that does not match the header, and says which line', () => {
    expect(() => parseCsv('a,b,c\n1,2\n')).toThrow(CsvError)
    try {
      parseCsv('a,b,c\n1,2,3\n4,5\n')
    } catch (error) {
      expect((error as CsvError).line).toBe(3)
      expect((error as CsvError).message).toContain('expected 3 field(s)')
    }
  })

  it('refuses a file that ends inside a quoted field', () => {
    expect(() => parseCsv('a\n"unterminated\n')).toThrow(/ends inside a quoted field/)
  })

  it('refuses a quote that opens partway through a field', () => {
    expect(() => parseCsv('a\nno"pe\n')).toThrow(/may only open a field/)
  })

  it('accepts a different delimiter', () => {
    expect(parseCsv('a\tb\n1\t2\n', '\t').rows[0]?.values).toEqual(['1', '2'])
  })

  it('returns an empty table for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] })
  })
})

describe('header matching', () => {
  it('ignores case, spaces, underscores and dashes', () => {
    const index = indexHeader(['Def ID', 'card_type', 'is-womens'])
    expect(index.get(normaliseHeader('defId'))).toBe(0)
    expect(index.get(normaliseHeader('cardType'))).toBe(1)
    expect(index.get(normaliseHeader('isWomens'))).toBe(2)
  })
})

describe('parseFlag', () => {
  it('reads the spellings exports actually use', () => {
    for (const yes of ['1', 'true', 'TRUE', 'yes', 'Y']) expect(parseFlag(yes)).toBe(true)
    for (const no of ['0', 'false', 'no', 'N', '']) expect(parseFlag(no)).toBe(false)
  })

  // An unrecognised flag read as false is a silent data change, and this one
  // decides whether a card can be submitted at all.
  it('returns null for anything else rather than picking a side', () => {
    expect(parseFlag('maybe')).toBeNull()
    expect(parseFlag('2')).toBeNull()
  })
})
