'use client'

import { useMemo, useState } from 'react'

interface NameRow {
  defId: string
  name: string
  rating: number
  club: string | null
}

interface ImportResult {
  saved?: boolean
  count?: number
  coverage?: string
  errors?: { line: number; column?: string; message: string }[]
  unknownDefIds?: string[]
  ignoredColumns?: string[]
  error?: string
}

const KINDS = [
  { kind: 'cards', label: 'Card definitions CSV' },
  { kind: 'club', label: 'Club CSV' },
  { kind: 'prices', label: 'Price by rating JSON' },
] as const

export default function IntakeForms({
  cardCount,
  clubCount,
  priceCount,
  names,
}: {
  cardCount: number
  clubCount: number
  priceCount: number
  names: NameRow[]
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['kind']>('cards')
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    return names.filter((row) => row.name.toLowerCase().includes(needle)).slice(0, 20)
  }, [names, query])

  async function upload(): Promise<void> {
    setBusy(true)
    setResult(null)
    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, text, label: label === '' ? 'pasted text' : label }),
    })
    setResult((await response.json()) as ImportResult)
    setBusy(false)
  }

  async function readFile(file: File): Promise<void> {
    setText(await file.text())
    setLabel(file.name)
  }

  return (
    <div className="space-y-6 text-sm">
      <section className="max-w-3xl space-y-2 border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">CSV import</h2>
        <p className="text-neutral-400">
          Loaded: {cardCount} card definition(s), {clubCount} club stack(s), {priceCount} price(s).
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {KINDS.map((entry) => (
            <label key={entry.kind} className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === entry.kind}
                onChange={() => setKind(entry.kind)}
              />
              <span>{entry.label}</span>
            </label>
          ))}
        </div>
        <input
          type="file"
          accept=".csv,.json,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void readFile(file)
          }}
          className="block"
        />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="or paste the file contents here"
          className="h-40 w-full border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy || text.trim() === ''}
          onClick={() => void upload()}
          className="border border-neutral-700 px-3 py-1 disabled:opacity-40"
        >
          {busy ? 'importing' : 'Import'}
        </button>

        {result !== null ? (
          <div className="space-y-1 border-t border-neutral-800 pt-2">
            {result.error !== undefined ? <p className="text-red-400">{result.error}</p> : null}
            {result.saved === true ? (
              <p className="text-emerald-400">Imported {result.count}.</p>
            ) : null}
            {result.coverage !== undefined ? (
              <pre className="whitespace-pre-wrap text-xs text-neutral-300">{result.coverage}</pre>
            ) : null}
            {result.ignoredColumns !== undefined && result.ignoredColumns.length > 0 ? (
              <p className="text-neutral-500">Columns not used: {result.ignoredColumns.join(', ')}</p>
            ) : null}
            {result.unknownDefIds !== undefined && result.unknownDefIds.length > 0 ? (
              <p className="text-amber-300">
                {result.unknownDefIds.length} defId(s) have no card definition and will not be
                solved with: {result.unknownDefIds.slice(0, 12).join(', ')}
              </p>
            ) : null}
            {/* Every rejected row, with its line number. Nothing is repaired. */}
            {result.errors !== undefined && result.errors.length > 0 ? (
              <div className="text-red-300">
                <p>{result.errors.length} row(s) rejected. Nothing was guessed at:</p>
                <ul className="ml-4 list-disc">
                  {result.errors.slice(0, 30).map((error, index) => (
                    <li key={index}>
                      line {error.line}
                      {error.column === undefined ? '' : ` [${error.column}]`}: {error.message}
                    </li>
                  ))}
                </ul>
                {result.errors.length > 30 ? <p>... and {result.errors.length - 30} more</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="max-w-3xl space-y-2 border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">Quick add, by name</h2>
        <p className="text-neutral-400">
          Autocomplete against the loaded card database. This is what the screenshot review
          queue will use once OCR exists.
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="type at least two letters"
          className="w-72 border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
        {matches.length > 0 ? (
          <ul className="text-xs">
            {matches.map((row) => (
              <li key={row.defId} className="py-0.5">
                <span className="text-neutral-500">{row.defId}</span> {row.rating}{' '}
                <span className="text-neutral-200">{row.name}</span> {row.club ?? 'no club'}
              </li>
            ))}
          </ul>
        ) : query.trim().length >= 2 ? (
          <p className="text-neutral-500">No card in the loaded database matches that.</p>
        ) : null}
      </section>
    </div>
  )
}
