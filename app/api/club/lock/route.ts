import { NextResponse } from 'next/server'
import { persist, state } from '../../../lib/server'

/**
 * Bulk lock and unlock. Brief section 9, Club.
 *
 * A lock is a protection the owner chose, so it is stored on the card and it is
 * never relaxed by anything else in this tool. `reasonsFor` in the rules engine
 * decides what a locked card means; this only records the flag.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { ids?: string[]; locked?: boolean }
  const ids = new Set(body.ids ?? [])
  const locked = body.locked === true
  if (ids.size === 0) return NextResponse.json({ error: 'no cards selected' }, { status: 400 })

  const current = state()
  let changed = 0
  const club = current.club.map((card) => {
    if (!ids.has(card.id) || card.locked === locked) return card
    changed += 1
    // Setting it by hand IS an observation, so the provenance says so rather than
    // leaving it reading as a default.
    const provenance =
      card.provenance === undefined
        ? undefined
        : { ...card.provenance, locked: 'observed' as const }
    return provenance === undefined
      ? { ...card, locked }
      : { ...card, locked, provenance }
  })
  persist({ ...current, club })
  return NextResponse.json({ changed })
}
