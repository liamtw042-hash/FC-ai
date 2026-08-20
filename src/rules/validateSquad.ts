/**
 * Per requirement pass or fail. Brief 4.4 and 6.
 *
 * Every requirement is checked independently and reported with what the squad
 * achieved next to what was needed, because "this squad is invalid" is useless
 * and "min 4 from the Premier League, you have 3" is actionable.
 */

import type { Requirement, RequirementResult, CountOp, MinMaxOp } from '../types/requirements'
import { isKnownRequirementType } from '../types/requirements'
import type { PlacedPlayer, Squad } from '../types/squad'
import { calculateChemistry } from './chemistry'
import { calculateSquadRating } from './squadRating'
import { qualityOf } from './quality'

function satisfies(actual: number, op: CountOp | MinMaxOp, value: number): boolean {
  if (op === 'min') return actual >= value
  if (op === 'max') return actual <= value
  return actual === value
}

function describe(op: CountOp | MinMaxOp, value: number): string {
  return `${op} ${value}`
}

function countBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    // A null entity is an absent entity. Icons have no club and no league, and
    // they must not all pile up under a shared blank.
    if (k === null) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

function largestGroup(counts: Map<string, number>): number {
  let largest = 0
  for (const count of counts.values()) if (count > largest) largest = count
  return largest
}

function tally(players: readonly PlacedPlayer[], predicate: (p: PlacedPlayer) => boolean): number {
  return players.filter(predicate).length
}

export function validateSquad(squad: Squad, requirements: readonly Requirement[]): RequirementResult[] {
  const players = squad.players
  const ratings = players.map((p) => p.card.definition.rating)
  const chemistry = calculateChemistry(players, squad.manager)
  const rating = players.length === 11 ? calculateSquadRating(ratings) : null

  const clubs = countBy(players, (p) => p.card.definition.club)
  const leagues = countBy(players, (p) => p.card.definition.league)
  const nations = countBy(players, (p) => p.card.definition.nation)

  return requirements.map((requirement): RequirementResult => {
    // THE SWITCH BELOW IS EXHAUSTIVE OVER THE UNION, WHICH IS NOT THE SAME AS
    // EXHAUSTIVE OVER WHAT ARRIVES. Requirements come from pasted SBC text, from
    // JSON on disk and from HTTP bodies, none of which the compiler has seen. A
    // type outside the union used to fall off the end of the switch and come back
    // as `undefined` in the results list, which rendered as a null row and made
    // `squadPasses` throw. The Python side raises UnsupportedRequirement loudly
    // for exactly this, and the two have to agree.
    if (!isKnownRequirementType((requirement as { type: string }).type)) {
      return {
        requirement,
        passed: false,
        achieved: 'NOT CHECKED: this build does not know this requirement type',
        required: (requirement as { type: string }).type,
      }
    }

    const result = (passed: boolean, achieved: number | string | null, required: number | string | null) => ({
      requirement,
      passed,
      achieved,
      required,
    })

    switch (requirement.type) {
      case 'squadSize':
        return result(players.length === requirement.value, players.length, requirement.value)

      case 'teamRating': {
        if (rating === null) return result(false, 'incomplete squad', describe(requirement.op, requirement.value))
        return result(
          satisfies(rating, requirement.op, requirement.value),
          rating,
          describe(requirement.op, requirement.value),
        )
      }

      case 'teamChemistry':
        return result(
          satisfies(chemistry.total, 'min', requirement.value),
          chemistry.total,
          `min ${requirement.value}`,
        )

      case 'perPlayerChemistry': {
        // Distinct from teamChemistry. A squad can hit the total and still fail
        // a per player floor. count omitted means all eleven.
        const needed = requirement.count ?? players.length
        const meeting = chemistry.players.filter((p) => p.chemistry >= requirement.value).length
        return result(
          meeting >= needed,
          `${meeting} of ${players.length} on ${requirement.value}+`,
          `${needed} on ${requirement.value}+`,
        )
      }

      case 'playersFromLeague': {
        const actual = leagues.get(requirement.league) ?? 0
        return result(
          satisfies(actual, requirement.op, requirement.value),
          actual,
          `${describe(requirement.op, requirement.value)} from ${requirement.league}`,
        )
      }

      case 'playersFromNation': {
        const actual = nations.get(requirement.nation) ?? 0
        return result(
          satisfies(actual, requirement.op, requirement.value),
          actual,
          `${describe(requirement.op, requirement.value)} from ${requirement.nation}`,
        )
      }

      case 'playersFromClub': {
        const actual = clubs.get(requirement.club) ?? 0
        return result(
          satisfies(actual, requirement.op, requirement.value),
          actual,
          `${describe(requirement.op, requirement.value)} from ${requirement.club}`,
        )
      }

      // The "any ONE entity" family. min asks whether SOME entity reaches the
      // count. max asks whether EVERY entity stays under it. Not the same
      // question, and collapsing them is a real bug source.
      case 'sameLeagueCount':
      case 'sameNationCount':
      case 'sameClubCount': {
        const counts =
          requirement.type === 'sameLeagueCount'
            ? leagues
            : requirement.type === 'sameNationCount'
              ? nations
              : clubs
        const largest = largestGroup(counts)
        return result(
          satisfies(largest, requirement.op, requirement.value),
          largest,
          `${describe(requirement.op, requirement.value)} sharing any one`,
        )
      }

      case 'distinctLeagues':
      case 'distinctNations':
      case 'distinctClubs': {
        const counts =
          requirement.type === 'distinctLeagues'
            ? leagues
            : requirement.type === 'distinctNations'
              ? nations
              : clubs
        return result(
          satisfies(counts.size, requirement.op, requirement.value),
          counts.size,
          describe(requirement.op, requirement.value),
        )
      }

      case 'rareCount': {
        const actual = tally(players, (p) => p.card.type.isRare)
        return result(satisfies(actual, requirement.op, requirement.value), actual, describe(requirement.op, requirement.value))
      }

      case 'totwCount': {
        const actual = tally(players, (p) => p.card.type.isTotw)
        return result(actual >= requirement.value, actual, `min ${requirement.value}`)
      }

      case 'cardTypeCount': {
        const actual = tally(players, (p) => p.card.definition.cardType === requirement.cardType)
        return result(
          satisfies(actual, requirement.op, requirement.value),
          actual,
          `${describe(requirement.op, requirement.value)} ${requirement.cardType}`,
        )
      }

      case 'promoCount': {
        const actual = tally(players, (p) => p.card.definition.promoName === requirement.promoName)
        return result(actual >= requirement.value, actual, `min ${requirement.value} ${requirement.promoName}`)
      }

      case 'qualityCount': {
        const actual = tally(players, (p) => qualityOf(p.card.definition.rating) === requirement.quality)
        return result(
          satisfies(actual, requirement.op, requirement.value),
          actual,
          `${describe(requirement.op, requirement.value)} ${requirement.quality}`,
        )
      }

      case 'minPlayerRating': {
        // count omitted means all eleven. The UI must show which reading was taken,
        // because "all players min 84" and "min 3 players rated 84 or higher" are
        // wildly different asks and the parser cannot always tell them apart.
        const needed = requirement.count ?? players.length
        const meeting = tally(players, (p) => p.card.definition.rating >= requirement.value)
        return result(
          meeting >= needed,
          `${meeting} of ${players.length} at ${requirement.value}+`,
          requirement.count === undefined
            ? `all ${players.length} at ${requirement.value}+`
            : `${needed} at ${requirement.value}+`,
        )
      }

      case 'maxPlayerRating': {
        const highest = ratings.length === 0 ? 0 : Math.max(...ratings)
        return result(highest <= requirement.value, highest, `no player above ${requirement.value}`)
      }

      case 'specificPlayer': {
        const present = players.some((p) => p.card.definition.defId === requirement.defId)
        return result(present, present ? 'present' : 'absent', requirement.defId)
      }

      case 'specificPosition': {
        const actual = tally(players, (p) => p.slotPosition === requirement.position)
        return result(actual >= requirement.value, actual, `min ${requirement.value} at ${requirement.position}`)
      }

      case 'formation':
        return result(squad.formation.name === requirement.value, squad.formation.name, requirement.value)

      case 'excludeEvolved': {
        const evolved = tally(players, (p) => p.card.owned.isEvolved)
        return result(evolved === 0, evolved, 'no evolved players')
      }

      case 'managerNation':
        return result(
          squad.manager?.nation === requirement.nation,
          squad.manager?.nation ?? 'no manager',
          requirement.nation,
        )

      case 'managerLeague':
        return result(
          squad.manager?.league === requirement.league,
          squad.manager?.league ?? 'no manager',
          requirement.league,
        )
    }
  })
}

/**
 * True only when every requirement was CHECKED and passed.
 *
 * An unchecked requirement returns `passed: false`, so a squad carrying one can
 * never pass here. That is the safe direction: the alternative is a squad that
 * looks valid because nobody looked.
 */
export function squadPasses(squad: Squad, requirements: readonly Requirement[]): boolean {
  return validateSquad(squad, requirements).every((r) => r.passed)
}

/** The requirements that could not be checked at all, as opposed to failing. */
export function uncheckedRequirements(
  squad: Squad,
  requirements: readonly Requirement[],
): RequirementResult[] {
  return validateSquad(squad, requirements).filter(
    (result) => typeof result.achieved === 'string' && result.achieved.startsWith('NOT CHECKED'),
  )
}
