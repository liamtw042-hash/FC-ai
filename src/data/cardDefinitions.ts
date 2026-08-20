/**
 * Source agnostic card definition loader. Brief section 3, checkpoint 2's job
 * done through a route that does not need a key.
 *
 * FutDB is blocked on a key and its real rate limits, and inventing either is not
 * on the table. A CSV loader is not a stand in for that loader: it is the other
 * half of the same requirement, because a card database that can only arrive over
 * one vendor's API is a database with a single point of failure. Any export that
 * can name its columns loads here.
 *
 * SOURCE AGNOSTIC MEANS THE COLUMN NAMES ARE DATA. A `ColumnMap` says which
 * header feeds which field. The default map takes the names this repo writes, and
 * a source with different ones passes its own instead of being edited into shape
 * by hand.
 *
 * Nothing is guessed. A row missing a required field is an error carrying its
 * line number, not a row with a plausible value filled in.
 */

import type { AliasTable, CardDefinition } from '../types/cards'
import {
  indexHeader,
  normaliseHeader,
  parseCsv,
  parseFlag,
  type LoadResult,
  type RowError,
} from './csv'

export interface ColumnMap {
  defId: string
  name: string
  rating: string
  positions: string
  nation: string
  league: string
  club: string
  cardType: string
  isWomens?: string
  promoName?: string
}

export const DEFAULT_CARD_COLUMNS: ColumnMap = {
  defId: 'defId',
  name: 'name',
  rating: 'rating',
  positions: 'positions',
  nation: 'nation',
  league: 'league',
  club: 'club',
  cardType: 'cardType',
  isWomens: 'isWomens',
  promoName: 'promoName',
}

export interface CardLoadOptions {
  columns?: Partial<ColumnMap>
  aliases?: AliasTable
  /** Separator inside the positions cell. Pipe by default, so commas stay safe. */
  positionSeparator?: string
}

const REQUIRED: (keyof ColumnMap)[] = [
  'defId',
  'name',
  'rating',
  'positions',
  'nation',
  'cardType',
]

export function loadCardDefinitions(
  text: string,
  options: CardLoadOptions = {},
): LoadResult<CardDefinition> {
  const map: ColumnMap = { ...DEFAULT_CARD_COLUMNS, ...options.columns }
  const separator = options.positionSeparator ?? '|'
  const table = parseCsv(text)
  const header = indexHeader(table.header)

  const errors: RowError[] = []
  const columnOf = new Map<keyof ColumnMap, number>()
  for (const [field, name] of Object.entries(map) as [keyof ColumnMap, string][]) {
    const position = header.get(normaliseHeader(name))
    if (position === undefined) {
      if (REQUIRED.includes(field)) {
        errors.push({ line: 1, column: name, message: `required column ${name} is missing` })
      }
      continue
    }
    columnOf.set(field, position)
  }
  // League and club are required as COLUMNS even though their values may be
  // blank: an Icon has no league and no club, and a file that omits the columns
  // entirely cannot tell that apart from a file that forgot them.
  for (const field of ['league', 'club'] as const) {
    if (!columnOf.has(field)) {
      errors.push({
        line: 1,
        column: map[field],
        message: `required column ${map[field]} is missing. Leave the cell empty for cards with no ${field}, but the column has to be there`,
      })
    }
  }
  if (errors.length > 0) return { rows: [], errors, ignoredColumns: [] }

  const wanted = new Set([...columnOf.values()])
  const ignoredColumns = table.header.filter((_, position) => !wanted.has(position))

  const rows: CardDefinition[] = []
  const seen = new Set<string>()
  for (const row of table.rows) {
    const cell = (field: keyof ColumnMap): string => {
      const position = columnOf.get(field)
      return position === undefined ? '' : (row.values[position] ?? '').trim()
    }
    const before = errors.length
    const defId = cell('defId')
    if (defId === '') errors.push({ line: row.line, column: map.defId, message: 'defId is empty' })
    else if (seen.has(defId)) {
      errors.push({ line: row.line, column: map.defId, message: `duplicate defId ${defId}` })
    }
    const name = cell('name')
    if (name === '') errors.push({ line: row.line, column: map.name, message: 'name is empty' })

    const rating = Number(cell('rating'))
    if (!Number.isInteger(rating) || rating < 1 || rating > 99) {
      errors.push({
        line: row.line,
        column: map.rating,
        message: `rating ${JSON.stringify(cell('rating'))} is not a whole number from 1 to 99`,
      })
    }

    const positions = cell('positions')
      .split(separator)
      .map((position) => position.trim())
      .filter((position) => position !== '')
    if (positions.length === 0) {
      errors.push({ line: row.line, column: map.positions, message: 'no positions listed' })
    }

    const nation = cell('nation')
    if (nation === '') {
      errors.push({ line: row.line, column: map.nation, message: 'nation is empty' })
    }
    const cardType = cell('cardType')
    if (cardType === '') {
      errors.push({ line: row.line, column: map.cardType, message: 'cardType is empty' })
    }

    const womens = cell('isWomens')
    const isWomens = parseFlag(womens)
    if (isWomens === null) {
      errors.push({
        line: row.line,
        column: map.isWomens,
        message: `isWomens ${JSON.stringify(womens)} is not a yes or no value`,
      })
    }

    if (errors.length > before) continue
    seen.add(defId)

    const league = cell('league')
    const club = cell('club')
    const promo = cell('promoName')
    rows.push({
      defId,
      name,
      rating,
      positions,
      nation: resolve(options.aliases?.nations, nation),
      league: league === '' ? null : resolve(options.aliases?.leagues, league),
      club: club === '' ? null : resolve(options.aliases?.clubs, club),
      cardType,
      isWomens: isWomens ?? false,
      ...(promo === '' ? {} : { promoName: promo }),
    })
  }
  return { rows, errors, ignoredColumns }
}

function resolve(table: Record<string, string> | undefined, value: string): string {
  return table?.[value] ?? value
}
