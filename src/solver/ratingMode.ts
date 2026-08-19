/**
 * Do not overshoot. Brief 7.2.
 *
 * If the SBC wants 90, 91 is wasted coins. In exact mode a "minimum 90" is
 * enumerated as exactly 90 and nothing else is considered.
 *
 * Minimum mode allows above target but charges for it, so an overshooting squad
 * only wins when it is genuinely cheaper by more than the penalty. That is a
 * preference expressed in the objective rather than a rule, which is why the
 * penalty is a weight and not a hard bound.
 */

import type { Requirement } from '../types/requirements'
import type { RatingMode } from '../types/solver'
import { DEFAULT_COST_WEIGHTS } from '../types/solver'

export interface RatingTarget {
  /** The exact squad rating to enumerate combinations for. */
  target: number
  /** Added to every solution found at this target, so overshoot has to earn it. */
  overshootPenalty: number
  /** How far above the requirement this target sits. */
  overshootBy: number
}

export interface RatingModeOptions {
  mode: RatingMode
  /** How far above the requirement minimum mode will look. */
  maxOvershoot?: number
  overshootPenaltyPerPoint?: number
}

export const DEFAULT_MAX_OVERSHOOT = 3

/**
 * Turns the rating requirement into the list of exact targets to enumerate.
 *
 * Returns an empty list when there is no rating requirement at all, which means
 * the caller solves without a rating constraint rather than guessing one.
 */
export function ratingTargetsFor(
  requirements: readonly Requirement[],
  options: RatingModeOptions = { mode: 'exact' },
): RatingTarget[] {
  const {
    mode,
    maxOvershoot = DEFAULT_MAX_OVERSHOOT,
    overshootPenaltyPerPoint = DEFAULT_COST_WEIGHTS.overshootPenaltyPerPoint,
  } = options

  let floor: number | null = null
  let ceiling: number | null = null
  let exact: number | null = null

  for (const requirement of requirements) {
    if (requirement.type !== 'teamRating') continue
    if (requirement.op === 'min') floor = Math.max(floor ?? requirement.value, requirement.value)
    else if (requirement.op === 'max') ceiling = Math.min(ceiling ?? requirement.value, requirement.value)
    else exact = requirement.value
  }

  if (exact !== null) {
    // An exact requirement is exact in both modes. Nothing to trade off.
    return [{ target: exact, overshootPenalty: 0, overshootBy: 0 }]
  }
  if (floor === null) {
    // No minimum. A lone maximum still bounds nothing useful for enumeration,
    // so the caller solves without a rating target rather than inventing one.
    return []
  }

  if (mode === 'exact') {
    return [{ target: floor, overshootPenalty: 0, overshootBy: 0 }]
  }

  const highest = ceiling === null ? floor + maxOvershoot : Math.min(floor + maxOvershoot, ceiling)
  const targets: RatingTarget[] = []
  for (let target = floor; target <= highest; target += 1) {
    const overshootBy = target - floor
    targets.push({
      target,
      overshootPenalty: overshootBy * overshootPenaltyPerPoint,
      overshootBy,
    })
  }
  return targets
}

/** Achieved versus required, for the results screen. Always shown, both metrics. */
export interface AchievedVersusRequired {
  label: string
  required: number | null
  achieved: number
  overshootBy: number
}

export function describeAchievement(
  label: string,
  required: number | null,
  achieved: number,
): AchievedVersusRequired {
  return {
    label,
    required,
    achieved,
    overshootBy: required === null ? 0 : Math.max(0, achieved - required),
  }
}
