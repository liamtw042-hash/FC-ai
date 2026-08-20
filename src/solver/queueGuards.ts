/**
 * Guards the TypeScript orchestrator applies before a queue reaches the solver.
 *
 * The cost offset that keeps the solver objective non negative is order neutral
 * only while every squad is the same size: an eight card squad shifts by
 * 8 * offset and an eleven card squad by 11 * offset, so the smaller one is
 * favoured by the difference for a reason unrelated to cost.
 *
 * Subtracting each squad's own shift does not rescue it, because that recovers
 * the raw weighted cost, which is the negative quantity the offset removed. No
 * additive correction fixes both ends, so a mixed size queue is refused here as
 * well as in the solver. Two guards rather than one, because this one produces a
 * better message and the other one cannot be bypassed.
 */

import { SQUAD_SIZE } from '../rules/squadRating'
import type { Requirement } from '../types/requirements'

export interface QueuedChallenge {
  name: string
  requirements: readonly Requirement[]
}

export class MixedSquadSizeError extends Error {
  constructor(
    message: string,
    readonly offenders: { name: string; size: number }[],
  ) {
    super(message)
    this.name = 'MixedSquadSizeError'
  }
}

export class ConflictingSquadSizeError extends Error {
  constructor(readonly sizes: number[]) {
    super(
      `this challenge states more than one squad size: ${sizes.join(', ')}. Taking the ` +
        `first would silently drop the others, and one of them is what the game will ` +
        `actually enforce.`,
    )
    this.name = 'ConflictingSquadSizeError'
  }
}

/**
 * The squad size a challenge states, or the default when it states none.
 *
 * REFUSES a challenge that states two DIFFERENT sizes. Taking the first match is
 * the reflex, and it is wrong here: the second requirement is real, it came from
 * the same SBC, and dropping it means solving a challenge the game will reject.
 * Two requirements stating the SAME size are a harmless duplicate and pass.
 */
export function squadSizeOf(requirements: readonly Requirement[]): number {
  const stated = requirements.filter((r) => r.type === 'squadSize').map((r) => r.value)
  const distinct = [...new Set(stated)]
  if (distinct.length > 1) throw new ConflictingSquadSizeError(distinct)
  return distinct[0] ?? SQUAD_SIZE
}

export function assertUniformSquadSize(challenges: readonly QueuedChallenge[]): void {
  const offenders = challenges
    .map((challenge) => ({ name: challenge.name, size: squadSizeOf(challenge.requirements) }))
    .filter((entry) => entry.size !== SQUAD_SIZE)
  if (offenders.length === 0) return

  const detail = offenders.map((o) => `${o.name} has ${o.size}`).join(', ')
  throw new MixedSquadSizeError(
    `every challenge in a queue must be a ${SQUAD_SIZE} card squad, but ${detail}. ` +
      `Solving a mixed size queue would bias the objective toward the smaller squad ` +
      `by the difference in their cost offsets, for reasons unrelated to cost.`,
    offenders,
  )
}
