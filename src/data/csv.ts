/**
 * A small CSV reader. No dependency, because the rules engine has none and this
 * sits next to it.
 *
 * RFC 4180 as far as it matters here: quoted fields, doubled quotes inside them,
 * commas and newlines inside quotes, and a tolerated trailing newline. A
 * delimiter other than a comma can be passed, so the same reader takes the tab
 * separated exports some sources produce.
 *
 * WHAT IT DOES NOT DO IS GUESS. A row with the wrong number of fields is an
 * error with its line number, not a row padded with blanks. Silently repaired
 * input is how a club ends up with eleven cards that do not exist.
 */

export interface CsvRow {
  /** 1 based, counting the header, so it matches what an editor shows. */
  line: number
  values: string[]
}

export interface CsvTable {
  header: string[]
  rows: CsvRow[]
}

export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message)
    this.name = 'CsvError'
  }
}

export function parseCsv(text: string, delimiter = ','): CsvTable {
  if (delimiter.length !== 1) {
    throw new CsvError(`delimiter must be a single character, got ${JSON.stringify(delimiter)}`, 0)
  }

  const records: string[][] = []
  const lineOf: number[] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  let line = 1
  let recordStart = 1
  let sawAnything = false

  const endField = (): void => {
    record.push(field)
    field = ''
  }
  const endRecord = (): void => {
    endField()
    // A blank line is skipped rather than becoming a one empty field row.
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record)
      lineOf.push(recordStart)
    }
    record = []
    recordStart = line + 1
  }

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]
    sawAnything = true
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        if (character === '\n') line += 1
        field += character
      }
      continue
    }
    if (character === '"') {
      if (field !== '') {
        throw new CsvError('a quote may only open a field, not appear inside one', line)
      }
      quoted = true
    } else if (character === delimiter) {
      endField()
    } else if (character === '\r') {
      // Swallowed. The \n that follows ends the record.
    } else if (character === '\n') {
      endRecord()
      line += 1
    } else {
      field += character
    }
  }
  if (quoted) throw new CsvError('the file ends inside a quoted field', line)
  if (sawAnything && (field !== '' || record.length > 0)) endRecord()

  if (records.length === 0) return { header: [], rows: [] }

  const header = (records[0] ?? []).map((name) => name.trim())
  const width = header.length
  const rows: CsvRow[] = []
  for (let index = 1; index < records.length; index += 1) {
    const values = records[index] ?? []
    const line = lineOf[index] ?? 0
    if (values.length !== width) {
      throw new CsvError(
        `expected ${width} field(s) to match the header, found ${values.length}`,
        line,
      )
    }
    rows.push({ line, values })
  }
  return { header, rows }
}

/** Header name to index, case and space insensitive, so exports vary freely. */
export function indexHeader(header: readonly string[]): Map<string, number> {
  const index = new Map<string, number>()
  header.forEach((name, position) => {
    const key = normaliseHeader(name)
    // First wins. A duplicate column is reported by the caller that needs it.
    if (!index.has(key)) index.set(key, position)
  })
  return index
}

export function normaliseHeader(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export interface RowError {
  line: number
  column?: string | undefined
  message: string
}

export interface LoadResult<T> {
  rows: T[]
  errors: RowError[]
  /** Header names the map did not ask for. Reported, never a failure. */
  ignoredColumns: string[]
}

/**
 * Yes and no, in the spellings exports actually use. An empty cell is no, which
 * is the one default this file allows and the only one a blank can honestly mean.
 * Anything else is null, and the caller turns that into an error: an unrecognised
 * flag quietly read as false is a silent data change.
 */
export function parseFlag(value: string): boolean | null {
  const text = value.trim().toLowerCase()
  if (text === '') return false
  if (['1', 'true', 'yes', 'y'].includes(text)) return true
  if (['0', 'false', 'no', 'n'].includes(text)) return false
  return null
}
