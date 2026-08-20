import { NextResponse } from 'next/server'
import { loadCardDefinitions } from '../../../src/data/cardDefinitions'
import { describeCoverage, loadClub } from '../../../src/data/clubImport'
import { persist, state } from '../../lib/server'

/**
 * CSV intake. The same loaders the command line uses, so an import made here and
 * one made there cannot disagree.
 *
 * Errors are RETURNED, never swallowed. A file with forty bad rows comes back
 * with forty line numbers and nothing is saved.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { kind?: string; text?: string; label?: string }
  const text = body.text ?? ''
  const label = body.label ?? 'pasted text'

  if (body.kind === 'cards') {
    const result = loadCardDefinitions(text)
    if (result.rows.length === 0) {
      return NextResponse.json({ errors: result.errors, saved: false }, { status: 422 })
    }
    persist({ ...state(), cards: result.rows, cardsImportedFrom: label })
    return NextResponse.json({
      saved: true,
      count: result.rows.length,
      errors: result.errors,
      ignoredColumns: result.ignoredColumns,
    })
  }

  if (body.kind === 'club') {
    const current = state()
    const known = new Set(current.cards.map((card) => card.defId))
    const result = loadClub(text, known.size > 0 ? { knownDefIds: known } : {})
    if (result.rows.length === 0) {
      return NextResponse.json({ errors: result.errors, saved: false }, { status: 422 })
    }
    persist({ ...current, club: result.rows, clubImportedFrom: label })
    return NextResponse.json({
      saved: true,
      count: result.rows.length,
      errors: result.errors,
      unknownDefIds: result.unknownDefIds,
      coverage: describeCoverage(result.coverage),
    })
  }

  if (body.kind === 'prices') {
    const parsed = JSON.parse(text) as { entries?: { rating: number; coins: number }[] }
    const prices: Record<number, number> = {}
    for (const entry of parsed.entries ?? []) prices[entry.rating] = entry.coins
    persist({ ...state(), prices, pricesImportedFrom: label })
    return NextResponse.json({ saved: true, count: Object.keys(prices).length })
  }

  return NextResponse.json({ error: `unknown import kind ${String(body.kind)}` }, { status: 400 })
}
