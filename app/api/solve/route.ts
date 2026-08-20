import { NextResponse } from 'next/server'
import { getFormation } from '../../../src/rules/formations'
import { detectConflicts } from '../../../src/rules/detectConflicts'
import { SolverRejectedError, SolverUnavailableError, type WireRepeatResponse } from '../../../src/cli/solverClient'
import { chemistryConfig, prepare, view } from '../../lib/solve'
import { sbc, solver, state } from '../../lib/server'

export const maxDuration = 3600

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { name?: string; repeat?: number; seconds?: number }
  const definition = sbc(body.name ?? '')
  if (definition === null) {
    return NextResponse.json({ error: `no SBC called ${String(body.name)}` }, { status: 404 })
  }

  // Impossible for everyone comes first, before the club is looked at.
  const conflicts = detectConflicts(definition.requirements).map((entry) => entry.reason)
  if (conflicts.length > 0) {
    return NextResponse.json({ universal: conflicts, squads: [], achieved: 0 })
  }

  const prepared = prepare(definition)
  if (prepared.problem !== null) {
    return NextResponse.json({ error: prepared.problem }, { status: 422 })
  }

  const requested = body.repeat ?? definition.repeatable ?? 1
  let response: WireRepeatResponse
  try {
    response = await solver().post<WireRepeatResponse>('/solve/repeat', {
      pool: prepared.pool.cards,
      formation_slots: getFormation(definition.formation).slots,
      requested,
      requirements: definition.requirements,
      chemistry: chemistryConfig(),
      allowed_rating_multisets: prepared.multisets,
      rating_prices: state().prices,
      time_budget_seconds: body.seconds ?? 60,
    })
  } catch (error) {
    if (error instanceof SolverUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    if (error instanceof SolverRejectedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  return NextResponse.json({
    name: definition.name,
    requested,
    achieved: response.achieved,
    coinsSpent: response.coins_spent,
    valueBurned: response.value_burned,
    totalCost: response.total_cost,
    provenOptimal: response.proven_optimal,
    seconds: response.wall_time_seconds,
    squads: response.squads.map((squad) =>
      view(squad, definition.formation, prepared.byId, definition.requirements),
    ),
    diagnosis: response.diagnosis,
    universal: [],
  })
}
