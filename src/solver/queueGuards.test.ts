import { describe, expect, it } from 'vitest'
import { MixedSquadSizeError, assertUniformSquadSize, squadSizeOf } from './queueGuards'
import { solverCostOffset } from './costModel'
import { DEFAULT_COST_WEIGHTS } from '../types/solver'
import type { Requirement } from '../types/requirements'

const ELEVEN: Requirement[] = [{ type: 'squadSize', value: 11 }]
// Invented. No real FC 26 SBC has one, and the point is that if one appeared the
// queue is refused rather than quietly mispriced.
const EIGHT: Requirement[] = [{ type: 'squadSize', value: 8 }]

describe('squad size', () => {
  it('defaults to eleven when a challenge does not state one', () => {
    expect(squadSizeOf([{ type: 'teamRating', op: 'min', value: 85 }])).toBe(11)
    expect(squadSizeOf(ELEVEN)).toBe(11)
    expect(squadSizeOf(EIGHT)).toBe(8)
  })
})

describe('a mixed size queue is refused', () => {
  it('accepts a uniform queue', () => {
    expect(() =>
      assertUniformSquadSize([
        { name: 'marquee matchup', requirements: ELEVEN },
        { name: 'league sbc', requirements: [] },
      ]),
    ).not.toThrow()
  })

  it('refuses a queue mixing eleven with anything else, naming only the offenders', () => {
    let thrown: MixedSquadSizeError | null = null
    try {
      assertUniformSquadSize([
        { name: '85 rated squad', requirements: ELEVEN },
        { name: 'invented 8 card challenge', requirements: EIGHT },
      ])
    } catch (error) {
      thrown = error as MixedSquadSizeError
    }
    expect(thrown).toBeInstanceOf(MixedSquadSizeError)
    expect(thrown!.offenders).toEqual([{ name: 'invented 8 card challenge', size: 8 }])
    expect(thrown!.message).toContain('invented 8 card challenge has 8')
    expect(thrown!.message).not.toContain('85 rated squad')
  })

  it('says why, rather than just refusing', () => {
    expect(() =>
      assertUniformSquadSize([{ name: 'odd one', requirements: EIGHT }]),
    ).toThrow(/bias the objective toward the smaller squad/)
  })
})

describe('the bias being avoided is a real quantity', () => {
  it('is the size difference times the offset', () => {
    // Not behaviour, a statement of what would go wrong. On default weights the
    // offset is 150, so an eight card squad would be favoured by 450 for nothing.
    const offset = solverCostOffset(DEFAULT_COST_WEIGHTS)
    expect(offset).toBe(150)
    expect(11 * offset - 8 * offset).toBe(450)
  })
})
