import Link from 'next/link'
import { buildPool, state, sbcs, unverified } from './lib/server'
import { formatAvailability } from '../src/rules/exclusions'

export const dynamic = 'force-dynamic'

export default function Home() {
  const current = state()
  const ready = current.cards.length > 0 && current.club.length > 0
  const pool = ready ? buildPool(current.club, current.cards, { prices: current.prices }) : null

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-lg font-bold text-neutral-100">FC-ai</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-400">
          A personal SBC solver. It reads card and club data you give it and does maths.
          It has no code path that reaches EA, and that is the architecture rather than a
          setting.
        </p>
      </section>

      <section className="space-y-1 text-sm">
        <h2 className="font-bold text-neutral-200">What is loaded</h2>
        {ready && pool !== null ? (
          <>
            <p>
              {current.cards.length} card definition(s) from{' '}
              <code className="text-neutral-500">{current.cardsImportedFrom}</code>
            </p>
            <p>
              {current.club.length} club stack(s) from{' '}
              <code className="text-neutral-500">{current.clubImportedFrom}</code>
            </p>
            <p>{formatAvailability(pool.availability)}</p>
            {pool.unpricedRatings.length > 0 ? (
              <p className="text-amber-300">
                No price for rating(s) {pool.unpricedRatings.join(', ')}. No coin figure will
                be quoted for them, deliberately.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-amber-300">
            Nothing imported yet. Start at <Link href="/intake" className="underline">Intake</Link>,
            or run the three import commands in QUICKSTART.md.
          </p>
        )}
        <p>{sbcs().length} SBC(s) defined</p>
      </section>

      <section className="text-sm">
        <h2 className="font-bold text-neutral-200">Not verified</h2>
        <p className="text-neutral-400">
          {unverified().length} rule value(s) could change a returned squad and have not been
          confirmed by an in game reading. They are listed in the banner above and in
          PENDING.md, with the reading that would clear each one.
        </p>
      </section>
    </div>
  )
}
