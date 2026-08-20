import { NextResponse } from 'next/server'
import { consume, ledgerByRating, record, totals, type LedgerEntry } from '../../../src/data/history'
import { history, persist, resolveClub, saveHistory, state } from '../../lib/server'

interface SubmittedSquad {
  players: { cardId: string; name: string; rating: number }[]
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
  // MATCHED ON THE STACK ID, not on name and rating. Name plus rating does not
  // identify a stack: a base gold and a special card can share both, and taking
  // the first that matches would consume the wrong one and leave the club wrong
  // in a way nobody would notice until a later solve failed.
  const byId = new Map(resolved.map((card) => [card.owned.id, card]))
  const used = new Map<string, LedgerEntry>()
  for (const player of squad.players) {
    const card = player.cardId === undefined ? undefined : byId.get(player.cardId)
    if (card === undefined) {
      return NextResponse.json(
        {
          error:
            `${player.name} (${player.rating}) is no longer in the club under the id the ` +
            `solve returned, so NOTHING was recorded. Re-solve and submit that result.`,
        },
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
