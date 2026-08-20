import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getFormation, listFormations } from '../../src/rules/formations'
import type { GroundTruthFixture } from '../../src/types/squad'
import { ROOT } from '../lib/server'
import FixtureForm from './FixtureForm'

export const dynamic = 'force-dynamic'

export default function FixturesPage() {
  const file = JSON.parse(
    readFileSync(resolve(ROOT, 'tests', 'fixtures', 'ground-truth.json'), 'utf8'),
  ) as { fixtures: GroundTruthFixture[] }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-neutral-100">Ground truth fixtures</h1>
      <p className="max-w-3xl text-sm text-neutral-400">
        A fixture is what the game displayed, and it is the only thing in this repository
        that outranks the engine. If a fixture fails, the engine is wrong. Everything entered
        here goes through the same <code>validateFixture</code> the command line uses, before
        it is stored.
      </p>

      <section className="border border-neutral-800 p-3 text-sm">
        <h2 className="font-bold text-neutral-200">{file.fixtures.length} recorded</h2>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-1 pr-4">id</th>
              <th className="py-1 pr-4">formation</th>
              <th className="py-1 pr-4">rating</th>
              <th className="py-1 pr-4">chemistry</th>
              <th className="py-1 pr-4">verifies</th>
              <th className="py-1 pr-4">status</th>
            </tr>
          </thead>
          <tbody>
            {file.fixtures.map((fixture) => (
              <tr key={fixture.id} className="border-t border-neutral-900">
                <td className="py-1 pr-4 text-neutral-200">{fixture.id}</td>
                <td className="py-1 pr-4">{fixture.formation}</td>
                <td className="py-1 pr-4">{fixture.displayedRating}</td>
                <td className="py-1 pr-4">{fixture.displayedChemistry ?? '-'}</td>
                <td className="py-1 pr-4">{fixture.verifies.join(', ')}</td>
                <td className="py-1 pr-4">
                  {fixture.pending_verification === true ? (
                    <span className="text-amber-300">
                      PENDING a real reading{fixture.pendingRef === undefined ? '' : ` (${fixture.pendingRef})`}
                    </span>
                  ) : (
                    <span className="text-emerald-400">observed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <FixtureForm
        formations={listFormations().map((formation) => ({
          name: formation.name,
          slots: getFormation(formation.name).slots,
        }))}
      />
    </div>
  )
}
