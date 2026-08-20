'use client'

import { useState } from 'react'

export interface SquadView {
  rating: number
  chemistry: number
  cost: number
  players: {
    /** The owned stack, so the submission write back takes the right one. */
    cardId: string
    slot: string
    rating: number
    name: string
    club: string | null
    league: string | null
    nation: string
    chemistry: number
    inPosition: boolean
  }[]
  requirements: { label: string; passed: boolean; achieved: string; required: string }[]
  mismatches: string[]
}

/**
 * One squad, in formation shape, with the per requirement checklist.
 *
 * Copy as text is here because the point of a solution is finding the eleven
 * cards in the game, and reading them off a screen one at a time is the slow part.
 */
export default function SquadCard({
  squad,
  index,
  sbcName,
}: {
  squad: SquadView
  index: number
  sbcName: string
}) {
  const [copied, setCopied] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)

  const asText = [
    `${sbcName} squad ${index}: rating ${squad.rating}, chemistry ${squad.chemistry}`,
    ...squad.players.map(
      (player) =>
        `${player.slot} ${player.rating} ${player.name} (${player.club ?? 'no club'}, ${player.nation})`,
    ),
  ].join('\n')

  async function markSubmitted(): Promise<void> {
    const response = await fetch('/api/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sbcName, squadIndex: index, squad }),
    })
    const body = (await response.json()) as { error?: string; recorded?: boolean }
    setSubmitted(body.error ?? 'Recorded, and the cards were taken out of the club.')
  }

  return (
    <div className="border border-neutral-900 p-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-bold text-neutral-200">
          Squad {index}: rating {squad.rating}, chemistry {squad.chemistry}, {squad.cost} cost
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(asText)
            setCopied(true)
          }}
          className="border border-neutral-700 px-2"
        >
          {copied ? 'copied' : 'Copy as text'}
        </button>
        <button type="button" onClick={() => void markSubmitted()} className="border border-neutral-700 px-2">
          Mark as submitted
        </button>
        {submitted !== null ? <span className="text-amber-300">{submitted}</span> : null}
      </div>

      <table className="mt-2 w-full text-left">
        <tbody>
          {squad.players.map((player, position) => (
            <tr key={position} className="border-t border-neutral-900">
              <td className="w-10 py-0.5 text-neutral-500">{player.slot}</td>
              <td className="w-8 py-0.5">{player.rating}</td>
              <td className="py-0.5 text-neutral-200">{player.name}</td>
              <td className="py-0.5">{player.club ?? 'no club'}</td>
              <td className="py-0.5">{player.league ?? 'no league'}</td>
              <td className="py-0.5">{player.nation}</td>
              <td className="py-0.5">chem {player.chemistry}</td>
              <td className="py-0.5">
                {player.inPosition ? '' : <span className="text-amber-400">OUT OF POSITION</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2">
        {squad.requirements.length === 0 ? (
          <p className="text-neutral-600">no requirements</p>
        ) : (
          squad.requirements.map((requirement) => (
            <p key={requirement.label}>
              <span className={requirement.passed ? 'text-emerald-400' : 'text-red-400'}>
                {requirement.passed ? 'PASS' : 'FAIL'}
              </span>{' '}
              {requirement.label}: achieved {requirement.achieved}, required {requirement.required}
            </p>
          ))
        )}
      </div>

      {/* The solver is told what the rules are and is never trusted to have
          applied them. Where the two disagree, the disagreement is shown. */}
      {squad.mismatches.length > 0 ? (
        <div className="mt-2 border border-red-900 p-2 text-red-300">
          <p className="font-bold">MISMATCH between the solver and the rules engine:</p>
          {squad.mismatches.map((mismatch) => (
            <p key={mismatch}>{mismatch}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
