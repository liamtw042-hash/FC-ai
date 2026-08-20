import { state } from '../lib/server'
import IntakeForms from './IntakeForms'

export const dynamic = 'force-dynamic'

export default function IntakePage() {
  const current = state()
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-neutral-100">Intake</h1>

      <section className="max-w-3xl border border-neutral-800 p-3 text-sm">
        <h2 className="font-bold text-neutral-200">Screenshot intake</h2>
        <div className="mt-2 border border-dashed border-neutral-700 p-6 text-center text-neutral-500">
          <p className="text-neutral-400">Not built yet.</p>
          <p className="mt-2 text-xs">
            OCR needs a real player database to match names against, and that loader is
            blocked on an API key and on rate limits that must not be guessed at. There is
            deliberately no placeholder here: a drop zone that half worked would be worse
            than one that says it does not.
          </p>
        </div>
      </section>

      <IntakeForms
        cardCount={current.cards.length}
        clubCount={current.club.length}
        priceCount={Object.keys(current.prices).length}
        names={current.cards.slice(0, 4000).map((card) => ({
          defId: card.defId,
          name: card.name,
          rating: card.rating,
          club: card.club,
        }))}
      />
    </div>
  )
}
