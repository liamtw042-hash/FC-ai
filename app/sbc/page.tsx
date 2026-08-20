import { listFormations } from '../../src/rules/formations'
import { detectConflicts } from '../../src/rules/detectConflicts'
import { sbcs } from '../lib/server'
import SbcLibrary from './SbcLibrary'

export const dynamic = 'force-dynamic'

export default function SbcPage() {
  const library = sbcs().map((definition) => ({
    ...definition,
    conflicts: detectConflicts(definition.requirements).map((conflict) => conflict.reason),
  }))
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-neutral-100">SBC library</h1>
      <SbcLibrary library={library} formations={listFormations().map((formation) => formation.name)} />
    </div>
  )
}
