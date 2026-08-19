/**
 * Requirement level impossibility, caught before the solver starts. Brief 4.4.
 *
 * SCOPE, and it matters. This looks at the requirements ALONE. It answers "no
 * squad of any eleven cards could satisfy this set", not "my club cannot satisfy
 * it". The brief's example of one distinct league alongside five distinct nations
 * is the second kind: it depends on what is in the club, and it belongs to the
 * impossibility diagnosis at checkpoint 12, which has the pool to reason about.
 *
 * Keeping the two apart is deliberate. A conflict reported here is a fact about
 * the SBC and is true for everyone. Anything club dependent has to say "your club
 * cannot do this", which is a different sentence and a different code path.
 */

import type { Requirement, RequirementConflict } from '../types/requirements'
import { MAX_SQUAD_CHEMISTRY } from './chemistry'
import { SQUAD_SIZE } from './squadRating'

type Op = 'min' | 'max' | 'exact'

interface Bound {
  min: number
  max: number
  sources: Requirement[]
}

function emptyBound(): Bound {
  return { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY, sources: [] }
}

function tighten(bound: Bound, op: Op, value: number, source: Requirement): void {
  if (op === 'min') bound.min = Math.max(bound.min, value)
  else if (op === 'max') bound.max = Math.min(bound.max, value)
  else {
    bound.min = Math.max(bound.min, value)
    bound.max = Math.min(bound.max, value)
  }
  bound.sources.push(source)
}

function contradictory(bound: Bound): boolean {
  return bound.min > bound.max
}

export function detectConflicts(requirements: readonly Requirement[]): RequirementConflict[] {
  const conflicts: RequirementConflict[] = []
  const add = (reason: string, sources: readonly Requirement[]): void => {
    conflicts.push({ requirements: [...sources], reason })
  }

  // Bounds that several requirements can tighten independently.
  const teamRating = emptyBound()
  const squadSize = emptyBound()
  const namedLeague = new Map<string, Bound>()
  const namedNation = new Map<string, Bound>()
  const namedClub = new Map<string, Bound>()
  const distinct = { leagues: emptyBound(), nations: emptyBound(), clubs: emptyBound() }
  const same = { leagues: emptyBound(), nations: emptyBound(), clubs: emptyBound() }
  const quality = new Map<string, Bound>()

  let minPlayerRatingAll: { value: number; source: Requirement } | null = null
  let maxPlayerRating: { value: number; source: Requirement } | null = null
  let chemistryMin: { value: number; source: Requirement } | null = null
  let perPlayerChem: { value: number; count: number; source: Requirement } | null = null
  const formations: Requirement[] = []

  const bucket = (map: Map<string, Bound>, key: string): Bound => {
    const existing = map.get(key)
    if (existing !== undefined) return existing
    const created = emptyBound()
    map.set(key, created)
    return created
  }

  for (const requirement of requirements) {
    switch (requirement.type) {
      case 'squadSize':
        tighten(squadSize, 'exact', requirement.value, requirement)
        break
      case 'teamRating':
        tighten(teamRating, requirement.op, requirement.value, requirement)
        break
      case 'teamChemistry':
        chemistryMin = { value: requirement.value, source: requirement }
        break
      case 'perPlayerChemistry':
        perPlayerChem = {
          value: requirement.value,
          count: requirement.count ?? SQUAD_SIZE,
          source: requirement,
        }
        break
      case 'playersFromLeague':
        tighten(bucket(namedLeague, requirement.league), requirement.op, requirement.value, requirement)
        break
      case 'playersFromNation':
        tighten(bucket(namedNation, requirement.nation), requirement.op, requirement.value, requirement)
        break
      case 'playersFromClub':
        tighten(bucket(namedClub, requirement.club), requirement.op, requirement.value, requirement)
        break
      case 'distinctLeagues':
        tighten(distinct.leagues, requirement.op, requirement.value, requirement)
        break
      case 'distinctNations':
        tighten(distinct.nations, requirement.op, requirement.value, requirement)
        break
      case 'distinctClubs':
        tighten(distinct.clubs, requirement.op, requirement.value, requirement)
        break
      case 'sameLeagueCount':
        tighten(same.leagues, requirement.op, requirement.value, requirement)
        break
      case 'sameNationCount':
        tighten(same.nations, requirement.op, requirement.value, requirement)
        break
      case 'sameClubCount':
        tighten(same.clubs, requirement.op, requirement.value, requirement)
        break
      case 'qualityCount':
        tighten(bucket(quality, requirement.quality), requirement.op, requirement.value, requirement)
        break
      case 'minPlayerRating':
        if (requirement.count === undefined) minPlayerRatingAll = { value: requirement.value, source: requirement }
        break
      case 'maxPlayerRating':
        maxPlayerRating = { value: requirement.value, source: requirement }
        break
      case 'formation':
        formations.push(requirement)
        break
      default:
        break
    }
  }

  const size = Number.isFinite(squadSize.min) ? squadSize.min : SQUAD_SIZE

  // Self contradictory bounds on the same quantity.
  const boundChecks: [string, Bound][] = [
    ['squad rating', teamRating],
    ['squad size', squadSize],
    ['distinct leagues', distinct.leagues],
    ['distinct nations', distinct.nations],
    ['distinct clubs', distinct.clubs],
    ['players sharing any one league', same.leagues],
    ['players sharing any one nation', same.nations],
    ['players sharing any one club', same.clubs],
  ]
  for (const [label, bound] of boundChecks) {
    if (contradictory(bound)) {
      add(`${label} is required to be at least ${bound.min} and at most ${bound.max}`, bound.sources)
    }
  }
  for (const [maps, label] of [
    [namedLeague, 'league'],
    [namedNation, 'nation'],
    [namedClub, 'club'],
  ] as const) {
    for (const [name, bound] of maps) {
      if (contradictory(bound)) {
        add(`players from ${name} must be at least ${bound.min} and at most ${bound.max}`, bound.sources)
      }
    }
  }
  for (const [name, bound] of quality) {
    if (contradictory(bound)) {
      add(`${name} players must be at least ${bound.min} and at most ${bound.max}`, bound.sources)
    }
  }

  if (Number.isFinite(squadSize.min) && squadSize.min !== SQUAD_SIZE) {
    add(
      `squad size ${squadSize.min} is not supported, this solver builds ${SQUAD_SIZE} player squads`,
      squadSize.sources,
    )
  }

  // A count of players cannot exceed the squad, or fall below zero.
  const overSquad: [string, Bound][] = [
    ['distinct leagues', distinct.leagues],
    ['distinct nations', distinct.nations],
    ['distinct clubs', distinct.clubs],
    ['players sharing any one league', same.leagues],
    ['players sharing any one nation', same.nations],
    ['players sharing any one club', same.clubs],
  ]
  for (const [label, bound] of overSquad) {
    if (bound.min > size) {
      add(`${label} needs at least ${bound.min}, but the squad only has ${size} players`, bound.sources)
    }
  }
  for (const [maps, label] of [
    [namedLeague, 'league'],
    [namedNation, 'nation'],
    [namedClub, 'club'],
  ] as const) {
    for (const [name, bound] of maps) {
      if (bound.min > size) {
        add(`${bound.min} players from ${name} exceeds the ${size} player squad`, bound.sources)
      }
    }
  }

  // Named minimums across DIFFERENT entities of the same kind add up, because a
  // card belongs to exactly one club, one league and one nation.
  for (const [maps, label] of [
    [namedLeague, 'leagues'],
    [namedNation, 'nations'],
    [namedClub, 'clubs'],
  ] as const) {
    const sources: Requirement[] = []
    let total = 0
    for (const bound of maps.values()) {
      if (Number.isFinite(bound.min) && bound.min > 0) {
        total += bound.min
        sources.push(...bound.sources)
      }
    }
    if (total > size) {
      add(`the named ${label} require ${total} players between them, more than the squad's ${size}`, sources)
    }
  }

  // Quality bands partition the squad, so their minimums add up too.
  {
    let total = 0
    const sources: Requirement[] = []
    for (const bound of quality.values()) {
      if (Number.isFinite(bound.min) && bound.min > 0) {
        total += bound.min
        sources.push(...bound.sources)
      }
    }
    if (total > size) {
      add(`the quality band minimums require ${total} players, more than the squad's ${size}`, sources)
    }
  }

  // Distinct entities versus the largest group. Reaching D distinct leagues while
  // one league holds S players needs S + (D - 1) cards at minimum.
  const distinctVersusSame: [string, Bound, Bound][] = [
    ['leagues', distinct.leagues, same.leagues],
    ['nations', distinct.nations, same.nations],
    ['clubs', distinct.clubs, same.clubs],
  ]
  for (const [label, distinctBound, sameBound] of distinctVersusSame) {
    if (Number.isFinite(distinctBound.min) && Number.isFinite(sameBound.min)) {
      const needed = sameBound.min + distinctBound.min - 1
      if (needed > size) {
        add(
          `${sameBound.min} players sharing one of the ${label} plus ${distinctBound.min} distinct ` +
            `${label} needs ${needed} players, more than the squad's ${size}`,
          [...distinctBound.sources, ...sameBound.sources],
        )
      }
    }
  }

  // The squad rating is bounded by the individual ratings: eleven cards all at or
  // below M can never rate above M, and all at or above L can never rate below L.
  if (maxPlayerRating !== null && Number.isFinite(teamRating.min) && teamRating.min > maxPlayerRating.value) {
    add(
      `a squad rating of ${teamRating.min} is impossible when no player may exceed ${maxPlayerRating.value}`,
      [...teamRating.sources, maxPlayerRating.source],
    )
  }
  if (minPlayerRatingAll !== null && Number.isFinite(teamRating.max) && teamRating.max < minPlayerRatingAll.value) {
    add(
      `a squad rating of at most ${teamRating.max} is impossible when every player must be at least ` +
        `${minPlayerRatingAll.value}`,
      [...teamRating.sources, minPlayerRatingAll.source],
    )
  }
  if (
    minPlayerRatingAll !== null &&
    maxPlayerRating !== null &&
    minPlayerRatingAll.value > maxPlayerRating.value
  ) {
    add(
      `every player must be at least ${minPlayerRatingAll.value} and at most ${maxPlayerRating.value}`,
      [minPlayerRatingAll.source, maxPlayerRating.source],
    )
  }

  if (chemistryMin !== null && chemistryMin.value > MAX_SQUAD_CHEMISTRY) {
    add(`squad chemistry cannot exceed ${MAX_SQUAD_CHEMISTRY}`, [chemistryMin.source])
  }
  if (perPlayerChem !== null) {
    if (perPlayerChem.value > 3) {
      add('a single player cannot exceed 3 chemistry', [perPlayerChem.source])
    }
    if (perPlayerChem.count > size) {
      add(
        `${perPlayerChem.count} players must reach ${perPlayerChem.value} chemistry, but the squad ` +
          `only has ${size}`,
        [perPlayerChem.source],
      )
    }
    if (chemistryMin !== null && perPlayerChem.count * perPlayerChem.value > MAX_SQUAD_CHEMISTRY) {
      add(
        `${perPlayerChem.count} players at ${perPlayerChem.value} chemistry each exceeds the ` +
          `${MAX_SQUAD_CHEMISTRY} point maximum`,
        [perPlayerChem.source],
      )
    }
  }

  if (formations.length > 1) {
    const names = [...new Set(formations.map((f) => (f.type === 'formation' ? f.value : '')))]
    if (names.length > 1) {
      add(`two different formations are required: ${names.join(' and ')}`, formations)
    }
  }

  return conflicts
}
