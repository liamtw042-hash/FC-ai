'use client'

import { useState } from 'react'
import type { Requirement } from '../../src/types/requirements'

interface Entry {
  name: string
  formation: string
  teamRating?: number
  repeatable: number
  requirements: Requirement[]
  notes?: string
  conflicts: string[]
}

interface ParsedLine {
  text: string
  line: number
  requirement: Requirement | null
  problem: string | null
}

interface ParseResponse {
  lines: ParsedLine[]
  requirements: Requirement[]
  unrecognised: ParsedLine[]
  conflicts: string[]
}

/** The common ones, so a squad rating SBC is three clicks rather than typing. */
const TEMPLATES: { label: string; text: string }[] = [
  {
    label: 'Rating only',
    text: 'Number of players in the Squad: 11\nSquad Rating: Min. 85',
  },
  {
    label: 'Rating and chemistry',
    text: 'Number of players in the Squad: 11\nSquad Rating: Min. 84\nTeam Chemistry: Min. 27',
  },
  {
    label: 'League marquee',
    text: 'Number of players in the Squad: 11\nPlayers from Premier Division: Min. 4\nSquad Rating: Min. 84\nRare: Min. 11',
  },
  {
    label: 'Team of the week',
    text: 'Number of players in the Squad: 11\nTeam of the Week Players: Min. 1\nSquad Rating: Min. 84',
  },
]

export default function SbcLibrary({
  library,
  formations,
}: {
  library: Entry[]
  formations: string[]
}) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParseResponse | null>(null)
  const [name, setName] = useState('')
  const [formation, setFormation] = useState(formations[0] ?? '4-4-2')
  const [rating, setRating] = useState('')
  const [repeatable, setRepeatable] = useState('1')
  const [note, setNote] = useState<string | null>(null)

  async function parse(): Promise<void> {
    setNote(null)
    const response = await fetch('/api/sbc/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    setParsed((await response.json()) as ParseResponse)
  }

  async function save(): Promise<void> {
    if (parsed === null) return
    const response = await fetch('/api/sbc/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        formation,
        repeatable: Number(repeatable) || 1,
        requirements: parsed.requirements,
        ...(rating === '' ? {} : { teamRating: Number(rating) }),
      }),
    })
    const body = (await response.json()) as { path?: string; error?: string; conflicts?: string[] }
    setNote(body.error ?? `Saved to ${body.path ?? 'disk'}. Reload to see it in the library.`)
  }

  return (
    <div className="space-y-6 text-sm">
      <section className="border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">Saved</h2>
        {library.length === 0 ? (
          <p className="text-neutral-500">Nothing saved yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 pr-3">name</th>
                <th className="py-1 pr-3">formation</th>
                <th className="py-1 pr-3">rating</th>
                <th className="py-1 pr-3">repeatable</th>
                <th className="py-1 pr-3">requirements</th>
              </tr>
            </thead>
            <tbody>
              {library.map((entry) => (
                <tr key={entry.name} className="border-t border-neutral-900 align-top">
                  <td className="py-1 pr-3 text-neutral-200">{entry.name}</td>
                  <td className="py-1 pr-3">{entry.formation}</td>
                  <td className="py-1 pr-3">{entry.teamRating ?? '-'}</td>
                  <td className="py-1 pr-3">{entry.repeatable}</td>
                  <td className="py-1 pr-3">
                    {entry.requirements.length === 0 ? (
                      <span className="text-neutral-600">none</span>
                    ) : (
                      <ul>
                        {entry.requirements.map((requirement, index) => (
                          <li key={index}>{JSON.stringify(requirement)}</li>
                        ))}
                      </ul>
                    )}
                    {entry.conflicts.map((conflict) => (
                      <p key={conflict} className="text-red-400">
                        IMPOSSIBLE FOR EVERYONE: {conflict}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="max-w-4xl space-y-2 border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">Paste the requirements from the game</h2>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => setText(template.text)}
              className="border border-neutral-700 px-2 py-1 text-xs"
            >
              {template.label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'Number of players in the Squad: 11\nSquad Rating: Min. 85\nTeam Chemistry: Min. 27'}
          className="h-40 w-full border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs"
        />
        <button type="button" onClick={() => void parse()} className="border border-neutral-700 px-3 py-1">
          Parse
        </button>

        {parsed !== null ? (
          <div className="space-y-2 border-t border-neutral-800 pt-2">
            {/* Always shown for confirmation, and EVERY line is here, understood
                or not. A parser that quietly drops a line produces a squad that
                satisfies four of five requirements and looks like a success. */}
            <h3 className="font-bold text-neutral-200">What that parsed to</h3>
            <table className="w-full text-left text-xs">
              <tbody>
                {parsed.lines.map((entry) => (
                  <tr key={entry.line} className="border-t border-neutral-900 align-top">
                    <td className="w-8 py-1 pr-2 text-neutral-600">{entry.line}</td>
                    <td className="py-1 pr-3 text-neutral-400">{entry.text}</td>
                    <td className="py-1">
                      {entry.requirement === null ? (
                        <span className="text-red-400">NOT UNDERSTOOD: {entry.problem}</span>
                      ) : (
                        <code className="text-emerald-300">{JSON.stringify(entry.requirement)}</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.unrecognised.length > 0 ? (
              <p className="text-red-400">
                {parsed.unrecognised.length} line(s) were not understood. Saving now would save an
                SBC that is missing them, and a squad solved against it would look valid and not
                be. Fix the text, or add the requirement by hand afterwards.
              </p>
            ) : null}
            {parsed.conflicts.map((conflict) => (
              <p key={conflict} className="text-red-400">
                IMPOSSIBLE FOR EVERYONE, before any club is looked at: {conflict}
              </p>
            ))}

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col">
                <span className="text-xs text-neutral-500">name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-48 border border-neutral-700 bg-neutral-900 px-2 py-1"
                />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-neutral-500">formation</span>
                <select
                  value={formation}
                  onChange={(event) => setFormation(event.target.value)}
                  className="w-32 border border-neutral-700 bg-neutral-900 px-2 py-1"
                >
                  {formations.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-neutral-500">team rating</span>
                <input
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                  className="w-24 border border-neutral-700 bg-neutral-900 px-2 py-1"
                />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-neutral-500">repeatable</span>
                <input
                  value={repeatable}
                  onChange={(event) => setRepeatable(event.target.value)}
                  className="w-20 border border-neutral-700 bg-neutral-900 px-2 py-1"
                />
              </label>
              <button
                type="button"
                disabled={name.trim() === ''}
                onClick={() => void save()}
                className="border border-neutral-700 px-3 py-1 disabled:opacity-40"
              >
                Save
              </button>
              {note !== null ? <span className="text-amber-300">{note}</span> : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
