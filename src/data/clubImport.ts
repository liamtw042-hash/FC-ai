/**
 * Club import, with provenance. RESEARCH.md 8.2.
 *
 * The four fields that decide what is safe to burn, `untradeable`, `isLoan`,
 * `locked` and `inActiveSquad`, are not all visible in one screenshot pass. A
 * card that was never seen in a status pass is DEFAULTED, not known, and this
 * loader records which of the two it was per card rather than letting a default
 * pass for an observation.
 *
 * That is what the coverage report is for. "Untradeable status known for 210 of
 * 612 cards" is a true sentence about the club. "Nothing is untradeable" is a
 * guess wearing the same clothes.
 */

import type { FieldSource, OwnedCard, StatusProvenance } from '../types/cards'
import {
  indexHeader,
  normaliseHeader,
  parseCsv,
  parseFlag,
  type LoadResult,
  type RowError,
} from './csv'

export const STATUS_FIELDS = ['untradeable', 'isLoan', 'locked', 'inActiveSquad'] as const
export type StatusField = (typeof STATUS_FIELDS)[number]

export interface ClubColumnMap {
  defId: string
  quantity: string
  pool: string
  untradeable: string
  isLoan: string
  isEvolved: string
  locked: string
  inActiveSquad: string
  estimatedPrice: string
  positionOverride: string
  squadName: string
  favourite: string
  /**
   * Which status fields this row was actually OBSERVED for, separated by pipes.
   * Anything not listed is defaulted. An absent column means nothing was observed
   * anywhere, which is the honest reading of an export that does not say.
   */
  observed: string
}

export const DEFAULT_CLUB_COLUMNS: ClubColumnMap = {
  defId: 'defId',
  quantity: 'quantity',
  pool: 'pool',
  untradeable: 'untradeable',
  isLoan: 'isLoan',
  isEvolved: 'isEvolved',
  locked: 'locked',
  inActiveSquad: 'inActiveSquad',
  estimatedPrice: 'estimatedPrice',
  positionOverride: 'positionOverride',
  squadName: 'squadName',
  favourite: 'favourite',
  observed: 'observed',
}

export interface Coverage {
  cards: number
  stacks: number
  observed: Record<StatusField, number>
}

export interface ClubLoadResult extends LoadResult<OwnedCard> {
  coverage: Coverage
  /** defIds in the club file with no matching card definition. */
  unknownDefIds: string[]
}

export interface ClubLoadOptions {
  columns?: Partial<ClubColumnMap>
  /** defIds that exist in the loaded card database. Omitted means do not check. */
  knownDefIds?: ReadonlySet<string>
  positionSeparator?: string
}

export function loadClub(text: string, options: ClubLoadOptions = {}): ClubLoadResult {
  const map: ClubColumnMap = { ...DEFAULT_CLUB_COLUMNS, ...options.columns }
  const separator = options.positionSeparator ?? '|'
  const table = parseCsv(text)
  const header = indexHeader(table.header)

  const errors: RowError[] = []
  const columnOf = new Map<keyof ClubColumnMap, number>()
  for (const [field, name] of Object.entries(map) as [keyof ClubColumnMap, string][]) {
    const position = header.get(normaliseHeader(name))
    if (position !== undefined) columnOf.set(field, position)
  }
  for (const field of ['defId', 'quantity'] as const) {
    if (!columnOf.has(field)) {
      errors.push({ line: 1, column: map[field], message: `required column ${map[field]} is missing` })
    }
  }
  const empty: Coverage = { cards: 0, stacks: 0, observed: blankCounts() }
  if (errors.length > 0) {
    return { rows: [], errors, ignoredColumns: [], coverage: empty, unknownDefIds: [] }
  }

  const wanted = new Set([...columnOf.values()])
  const ignoredColumns = table.header.filter((_, position) => !wanted.has(position))

  const rows: OwnedCard[] = []
  const unknown = new Set<string>()
  const observedCounts = blankCounts()
  let cards = 0

  table.rows.forEach((row, index) => {
    const cell = (field: keyof ClubColumnMap): string => {
      const position = columnOf.get(field)
      return position === undefined ? '' : (row.values[position] ?? '').trim()
    }
    const before = errors.length

    const defId = cell('defId')
    if (defId === '') errors.push({ line: row.line, column: map.defId, message: 'defId is empty' })
    else if (options.knownDefIds && !options.knownDefIds.has(defId)) unknown.add(defId)

    const quantity = Number(cell('quantity'))
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.push({
        line: row.line,
        column: map.quantity,
        message: `quantity ${JSON.stringify(cell('quantity'))} is not a whole number of at least 1`,
      })
    }

    const poolText = cell('pool') || 'club'
    if (poolText !== 'club' && poolText !== 'sbc_storage') {
      errors.push({
        line: row.line,
        column: map.pool,
        message: `pool ${JSON.stringify(poolText)} is not club or sbc_storage`,
      })
    }

    const FLAG_FIELDS = [
      'untradeable',
      'isLoan',
      'isEvolved',
      'locked',
      'inActiveSquad',
      'favourite',
    ] as const
    const flags: Record<(typeof FLAG_FIELDS)[number], boolean> = {
      untradeable: false,
      isLoan: false,
      isEvolved: false,
      locked: false,
      inActiveSquad: false,
      favourite: false,
    }
    for (const field of FLAG_FIELDS) {
      const parsed = parseFlag(cell(field))
      if (parsed === null) {
        errors.push({
          line: row.line,
          column: map[field],
          message: `${field} ${JSON.stringify(cell(field))} is not a yes or no value`,
        })
      } else {
        flags[field] = parsed
      }
    }

    const priceText = cell('estimatedPrice')
    let estimatedPrice: number | null = null
    if (priceText !== '') {
      const price = Number(priceText)
      if (!Number.isInteger(price) || price < 0) {
        errors.push({
          line: row.line,
          column: map.estimatedPrice,
          message: `estimatedPrice ${JSON.stringify(priceText)} is not a whole number of coins`,
        })
      } else {
        estimatedPrice = price
      }
    }

    const observedList = cell('observed')
      .split(separator)
      .map((field) => field.trim())
      .filter((field) => field !== '')
    for (const field of observedList) {
      if (!(STATUS_FIELDS as readonly string[]).includes(field)) {
        errors.push({
          line: row.line,
          column: map.observed,
          message: `observed lists ${JSON.stringify(field)}, which is not one of ${STATUS_FIELDS.join(', ')}`,
        })
      }
    }
    if (errors.length > before) return

    const provenance = {} as StatusProvenance
    for (const field of STATUS_FIELDS) {
      const source: FieldSource = observedList.includes(field) ? 'observed' : 'defaulted'
      provenance[field] = source
      if (source === 'observed') observedCounts[field] += quantity
    }

    const override = cell('positionOverride')
      .split(separator)
      .map((position) => position.trim())
      .filter((position) => position !== '')

    cards += quantity
    rows.push({
      id: `${defId}#${index}`,
      defId,
      quantity,
      pool: poolText as OwnedCard['pool'],
      untradeable: flags.untradeable,
      isLoan: flags.isLoan,
      isEvolved: flags.isEvolved,
      locked: flags.locked,
      inActiveSquad: flags.inActiveSquad,
      estimatedPrice,
      ...(flags.favourite ? { favourite: true } : {}),
      ...(override.length > 0 ? { positionOverride: override } : {}),
      ...(cell('squadName') === '' ? {} : { squadName: cell('squadName') }),
      provenance,
    })
  })

  return {
    rows,
    errors,
    ignoredColumns,
    unknownDefIds: [...unknown].sort(),
    coverage: { cards, stacks: rows.length, observed: observedCounts },
    }
}

function blankCounts(): Record<StatusField, number> {
  return { untradeable: 0, isLoan: 0, locked: 0, inActiveSquad: 0 }
}

/**
 * The sentence the club page shows. Counts CARDS, not stacks: a stack of six
 * untradeable duplicates is six cards whose status is known, and reporting rows
 * would understate a club with many duplicates.
 */
export function describeCoverage(coverage: Coverage): string {
  if (coverage.cards === 0) return 'No cards imported'
  const lines = [`${coverage.cards} card(s) in ${coverage.stacks} stack(s)`]
  for (const field of STATUS_FIELDS) {
    const known = coverage.observed[field]
    const suffix =
      known === coverage.cards
        ? ''
        : `, the other ${coverage.cards - known} DEFAULTED rather than seen`
    lines.push(`  ${field} known for ${known} of ${coverage.cards}${suffix}`)
  }
  return lines.join('\n')
}
