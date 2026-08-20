import { sbcs } from '../lib/server'
import SolveConsole from './SolveConsole'

export const dynamic = 'force-dynamic'

export default function SolvePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-neutral-100">Queue and solve</h1>
      <SolveConsole
        library={sbcs().map((definition) => ({
          name: definition.name,
          formation: definition.formation,
          teamRating: definition.teamRating ?? null,
          repeatable: definition.repeatable,
          requirementCount: definition.requirements.length,
        }))}
      />
    </div>
  )
}
