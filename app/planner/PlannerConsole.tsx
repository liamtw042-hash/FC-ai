'use client'

import { useState } from 'react'

interface QueueResult {
  squadsBuilt: number
  coinsSpent: number
  valueBurned: number
  planSummary: string | null
  items: { name: string; achieved: number; requested: number; diagnosis: { mode: string; explanation: string } | null }[]
  error?: string
}

export default function PlannerConsole({
  library,
}: {
  library: { name: string; repeatable: number }[]
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [seconds, setSeconds] = useState('120')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<QueueResult | null>(null)

  async function plan(): Promise<void> {
    setBusy(true)
    setResult(null)
    const response = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seconds: Number(seconds) || 120,
        items: [...chosen].map((name) => {
          const entry = library.find((item) => item.name === name)
          const count = entry?.repeatable ?? 1
          return { sbc: name, kind: count > 1 ? 'repeat' : 'one_off', count, priority: 1 }
        }),
      }),
    })
    setResult((await response.json()) as QueueResult)
    setBusy(false)
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-4 border border-neutral-800 p-3">
        <div className="flex flex-wrap gap-3">
          {library.map((entry) => (
            <label key={entry.name} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={chosen.has(entry.name)}
                onChange={() =>
                  setChosen((current) => {
                    const next = new Set(current)
                    if (next.has(entry.name)) next.delete(entry.name)
                    else next.add(entry.name)
                    return next
                  })
                }
              />
              <span>
                {entry.name} <span className="text-neutral-600">x{entry.repeatable}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">seconds</span>
          <input
            value={seconds}
            onChange={(event) => setSeconds(event.target.value)}
            className="w-20 border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
        <button
          type="button"
          disabled={chosen.size === 0 || busy}
          onClick={() => void plan()}
          className="border border-neutral-700 px-3 py-1 disabled:opacity-40"
        >
          {busy ? 'working' : 'Plan'}
        </button>
      </div>

      {result !== null ? (
        result.error !== undefined ? (
          <p className="text-red-400">{result.error}</p>
        ) : (
          <div className="space-y-3">
            <div className="border border-neutral-800 p-3">
              <p className="text-neutral-200">{result.squadsBuilt} squad(s) achievable now</p>
              <p>
                {result.coinsSpent} coins spent, {result.valueBurned} value burned
              </p>
              <ul className="mt-2 text-xs">
                {result.items.map((item) => (
                  <li key={item.name}>
                    {item.name}: {item.achieved} of {item.requested}
                    {item.diagnosis === null ? '' : ` [${item.diagnosis.mode}]`}
                  </li>
                ))}
              </ul>
            </div>
            {result.planSummary !== null ? (
              <pre className="whitespace-pre-wrap border border-neutral-800 p-3 text-xs text-neutral-300">
                {result.planSummary}
              </pre>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  )
}
