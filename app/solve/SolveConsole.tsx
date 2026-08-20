'use client'

import { useState } from 'react'
import SquadCard, { type SquadView } from './SquadCard'

interface LibraryEntry {
  name: string
  formation: string
  teamRating: number | null
  repeatable: number
  requirementCount: number
}

interface QueueRow {
  sbc: string
  kind: 'one_off' | 'set' | 'repeat'
  count: number
  priority: number
  set: string
}

interface Diagnosis {
  mode: string
  explanation: string
  limits: { description: string }[]
  supply: { rating: number | null; missing: number; unit_cost: number | null; basis: string }[]
}

interface ItemResult {
  name: string
  requested: number
  achieved: number
  cost: number
  diagnosis: Diagnosis | null
  squads: SquadView[]
}

interface QueueResult {
  squadsBuilt: number
  coinsSpent: number
  valueBurned: number
  totalCost: number
  complete: boolean
  provenOptimal: boolean
  planSummary: string | null
  items: ItemResult[]
  error?: string
}

export default function SolveConsole({ library }: { library: LibraryEntry[] }) {
  const [rows, setRows] = useState<QueueRow[]>([])
  const [seconds, setSeconds] = useState('120')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<QueueResult | null>(null)

  function add(name: string): void {
    const entry = library.find((item) => item.name === name)
    setRows((current) => [
      ...current,
      {
        sbc: name,
        kind: (entry?.repeatable ?? 1) > 1 ? 'repeat' : 'one_off',
        count: entry?.repeatable ?? 1,
        priority: 1,
        set: '',
      },
    ])
  }

  function update(index: number, patch: Partial<QueueRow>): void {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  async function solve(): Promise<void> {
    setBusy(true)
    setResult(null)
    const response = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seconds: Number(seconds) || 120,
        items: rows.map((row) => ({
          sbc: row.sbc,
          kind: row.kind,
          count: row.kind === 'repeat' ? row.count : 1,
          priority: row.priority,
          set: row.set === '' ? null : row.set,
        })),
      }),
    })
    setResult((await response.json()) as QueueResult)
    setBusy(false)
  }

  return (
    <div className="space-y-4 text-sm">
      <section className="space-y-2 border border-neutral-800 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col">
            <span className="text-xs text-neutral-500">add an SBC</span>
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value !== '') add(event.target.value)
                event.target.value = ''
              }}
              className="w-56 border border-neutral-700 bg-neutral-900 px-2 py-1"
            >
              <option value="">choose</option>
              {library.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} ({entry.formation}
                  {entry.teamRating === null ? '' : `, ${entry.teamRating}`})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-neutral-500">seconds per solve</span>
            <input
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              className="w-24 border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <button
            type="button"
            disabled={rows.length === 0 || busy}
            onClick={() => void solve()}
            className="border border-neutral-700 px-3 py-1 disabled:opacity-40"
          >
            {busy ? 'solving, this can take minutes' : 'Solve'}
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-neutral-500">
            Nothing queued. Everything you add is solved TOGETHER against one club, not one
            at a time, because solving in sequence burns the good fodder on the first item
            and then fails on the fourth.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 pr-3">sbc</th>
                <th className="py-1 pr-3">kind</th>
                <th className="py-1 pr-3">count</th>
                <th className="py-1 pr-3">priority</th>
                <th className="py-1 pr-3">set name</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.sbc}-${index}`} className="border-t border-neutral-900">
                  <td className="py-1 pr-3 text-neutral-200">{row.sbc}</td>
                  <td className="py-1 pr-3">
                    <select
                      value={row.kind}
                      onChange={(event) => update(index, { kind: event.target.value as QueueRow['kind'] })}
                      className="border border-neutral-700 bg-neutral-900 px-1"
                    >
                      <option value="one_off">one off</option>
                      <option value="repeat">repeat</option>
                      <option value="set">set member</option>
                    </select>
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      value={row.count}
                      onChange={(event) => update(index, { count: Number(event.target.value) || 1 })}
                      className="w-14 border border-neutral-700 bg-neutral-900 px-1"
                      disabled={row.kind !== 'repeat'}
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      value={row.priority}
                      onChange={(event) => update(index, { priority: Number(event.target.value) || 1 })}
                      className="w-14 border border-neutral-700 bg-neutral-900 px-1"
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      value={row.set}
                      onChange={(event) => update(index, { set: event.target.value })}
                      className="w-32 border border-neutral-700 bg-neutral-900 px-1"
                      disabled={row.kind !== 'set'}
                    />
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
                      className="text-neutral-500 hover:text-neutral-200"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-neutral-600">
          Priority decides who gets the scarce fodder. An item that could be built on its own
          but loses that race is reported as CONTENTION rather than as its own failure.
        </p>
      </section>

      {result !== null ? (
        <section className="space-y-4">
          {result.error !== undefined ? (
            <p className="text-red-400">{result.error}</p>
          ) : (
            <>
              <div className="border border-neutral-800 p-3">
                <p className="text-neutral-200">
                  {result.squadsBuilt} squad(s) built{result.complete ? '' : ', queue INCOMPLETE'}
                </p>
                {/* Never one figure. Money that left the account and value that
                    was destroyed are different afternoons. */}
                <p>
                  {result.coinsSpent} coins spent, {result.valueBurned} value burned. Solver cost{' '}
                  {result.totalCost}, the weighted figure it minimised, not coins.
                </p>
                {!result.provenOptimal ? (
                  <p className="text-amber-300">
                    NOT PROVEN OPTIMAL: best found inside the time budget.
                  </p>
                ) : null}
              </div>

              {result.items.map((item) => (
                <div key={item.name} className="space-y-2 border border-neutral-800 p-3">
                  <h2 className="font-bold text-neutral-200">
                    {item.name}: {item.achieved} of {item.requested}, {item.cost} cost
                  </h2>
                  {item.diagnosis !== null ? (
                    <div className="text-amber-300">
                      <p>
                        Squad {item.achieved + 1} blocked by [{item.diagnosis.mode}]{' '}
                        {item.diagnosis.explanation}
                      </p>
                      {item.diagnosis.limits.map((limit) => (
                        <p key={limit.description} className="text-xs">
                          {limit.description}
                        </p>
                      ))}
                      {item.diagnosis.supply.map((shortfall, index) => (
                        <p key={index} className="text-xs">
                          short {shortfall.missing}{' '}
                          {shortfall.rating === null ? 'cards' : `cards rated ${shortfall.rating}`}
                          {shortfall.unit_cost === null
                            ? ', NO PRICE, so no coin figure is quoted'
                            : `, ${shortfall.unit_cost} each from the ${shortfall.basis}`}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {item.squads.map((squad, index) => (
                    <SquadCard key={index} squad={squad} index={index + 1} sbcName={item.name} />
                  ))}
                </div>
              ))}

              {result.planSummary !== null ? (
                <div className="border border-neutral-800 p-3">
                  <h2 className="font-bold text-neutral-200">Grind planner</h2>
                  <pre className="whitespace-pre-wrap text-xs text-neutral-300">
                    {result.planSummary}
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
