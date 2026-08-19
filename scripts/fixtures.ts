/**
 * Ground truth fixture entry.
 *
 * Brief 4.3 asks for a UI page for this. It is a CLI for now, because the UI does
 * not exist until checkpoint 14 and readings need somewhere to land before then.
 * The web page arrives with the rest of the UI and calls the same validation.
 *
 *   npm run fixture:template 4-4-2 > my-squad.json
 *   npm run fixture:add my-squad.json
 *   npm run fixture:check
 *
 * add validates and immediately scores the fixture, so a reading either confirms
 * the engine or fails it within a second of being typed in.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getFormation, listFormations } from '../src/rules/formations.ts'
import {
  formatReport,
  runAllFixtures,
  runFixture,
  validateFixture,
} from '../src/rules/groundTruth.ts'
import {
  collectUnverified,
  formatStartupWarning,
  queuedReadings,
} from '../src/rules/verification.ts'
import { defaultCardTypeRegistry } from '../src/rules/cardTypes.ts'
import type { GroundTruthFixture } from '../src/types/squad.ts'

const FIXTURES_PATH = fileURLToPath(new URL('../tests/fixtures/ground-truth.json', import.meta.url))

interface FixtureFile {
  $comment?: string
  fixtures: GroundTruthFixture[]
}

function load(): FixtureFile {
  return JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as FixtureFile
}

function save(file: FixtureFile): void {
  writeFileSync(FIXTURES_PATH, `${JSON.stringify(file, null, 2)}\n`)
}

function template(formationName: string): string {
  const formation = getFormation(formationName)
  const fixture: GroundTruthFixture = {
    id: 'gt-XXX-describe-it',
    description: 'What this squad is for and what it would prove.',
    formation: formation.name,
    players: formation.slots.map((slot, index) => ({
      defId: null,
      name: `Player ${index}`,
      rating: 0,
      slotPosition: slot,
      positions: [slot],
      nation: '',
      league: null,
      club: null,
      cardType: 'rare',
      isWomens: false,
    })),
    displayedRating: 0,
    displayedChemistry: 0,
    displayedPlayerChemistry: formation.slots.map(() => 0),
    verifies: ['squadRating', 'chemistry'],
    source: 'Observed in game on YYYY-MM-DD.',
  }
  return JSON.stringify(fixture, null, 2)
}

function add(path: string): number {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as GroundTruthFixture

  const problems = validateFixture(fixture)
  if (problems.length > 0) {
    console.error(`Not stored. ${fixture.id} has ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  ${problem}`)
    return 1
  }

  const file = load()
  if (file.fixtures.some((f) => f.id === fixture.id)) {
    console.error(`Not stored. A fixture with id "${fixture.id}" already exists.`)
    return 1
  }

  // Score it before storing, so the reading immediately says pass or fail.
  const result = runFixture(fixture)
  file.fixtures.push(fixture)
  save(file)

  if (result.passed) {
    console.log(`Stored ${fixture.id}. PASS: the engine agrees with the game.`)
    return 0
  }

  console.log(`Stored ${fixture.id}. FAIL: the engine disagrees with the game.`)
  for (const failure of result.failures) {
    console.log(`  ${failure.what}: game says ${failure.expected}, engine says ${failure.actual}`)
  }
  console.log('')
  console.log('The fixture is right and the engine is wrong. It is stored either way,')
  console.log('so the failure stays visible in CI until the engine is fixed.')
  return 0
}

function check(): number {
  const file = load()
  const report = runAllFixtures(file.fixtures, defaultCardTypeRegistry)
  console.log('Ground truth')
  console.log(formatReport(report))
  console.log('')
  const unverified = collectUnverified(defaultCardTypeRegistry)
  console.log(formatStartupWarning(unverified, queuedReadings(file.fixtures, unverified)))
  return report.failed === 0 ? 0 : 1
}

const [command, argument] = process.argv.slice(2)

switch (command) {
  case 'template': {
    if (argument === undefined) {
      console.error(`Usage: fixture:template <formation>`)
      console.error(`Known: ${listFormations().map((f) => f.name).join(', ')}`)
      process.exit(1)
    }
    console.log(template(argument))
    break
  }
  case 'add': {
    if (argument === undefined) {
      console.error('Usage: fixture:add <file.json>')
      process.exit(1)
    }
    process.exit(add(argument))
    break
  }
  case 'check': {
    process.exit(check())
    break
  }
  default:
    console.error('Usage: fixtures <template|add|check>')
    process.exit(1)
}
