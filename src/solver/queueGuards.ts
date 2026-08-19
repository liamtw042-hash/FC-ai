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

export function squadSizeOf(requirements: readonly Requirement[]): number {
  const stated = requirements.find((r) => r.type === 'squadSize')
  return stated === undefined ? SQUAD_SIZE : stated.value
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
