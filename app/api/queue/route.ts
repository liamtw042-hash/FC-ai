import { NextResponse } from 'next/server'
import { getFormation } from '../../../src/rules/formations'
import { SolverRejectedError, SolverUnavailableError, type WireQueueResponse } from '../../../src/cli/solverClient'
import { chemistryConfig, prepare, view } from '../../lib/solve'
import { sbc, solver, state } from '../../lib/server'

export const maxDuration = 3600

interface QueueEntry {
  sbc: string
  kind?: 'one_off' | 'set' | 'repeat'
  count?: number
  priority?: number
  set?: string | null
}

/**
 * One offs, sets and repeats in any mix, against one club. Brief 6.2 and 6.3.
 *
 * Solved jointly rather than one at a time, because solving in sequence burns
 * the good fodder on the first item and then fails on the fourth. Priority is
 * what decides who gets the scarce cards, and an item that loses that race is
 * reported as contention rather than as its own failure.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { items?: QueueEntry[]; seconds?: number }
  const entries = body.items ?? []
  if (entries.length === 0) {
    return NextResponse.json({ error: 'nothing in the queue' }, { status: 400 })
  }

  const definitions = []
  const items = []
  for (const entry of entries) {
    const definition = sbc(entry.sbc)
    if (definition === null) {
      return NextResponse.json({ error: `no SBC called ${entry.sbc}` }, { status: 404 })
    }
    const prepared = prepare(definition)
    if (prepared.problem !== null) {
      return NextResponse.json({ error: `${entry.sbc}: ${prepared.problem}` }, { status: 422 })
    }
    definitions.push({ definition, prepared })
    items.push({
      name: definition.name,
      formation_slots: getFormation(definition.formation).slots,
      requirements: definition.requirements,
      chemistry: chemistryConfig(),
      multisets: prepared.multisets,
      kind: entry.kind ?? 'one_off',
      count: entry.count ?? 1,
      priority: entry.priority ?? 1,
      set_name: entry.set ?? null,
    })
  }

  const first = definitions[0]
  if (first === undefined) {
    return NextResponse.json({ error: 'nothing in the queue' }, { status: 400 })
  }

  let response: WireQueueResponse
  try {
    response = await solver().post<WireQueueResponse>('/solve/queue', {
      pool: first.prepared.pool.cards,
      items,
      rating_prices: state().prices,
      time_budget_seconds: body.seconds ?? 120,
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

  const byName = new Map(definitions.map((entry) => [entry.definition.name, entry]))
  return NextResponse.json({
    squadsBuilt: response.squads_built,
    coinsSpent: response.coins_spent,
    valueBurned: response.value_burned,
    totalCost: response.total_cost,
    complete: response.complete,
    provenOptimal: response.proven_optimal,
    planSummary: response.plan_summary,
    items: response.items.map((item) => {
      const entry = byName.get(item.name)
      return {
        name: item.name,
        requested: item.requested,
        achieved: item.achieved,
        cost: item.cost,
        diagnosis: item.diagnosis,
        squads:
          entry === undefined
            ? []
            : item.squads.map((squad) =>
                view(squad, entry.definition.formation, entry.prepared.byId, entry.definition.requirements),
              ),
      }
    }),
  })
}
