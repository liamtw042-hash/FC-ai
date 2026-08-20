import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextResponse } from 'next/server'
import { runFixture, validateFixture } from '../../../src/rules/groundTruth'
import type { GroundTruthFixture } from '../../../src/types/squad'
import { ROOT } from '../../lib/server'

function path(): string {
  return resolve(ROOT, 'tests', 'fixtures', 'ground-truth.json')
}

interface FixtureFile {
  fixtures: GroundTruthFixture[]
}

export function GET(): NextResponse {
  const file = JSON.parse(readFileSync(path(), 'utf8')) as FixtureFile
  return NextResponse.json({ fixtures: file.fixtures })
}

/**
 * Fixture entry, calling the SAME `validateFixture` the command line does.
 *
 * A fixture is a permanent record of what the game displayed, and it is the only
 * thing in this repository that outranks the engine. So it is checked hard before
 * it is stored: eleven players, the formation's own slots, per player chemistry
 * that sums to the recorded total. A mistyped fixture that gets saved costs an
 * afternoon of doubting correct code.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let fixture: GroundTruthFixture
  try {
    fixture = (await request.json()) as GroundTruthFixture
  } catch (error) {
    return NextResponse.json({ error: `that is not valid JSON: ${String(error)}` }, { status: 400 })
  }

  const problems = validateFixture(fixture)
  if (problems.length > 0) {
    return NextResponse.json({ problems, saved: false }, { status: 422 })
  }

  const file = JSON.parse(readFileSync(path(), 'utf8')) as FixtureFile
  if (file.fixtures.some((existing) => existing.id === fixture.id)) {
    return NextResponse.json(
      { problems: [`a fixture with id ${fixture.id} already exists`], saved: false },
      { status: 409 },
    )
  }

  // Run it BEFORE saving, and report what the engine made of it. A fixture that
  // disagrees with the engine is still saved, because the fixture is the one that
  // is right: the disagreement is the finding, not an error.
  const result = runFixture(fixture)
  file.fixtures.push(fixture)
  writeFileSync(path(), JSON.stringify(file, null, 2) + '\n')
  return NextResponse.json({
    saved: true,
    passed: result.passed,
    failures: result.failures,
  })
}
