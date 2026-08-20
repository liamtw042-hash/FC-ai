import { buildPool, resolveClub, state } from '../lib/server'
import ClubTable from './ClubTable'
import type { ClubRow } from './ClubTable'

export const dynamic = 'force-dynamic'

export default function ClubPage() {
  const current = state()
  if (current.cards.length === 0 || current.club.length === 0) {
    return <p className="text-sm text-amber-300">Nothing imported yet. Start at Intake.</p>
  }

  const { resolved, missingDefinitions } = resolveClub(current.club, current.cards)
  const pool = buildPool(current.club, current.cards, { prices: current.prices })
  const available = new Set(pool.cards.map((card) => card.id))

  const rows: ClubRow[] = resolved.map((card) => ({
    id: card.owned.id,
    defId: card.definition.defId,
    name: card.definition.name,
    rating: card.definition.rating,
    positions: card.effectivePositions,
    nation: card.definition.nation,
    league: card.definition.league,
    club: card.definition.club,
    cardType: card.definition.cardType,
    quality: card.definition.rating >= 75 ? 'gold' : card.definition.rating >= 65 ? 'silver' : 'bronze',
    pool: card.owned.pool,
    quantity: card.owned.quantity,
    untradeable: card.owned.untradeable,
    isLoan: card.owned.isLoan,
    locked: card.owned.locked,
    inActiveSquad: card.owned.inActiveSquad,
    price: card.owned.estimatedPrice,
    available: available.has(card.owned.id),
    provenance: card.owned.provenance ?? null,
  }))

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-neutral-100">Club</h1>
      {missingDefinitions.length > 0 ? (
        <p className="text-sm text-amber-300">
          {missingDefinitions.length} stack(s) have no card definition and are not solved with:{' '}
          {missingDefinitions.slice(0, 10).join(', ')}
          {missingDefinitions.length > 10 ? ' ...' : ''}
        </p>
      ) : null}
      <ClubTable rows={rows} />
    </div>
  )
}
