'use client'

import { useMemo, useState } from 'react'

interface FormationOption {
  name: string
  slots: string[]
}

interface SaveResponse {
  saved?: boolean
  passed?: boolean
  problems?: string[]
  failures?: { what: string; expected: string | number; actual: string | number }[]
  error?: string
}

interface Row {
  name: string
  rating: string
  positions: string
  nation: string
  league: string
  club: string
  cardType: string
  chemistry: string
}

const BLANK: Row = {
  name: '',
  rating: '',
  positions: '',
  nation: '',
  league: '',
  club: '',
  cardType: 'rare',
  chemistry: '',
}

export default function FixtureForm({ formations }: { formations: FormationOption[] }) {
  const [id, setId] = useState('')
  const [description, setDescription] = useState('')
  const [formation, setFormation] = useState(formations[0]?.name ?? '4-4-2')
  const [displayedRating, setDisplayedRating] = useState('')
  const [displayedChemistry, setDisplayedChemistry] = useState('')
  const [verifiesChemistry, setVerifiesChemistry] = useState(true)
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<Row[]>(Array.from({ length: 11 }, () => ({ ...BLANK })))
  const [result, setResult] = useState<SaveResponse | null>(null)

  const slots = useMemo(
    () => formations.find((option) => option.name === formation)?.slots ?? [],
    [formations, formation],
  )

  const chemistrySum = rows.reduce((sum, row) => sum + (Number(row.chemistry) || 0), 0)
  const total = Number(displayedChemistry)
  // Caught here, before the request, because a per player list that does not add
  // up to the recorded total is a typing error and this is where it is cheapest.
  const sumMismatch =
    verifiesChemistry && displayedChemistry !== '' && chemistrySum !== total
      ? `the eleven per player values add up to ${chemistrySum}, not ${total}`
      : null

  function update(index: number, patch: Partial<Row>): void {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  async function save(): Promise<void> {
    const fixture = {
      id,
      description,
      formation,
      players: rows.map((row, index) => ({
        defId: null,
        name: row.name === '' ? null : row.name,
        rating: Number(row.rating) || 0,
        slotPosition: slots[index] ?? '',
        positions: row.positions === '' ? undefined : row.positions.split('|').map((part) => part.trim()),
        nation: row.nation === '' ? undefined : row.nation,
        league: row.league === '' ? null : row.league,
        club: row.club === '' ? null : row.club,
        cardType: row.cardType,
        isWomens: false,
      })),
      displayedRating: Number(displayedRating) || 0,
      displayedChemistry: displayedChemistry === '' ? null : total,
      displayedPlayerChemistry: verifiesChemistry
        ? rows.map((row) => Number(row.chemistry) || 0)
        : null,
      verifies: verifiesChemistry ? ['squadRating', 'chemistry'] : ['squadRating'],
      source: source === '' ? 'entered in the fixtures page' : source,
    }
    const response = await fetch('/api/fixtures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fixture),
    })
    setResult((await response.json()) as SaveResponse)
  }

  return (
    <section className="space-y-3 border border-neutral-800 p-3 text-sm">
      <h2 className="font-bold text-neutral-200">Add a fixture</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">id</span>
          <input value={id} onChange={(event) => setId(event.target.value)} className="w-56 border border-neutral-700 bg-neutral-900 px-2 py-1" />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">formation</span>
          <select value={formation} onChange={(event) => setFormation(event.target.value)} className="w-32 border border-neutral-700 bg-neutral-900 px-2 py-1">
            {formations.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">displayed rating</span>
          <input value={displayedRating} onChange={(event) => setDisplayedRating(event.target.value)} className="w-24 border border-neutral-700 bg-neutral-900 px-2 py-1" />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-500">displayed chemistry</span>
          <input value={displayedChemistry} onChange={(event) => setDisplayedChemistry(event.target.value)} className="w-28 border border-neutral-700 bg-neutral-900 px-2 py-1" />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={verifiesChemistry} onChange={(event) => setVerifiesChemistry(event.target.checked)} />
          <span>verifies chemistry</span>
        </label>
      </div>
      <label className="flex flex-col">
        <span className="text-xs text-neutral-500">description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} className="w-full border border-neutral-700 bg-neutral-900 px-2 py-1" />
      </label>
      <label className="flex flex-col">
        <span className="text-xs text-neutral-500">source, for example the date the screenshot was taken</span>
        <input value={source} onChange={(event) => setSource(event.target.value)} className="w-full border border-neutral-700 bg-neutral-900 px-2 py-1" />
      </label>

      <table className="w-full text-left text-xs">
        <thead className="text-neutral-500">
          <tr>
            <th className="py-1 pr-2">slot</th>
            <th className="py-1 pr-2">name</th>
            <th className="py-1 pr-2">rating</th>
            <th className="py-1 pr-2">positions</th>
            <th className="py-1 pr-2">nation</th>
            <th className="py-1 pr-2">league</th>
            <th className="py-1 pr-2">club</th>
            <th className="py-1 pr-2">card type</th>
            <th className="py-1 pr-2">chem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-neutral-900">
              <td className="py-1 pr-2 text-neutral-500">{slots[index] ?? '?'}</td>
              {(['name', 'rating', 'positions', 'nation', 'league', 'club', 'cardType', 'chemistry'] as const).map(
                (field) => (
                  <td key={field} className="py-1 pr-2">
                    <input
                      value={row[field]}
                      onChange={(event) => update(index, { [field]: event.target.value })}
                      className={`border border-neutral-800 bg-neutral-900 px-1 ${
                        field === 'name' ? 'w-32' : field === 'rating' || field === 'chemistry' ? 'w-12' : 'w-24'
                      }`}
                    />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {sumMismatch !== null ? <p className="text-red-400">{sumMismatch}</p> : null}
      <button
        type="button"
        disabled={id.trim() === '' || sumMismatch !== null}
        onClick={() => void save()}
        className="border border-neutral-700 px-3 py-1 disabled:opacity-40"
      >
        Validate and save
      </button>

      {result !== null ? (
        <div className="space-y-1">
          {result.error !== undefined ? <p className="text-red-400">{result.error}</p> : null}
          {result.problems !== undefined && result.problems.length > 0 ? (
            <div className="text-red-400">
              <p>Not saved. validateFixture found:</p>
              <ul className="ml-4 list-disc">
                {result.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.saved === true ? (
            <>
              <p className="text-emerald-400">Saved.</p>
              {result.passed === true ? (
                <p className="text-emerald-400">The engine agrees with it.</p>
              ) : (
                // Not an error. The fixture is the record and the engine is the
                // thing under test, so this is a finding.
                <div className="text-amber-300">
                  <p>
                    THE ENGINE DISAGREES WITH THIS FIXTURE. The fixture is what the game
                    displayed, so the engine is what needs fixing:
                  </p>
                  <ul className="ml-4 list-disc">
                    {(result.failures ?? []).map((failure, index) => (
                      <li key={index}>
                        {failure.what}: expected {String(failure.expected)}, engine made it{' '}
                        {String(failure.actual)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
