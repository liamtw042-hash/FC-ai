/**
 * The ground truth harness. Brief 4.3.
 *
 * Unit tests prove the code matches the spec. They do not prove the spec matches
 * the game. This is the only thing in the repo that does.
 *
 * A fixture is 11 real cards, a formation, and the numbers the game actually
 * displayed. IF A FIXTURE FAILS, THE ENGINE IS WRONG, NOT THE FIXTURE.
 *
 * Fixtures are self contained: they carry the card facts they need rather than
 * referencing defIds. A fixture is a permanent record of what the game did on a
 * given day and must not stop working because the player database was refreshed.
 */

import type { CardDefinition, ResolvedCard } from '../types/cards'
import type { GroundTruthFixture, GroundTruthPlayer, PlacedPlayer } from '../types/squad'
import { calculateSquadRating } from './squadRating'
import { calculateChemistry } from './chemistry'
import { defaultCardTypeRegistry, type CardTypeRegistry } from './cardTypes'
import { getFormation, hasFormation } from './formations'
import { SQUAD_SIZE } from './squadRating'

export interface FixtureFailure {
  what: string
  expected: number | string
  actual: number | string
  /** Present when a per player value disagrees, so the failure names the player. */
  slotIndex?: number
}

export interface FixtureResult {
  id: string
  passed: boolean
  /** True when the expected values are documented behaviour, not an observed reading. */
  pending: boolean
  pendingRef: string | null
  failures: FixtureFailure[]
}

export interface GroundTruthReport {
  results: FixtureResult[]
  passed: number
  failed: number
  pending: number
}

export class InvalidFixtureError extends Error {
  constructor(id: string, reason: string) {
    super(`Fixture "${id}" is not usable: ${reason}`)
    this.name = 'InvalidFixtureError'
  }
}

function toCardDefinition(player: GroundTruthPlayer, index: number, id: string): CardDefinition {
  if (player.nation === undefined) {
    throw new InvalidFixtureError(id, `player ${index} has no nation, needed for chemistry`)
  }
  if (player.positions === undefined || player.positions.length === 0) {
    throw new InvalidFixtureError(id, `player ${index} has no positions, needed for chemistry`)
  }
  return {
    defId: player.defId ?? `${id}-p${index}`,
    name: player.name ?? `${id} player ${index}`,
    rating: player.rating,
    positions: player.positions,
    nation: player.nation,
    league: player.league ?? null,
    club: player.club ?? null,
    cardType: player.cardType ?? 'rare',
    isWomens: player.isWomens ?? false,
  }
}

function toPlacedPlayers(
  fixture: GroundTruthFixture,
  registry: CardTypeRegistry,
): PlacedPlayer[] {
  return fixture.players.map((player, index) => {
    const definition = toCardDefinition(player, index, fixture.id)
    const card: ResolvedCard = {
      owned: {
        id: `${fixture.id}-owned-${index}`,
        defId: definition.defId,
        quantity: 1,
        pool: 'club',
        untradeable: false,
        isLoan: false,
        isEvolved: false,
        locked: false,
        inActiveSquad: false,
        estimatedPrice: null,
      },
      definition,
      type: registry.get(definition.cardType),
      effectivePositions: definition.positions,
    }
    return { card, slotIndex: index, slotPosition: player.slotPosition }
  })
}

/**
 * Structural validation, run before a fixture is stored and before it is scored.
 *
 * The per player chemistry sum check is the important one. A fixture whose eleven
 * values do not add up to the stated total is a data entry error, and catching it
 * here is the difference between a five second correction and an afternoon spent
 * doubting the engine.
 */
function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

export function validateFixture(fixture: GroundTruthFixture): string[] {
  const problems: string[] = []

  if (fixture.players.length !== SQUAD_SIZE) {
    problems.push(`needs exactly ${SQUAD_SIZE} players, has ${fixture.players.length}`)
  }
  if (!hasFormation(fixture.formation)) {
    problems.push(`unknown formation "${fixture.formation}"`)
  } else {
    // Compared as a multiset, not index by index. Chemistry in FC 24 and later has
    // no positional links, so slot ORDER carries no meaning and insisting on it
    // would reject a correctly entered fixture whose players were simply listed
    // right to left. What does matter is using the positions the formation has.
    const expected = countBy(getFormation(fixture.formation).slots)
    const actual = countBy(fixture.players.map((p) => p.slotPosition))
    for (const position of new Set([...expected.keys(), ...actual.keys()])) {
      const want = expected.get(position) ?? 0
      const got = actual.get(position) ?? 0
      if (want !== got) {
        problems.push(
          `${fixture.formation} has ${want} ${position} slot(s) but the fixture ` +
            `records ${got}`,
        )
      }
    }
  }

  const wantsChemistry = fixture.verifies.includes('chemistry')
  const per = fixture.displayedPlayerChemistry

  if (wantsChemistry) {
    if (per === null) {
      problems.push('verifies chemistry but has no per player chemistry values')
    } else if (per.length !== SQUAD_SIZE) {
      problems.push(`needs ${SQUAD_SIZE} per player chemistry values, has ${per.length}`)
    } else if (fixture.displayedChemistry === null) {
      problems.push('has per player chemistry but no squad total to check it against')
    } else {
      const sum = per.reduce((a, b) => a + b, 0)
      if (sum !== fixture.displayedChemistry) {
        problems.push(
          `per player chemistry sums to ${sum} but the squad total is recorded as ` +
            `${fixture.displayedChemistry}. One of the two was mistyped.`,
        )
      }
      if (per.some((value) => value < 0 || value > 3)) {
        problems.push('a per player chemistry value is outside 0 to 3')
      }
    }
  }

  if (per !== null && fixture.displayedChemistry === null) {
    problems.push('has per player chemistry values but a null squad total')
  }

  return problems
}

export function runFixture(
  fixture: GroundTruthFixture,
  registry: CardTypeRegistry = defaultCardTypeRegistry,
): FixtureResult {
  const failures: FixtureFailure[] = []

  for (const problem of validateFixture(fixture)) {
    failures.push({ what: 'fixture structure', expected: 'valid', actual: problem })
  }

  if (failures.length === 0 && fixture.verifies.includes('squadRating')) {
    const actual = calculateSquadRating(fixture.players.map((p) => p.rating))
    if (actual !== fixture.displayedRating) {
      failures.push({ what: 'squad rating', expected: fixture.displayedRating, actual })
    }
  }

  if (failures.length === 0 && fixture.verifies.includes('chemistry')) {
    const result = calculateChemistry(toPlacedPlayers(fixture, registry))
    if (result.total !== fixture.displayedChemistry) {
      failures.push({
        what: 'squad chemistry',
        expected: fixture.displayedChemistry ?? 'null',
        actual: result.total,
      })
    }
    const per = fixture.displayedPlayerChemistry ?? []
    result.players.forEach((player, index) => {
      const expected = per[index]
      if (expected !== undefined && player.chemistry !== expected) {
        failures.push({
          what: `chemistry for player ${index}`,
          expected,
          actual: player.chemistry,
          slotIndex: index,
        })
      }
    })
  }

  return {
    id: fixture.id,
    passed: failures.length === 0,
    pending: fixture.pending_verification === true,
    pendingRef: fixture.pendingRef ?? null,
    failures,
  }
}

export function runAllFixtures(
  fixtures: readonly GroundTruthFixture[],
  registry: CardTypeRegistry = defaultCardTypeRegistry,
): GroundTruthReport {
  const results = fixtures.map((fixture) => runFixture(fixture, registry))
  return {
    results,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    pending: results.filter((r) => r.pending).length,
  }
}

export function formatReport(report: GroundTruthReport): string {
  const lines: string[] = []
  for (const result of report.results) {
    const flag = result.passed ? 'pass' : 'FAIL'
    const pending = result.pending
      ? `  PENDING (${result.pendingRef ?? 'no PENDING entry'})`
      : ''
    lines.push(`  ${flag}  ${result.id}${pending}`)
    for (const failure of result.failures) {
      lines.push(`         ${failure.what}: expected ${failure.expected}, got ${failure.actual}`)
    }
  }
  lines.push('')
  lines.push(
    `  ${report.passed} passed, ${report.failed} failed, ${report.pending} awaiting in game verification`,
  )
  return lines.join('\n')
}
