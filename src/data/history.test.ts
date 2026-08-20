import { describe, expect, it } from 'vitest'
import type { OwnedCard } from '../types/cards'
import {
  EMPTY_HISTORY,
  NotEnoughCopiesError,
  consume,
  ledgerByRating,
  record,
  totals,
  type LedgerEntry,
  type Submission,
} from './history'

function owned(id: string, quantity: number): OwnedCard {
  return {
    id,
    defId: `d${id}`,
    quantity,
    pool: 'club',
    untradeable: false,
    isLoan: false,
    isEvolved: false,
    locked: false,
    inActiveSquad: false,
    estimatedPrice: 1000,
  }
}

/** `each` is per copy. The ledger stores the total, so this multiplies it out. */
function entry(cardId: string, quantity: number, rating = 84, each = 1000): LedgerEntry {
  return {
    cardId,
    defId: `d${cardId}`,
    name: cardId,
    rating,
    quantity,
    coinsSpent: 0,
    valueBurned: each * quantity,
  }
}

function submission(id: string, fodder: LedgerEntry[], overrides: Partial<Submission> = {}): Submission {
  return {
    id,
    sbcName: 'eighty five',
    submittedAt: '2026-02-20T19:00:00Z',
    squadCount: 1,
    coinsSpent: 0,
    valueBurned: fodder.reduce((sum, item) => sum + item.valueBurned, 0),
    fodder,
    ...overrides,
  }
}

describe('consume', () => {
  it('takes the submitted copies out of the club', () => {
    const club = consume([owned('a', 3), owned('b', 1)], [entry('a', 2)])
    expect(club.find((card) => card.id === 'a')?.quantity).toBe(1)
    expect(club.find((card) => card.id === 'b')?.quantity).toBe(1)
  })

  it('drops a stack that reaches zero', () => {
    expect(consume([owned('a', 1)], [entry('a', 1)])).toEqual([])
  })

  it('does not mutate the club it was given', () => {
    const club = [owned('a', 3)]
    consume(club, [entry('a', 2)])
    expect(club[0]?.quantity).toBe(3)
  })

  // Clamping would hide a club that has already diverged from what the tool
  // thinks it holds, which is the one thing this write back must not do.
  it('REFUSES to consume more copies than the club holds', () => {
    expect(() => consume([owned('a', 2)], [entry('a', 3)])).toThrow(NotEnoughCopiesError)
    expect(() => consume([owned('a', 2)], [entry('a', 3)])).toThrow(/holds 2 .* uses 3/)
  })

  it('refuses a card that is not in the club at all', () => {
    expect(() => consume([owned('a', 2)], [entry('ghost', 1)])).toThrow(/not in the club/)
  })
})

describe('record', () => {
  it('appends without touching what was there', () => {
    const first = record(EMPTY_HISTORY, submission('s1', [entry('a', 1)]))
    const second = record(first, submission('s2', [entry('b', 1)]))
    expect(second.submissions.map((item) => item.id)).toEqual(['s1', 's2'])
    expect(first.submissions).toHaveLength(1)
  })

  it('refuses the same submission twice, because that would double the ledger', () => {
    const first = record(EMPTY_HISTORY, submission('s1', [entry('a', 1)]))
    expect(() => record(first, submission('s1', [entry('a', 1)]))).toThrow(/already recorded/)
  })
})

describe('totals', () => {
  // The distinction the whole ledger exists for.
  it('keeps coins spent and value burned apart', () => {
    const history = record(
      EMPTY_HISTORY,
      submission('s1', [entry('a', 4, 84, 1900)], { coinsSpent: 0 }),
    )
    const result = totals(history)
    expect(result.coinsSpent).toBe(0)
    expect(result.valueBurned).toBe(7600)
    expect(result.cardsBurned).toBe(4)
  })

  it('counts squads as well as submissions, because a repeat is one of each', () => {
    const history = record(EMPTY_HISTORY, submission('s1', [entry('a', 11)], { squadCount: 10 }))
    expect(totals(history)).toMatchObject({ submissions: 1, squads: 10 })
  })
})

describe('ledgerByRating', () => {
  it('says where the fodder went, dearest rating first', () => {
    const history = record(
      record(EMPTY_HISTORY, submission('s1', [entry('a', 2, 86, 4200), entry('b', 3, 83, 1400)])),
      submission('s2', [entry('c', 1, 86, 4200)]),
    )
    expect(ledgerByRating(history)).toEqual([
      { rating: 86, cards: 3, valueBurned: 12600 },
      { rating: 83, cards: 3, valueBurned: 4200 },
    ])
    // 2 + 1 cards at 4200 each, and 3 at 1400 each. The ledger stores stack
    // totals, so these are 3 x 4200 and 3 x 1400.
  })

  it('is empty for an empty history rather than throwing', () => {
    expect(ledgerByRating(EMPTY_HISTORY)).toEqual([])
  })
})
