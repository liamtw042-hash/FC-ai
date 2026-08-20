import { NextResponse } from 'next/server'
import { consume, ledgerByRating, record, totals, type LedgerEntry } from '../../../src/data/history'
import { history, persist, resolveClub, saveHistory, state } from '../../lib/server'

interface SubmittedSquad {
  players: { name: string; rating: number }[]
}

export function GET(): NextResponse {
  const current = history()
  return NextResponse.json({
    submissions: current.submissions,
    totals: totals(current),
    ledger: ledgerByRating(current),
  })
}

/**
 * Mark as submitted. Brief section 9, Results.
 *
 * This is the ONE place a report writes back, because after a submission the
 * cards really are gone and a club that still lists them will solve with cards
 * that do not exist. It refuses rather than clamping: if the club holds fewer
 * copies than the squad used, the club and this tool have already diverged and
 * quietly taking what is there would hide that.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as {
    sbcName?: string
    squadIndex?: number
    squad?: SubmittedSquad
    reward?: string
    submittedAt?: string
  }
  const squad = body.squad
  if (squad === undefined || squad.players.length === 0) {
    return NextResponse.json({ error: 'no squad supplied' }, { status: 400 })
  }

  const current = state()
  const { resolved } = resolveClub(current.club, current.cards)
  // Matched by name and rating, which is what the returned squad carries. A
  // mismatch is reported rather than skipped.
  const used = new Map<string, LedgerEntry>()
  for (const player of squad.players) {
    const card = resolved.find(
      (candidate) =>
        candidate.definition.name === player.name && candidate.definition.rating === player.rating,
    )
    if (card === undefined) {
      return NextResponse.json(
        { error: `${player.name} (${player.rating}) is no longer in the club, so nothing was recorded` },
        { status: 409 },
      )
    }
    const existing = used.get(card.owned.id)
    const price = card.owned.estimatedPrice ?? 0
    if (existing === undefined) {
      used.set(card.owned.id, {
        cardId: card.owned.id,
        defId: card.definition.defId,
        name: card.definition.name,
        rating: card.definition.rating,
        quantity: 1,
        coinsSpent: 0,
        valueBurned: card.owned.untradeable ? 0 : price,
      })
    } else {
      existing.quantity += 1
      existing.valueBurned += card.owned.untradeable ? 0 : price
    }
  }

  const fodder = [...used.values()]
  let club
  try {
    club = consume(current.club, fodder)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 409 })
  }

  const submission = {
    id: `${body.sbcName ?? 'sbc'}-${body.squadIndex ?? 0}-${body.submittedAt ?? new Date().toISOString()}`,
    sbcName: body.sbcName ?? 'sbc',
    submittedAt: body.submittedAt ?? new Date().toISOString(),
    squadCount: 1,
    coinsSpent: fodder.reduce((sum, entry) => sum + entry.coinsSpent, 0),
    valueBurned: fodder.reduce((sum, entry) => sum + entry.valueBurned, 0),
    fodder,
    ...(body.reward === undefined ? {} : { reward: body.reward }),
  }

  saveHistory(record(history(), submission))
  persist({ ...current, club })
  return NextResponse.json({ recorded: true, cardsRemoved: fodder.length })
}
