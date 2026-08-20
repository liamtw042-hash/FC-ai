import { sbcs } from '../lib/server'
import PlannerConsole from './PlannerConsole'

export const dynamic = 'force-dynamic'

export default function PlannerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-neutral-100">Grind planner</h1>
      <p className="max-w-3xl text-sm text-neutral-400">
        What the club can feed now, and the cheapest purchase that would unlock one more
        squad. It is not a second planner: the queue solve hands its achieved counts to the
        same model, so the plan and the solve agree by construction. A challenge that a
        requirement is blocking has its purchase suppressed entirely rather than shown with
        a caveat, because a coin figure next to a warning still reads as a coin figure.
      </p>
      <PlannerConsole
        library={sbcs().map((definition) => ({
          name: definition.name,
          repeatable: definition.repeatable,
        }))}
      />
    </div>
  )
}
