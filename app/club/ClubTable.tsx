'use client'

import { useMemo, useState } from 'react'
import type { StatusProvenance } from '../../src/types/cards'

export interface ClubRow {
  id: string
  defId: string
  name: string
  rating: number
  positions: string[]
  nation: string
  league: string | null
  club: string | null
  cardType: string
  quality: string
  pool: string
  quantity: number
  untradeable: boolean
  isLoan: boolean
  locked: boolean
  inActiveSquad: boolean
  price: number | null
  available: boolean
  provenance: StatusProvenance | null
}

type SortKey = 'rating' | 'name' | 'league' | 'nation' | 'club' | 'price' | 'quantity'

const FILTERS: { key: keyof ClubRow; label: string }[] = [
  { key: 'league', label: 'league' },
  { key: 'nation', label: 'nation' },
  { key: 'club', label: 'club' },
  { key: 'cardType', label: 'rarity' },
  { key: 'quality', label: 'quality' },
  { key: 'pool', label: 'pool' },
]

export default function ClubTable({ rows }: { rows: ClubRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('rating')
  const [ascending, setAscending] = useState(false)
  const [text, setText] = useState('')
  const [minRating, setMinRating] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [tradeableOnly, setTradeableOnly] = useState(false)
  const [hideLocked, setHideLocked] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const options = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const filter of FILTERS) {
      const values = new Set<string>()
      for (const row of rows) {
        const value = row[filter.key]
        if (typeof value === 'string' && value !== '') values.add(value)
      }
      out[filter.key] = [...values].sort()
    }
    return out
  }, [rows])

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase()
    const floor = minRating === '' ? null : Number(minRating)
    const result = rows.filter((row) => {
      if (needle !== '' && !row.name.toLowerCase().includes(needle)) return false
      if (floor !== null && row.rating < floor) return false
      for (const filter of FILTERS) {
        const chosen = choices[filter.key]
        if (chosen !== undefined && chosen !== '' && String(row[filter.key] ?? '') !== chosen) {
          return false
        }
      }
      if (tradeableOnly && row.untradeable) return false
      if (hideLocked && row.locked) return false
      return true
    })
    result.sort((a, b) => {
      const left = a[sortKey] ?? ''
      const right = b[sortKey] ?? ''
      const order = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))
      return ascending ? order : -order
    })
    return result
  }, [rows, text, minRating, choices, tradeableOnly, hideLocked, sortKey, ascending])

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setLocked(locked: boolean): Promise<void> {
    setSaving(true)
    setNote(null)
    const response = await fetch('/api/club/lock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [...selected], locked }),
    })
    const body = (await response.json()) as { changed?: number; error?: string }
    setSaving(false)
    setNote(body.error ?? `${body.changed ?? 0} card(s) ${locked ? 'locked' : 'unlocked'}. Reload to see it.`)
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">name</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="w-40 border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">rating at least</span>
          <input
            value={minRating}
            onChange={(event) => setMinRating(event.target.value)}
            className="w-24 border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
        {FILTERS.map((filter) => (
          <label key={filter.key} className="flex flex-col">
            <span className="text-xs text-neutral-500">{filter.label}</span>
            <select
              value={choices[filter.key] ?? ''}
              onChange={(event) =>
                setChoices((current) => ({ ...current, [filter.key]: event.target.value }))
              }
              className="w-40 border border-neutral-700 bg-neutral-900 px-2 py-1"
            >
              <option value="">any</option>
              {(options[filter.key] ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={tradeableOnly} onChange={(event) => setTradeableOnly(event.target.checked)} />
          <span>tradeable only</span>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hideLocked} onChange={(event) => setHideLocked(event.target.checked)} />
          <span>hide locked</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-neutral-400">
          {filtered.length} of {rows.length} shown, {selected.size} selected
        </span>
        <button
          type="button"
          disabled={selected.size === 0 || saving}
          onClick={() => void setLocked(true)}
          className="border border-neutral-700 px-2 py-1 disabled:opacity-40"
        >
          Lock selected
        </button>
        <button
          type="button"
          disabled={selected.size === 0 || saving}
          onClick={() => void setLocked(false)}
          className="border border-neutral-700 px-2 py-1 disabled:opacity-40"
        >
          Unlock selected
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set(filtered.map((row) => row.id)))}
          className="border border-neutral-700 px-2 py-1"
        >
          Select all shown
        </button>
        <button type="button" onClick={() => setSelected(new Set())} className="border border-neutral-700 px-2 py-1">
          Clear
        </button>
        {note !== null ? <span className="text-amber-300">{note}</span> : null}
      </div>

      <table className="w-full text-left text-xs">
        <thead className="text-neutral-500">
          <tr>
            <th className="w-6" />
            {(['rating', 'name', 'league', 'nation', 'club', 'price', 'quantity'] as SortKey[]).map(
              (key) => (
                <th
                  key={key}
                  onClick={() => {
                    if (key === sortKey) setAscending((value) => !value)
                    else {
                      setSortKey(key)
                      setAscending(false)
                    }
                  }}
                  className="cursor-pointer py-1 pr-3 hover:text-neutral-200"
                >
                  {key}
                  {key === sortKey ? (ascending ? ' up' : ' down') : ''}
                </th>
              ),
            )}
            <th className="py-1 pr-3">positions</th>
            <th className="py-1 pr-3">status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 800).map((row) => (
            <tr
              key={row.id}
              className={`border-t border-neutral-900 ${row.available ? '' : 'text-neutral-600'}`}
            >
              <td>
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
              </td>
              <td className="py-1 pr-3">{row.rating}</td>
              <td className="py-1 pr-3 text-neutral-200">{row.name}</td>
              <td className="py-1 pr-3">{row.league ?? 'no league'}</td>
              <td className="py-1 pr-3">{row.nation}</td>
              <td className="py-1 pr-3">{row.club ?? 'no club'}</td>
              <td className="py-1 pr-3">{row.price ?? 'no price'}</td>
              <td className="py-1 pr-3">{row.quantity}</td>
              <td className="py-1 pr-3">{row.positions.join('/')}</td>
              <td className="py-1 pr-3">
                {/* The three the game itself rejects are marked differently from
                    the two that are protections I chose. */}
                {row.isLoan ? <span className="mr-1 text-red-400">loan</span> : null}
                {row.inActiveSquad ? <span className="mr-1 text-red-400">in squad</span> : null}
                {row.locked ? <span className="mr-1 text-amber-300">locked</span> : null}
                {row.untradeable ? <span className="mr-1 text-neutral-500">untradeable</span> : null}
                {row.provenance !== null && row.provenance.locked === 'defaulted' ? (
                  <span className="text-neutral-700" title="never seen in a status pass">
                    lock status defaulted
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 800 ? (
        <p className="text-neutral-500">Showing the first 800. Filter further to see the rest.</p>
      ) : null}
    </div>
  )
}
