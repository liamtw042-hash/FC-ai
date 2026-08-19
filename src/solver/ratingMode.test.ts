import { describe, expect, it } from 'vitest'
import { describeAchievement, ratingTargetsFor } from './ratingMode'
import { DEFAULT_COST_WEIGHTS } from '../types/solver'
import type { Requirement } from '../types/requirements'

const min = (value: number): Requirement => ({ type: 'teamRating', op: 'min', value })
const max = (value: number): Requirement => ({ type: 'teamRating', op: 'max', value })
const exact = (value: number): Requirement => ({ type: 'teamRating', op: 'exact', value })

describe('exact mode, which is the default', () => {
  it('turns a minimum 90 into exactly 90 and nothing else', () => {
    // If the SBC wants 90 I do not want 91. Overshooting wastes coins.
    expect(ratingTargetsFor([min(90)], { mode: 'exact' })).toEqual([
      { target: 90, overshootPenalty: 0, overshootBy: 0 },
    ])
  })

  it('takes the tightest minimum when several are stated', () => {
    expect(ratingTargetsFor([min(84), min(87)], { mode: 'exact' })[0]!.target).toBe(87)
  })
})

describe('minimum mode', () => {
  it('looks above the target but charges for every point of overshoot', () => {
    const targets = ratingTargetsFor([min(88)], { mode: 'minimum', maxOvershoot: 2 })
    expect(targets.map((t) => t.target)).toEqual([88, 89, 90])
    expect(targets.map((t) => t.overshootBy)).toEqual([0, 1, 2])
    expect(targets.map((t) => t.overshootPenalty)).toEqual([
      0,
      DEFAULT_COST_WEIGHTS.overshootPenaltyPerPoint,
      2 * DEFAULT_COST_WEIGHTS.overshootPenaltyPerPoint,
    ])
  })

  it('so an overshooting squad only wins when it is genuinely cheaper', () => {
    const [onTarget, oneOver] = ratingTargetsFor([min(88)], {
      mode: 'minimum',
      maxOvershoot: 1,
      overshootPenaltyPerPoint: 5000,
    })
    // A squad rated 89 costing 4000 less than the 88 still loses, because the
    // penalty is bigger than the saving.
    expect(oneOver!.overshootPenalty).toBe(5000)
    expect(onTarget!.overshootPenalty).toBe(0)
  })

  it('never looks above a stated maximum', () => {
    const targets = ratingTargetsFor([min(85), max(86)], { mode: 'minimum', maxOvershoot: 5 })
    expect(targets.map((t) => t.target)).toEqual([85, 86])
  })
})

describe('an exact requirement is exact in both modes', () => {
  for (const mode of ['exact', 'minimum'] as const) {
    it(`${mode} mode respects teamRating exact`, () => {
      expect(ratingTargetsFor([exact(87)], { mode, maxOvershoot: 5 })).toEqual([
        { target: 87, overshootPenalty: 0, overshootBy: 0 },
      ])
    })
  }
})

describe('no rating requirement', () => {
  it('returns no targets rather than inventing one', () => {
    // The caller then solves without a rating constraint. Guessing a target here
    // would quietly narrow the search for no reason.
    expect(ratingTargetsFor([], { mode: 'exact' })).toEqual([])
    expect(ratingTargetsFor([{ type: 'squadSize', value: 11 }], { mode: 'minimum' })).toEqual([])
  })

  it('a lone maximum is not a target either', () => {
    expect(ratingTargetsFor([max(88)], { mode: 'minimum' })).toEqual([])
  })
})

describe('achieved versus required, always shown for both metrics', () => {
  it('reports the overshoot so overpaying is visible', () => {
    expect(describeAchievement('chemistry', 25, 33)).toEqual({
      label: 'chemistry',
      required: 25,
      achieved: 33,
      overshootBy: 8,
    })
  })

  it('reports zero overshoot when the requirement is met exactly', () => {
    expect(describeAchievement('rating', 88, 88).overshootBy).toBe(0)
  })

  it('handles a metric with no requirement at all', () => {
    expect(describeAchievement('rating', null, 84).overshootBy).toBe(0)
  })
})
