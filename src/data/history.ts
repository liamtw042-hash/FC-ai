/**
 * What I submitted, and the fodder ledger. Brief section 9, History.
 *
 * Two questions, and they are not the same question:
 *
 *   "What did I complete, when, and what did it cost me?"      the submissions
 *   "Where did my fodder go?"                                  the ledger
 *
 * COINS SPENT AND VALUE BURNED ARE NEVER ADDED TOGETHER, here least of all. A
 * month of SBCs that cost nothing in coins and destroyed two million in sellable
 * fodder is a real thing that happens, and a single "total spent" figure would
 * make it invisible.
 *
 * Marking a submission also REMOVES the cards from the club, because the cards
 * are gone. That is the one place in this tool where a report writes back.
 */

import type { OwnedCard } from '../types/cards'

export interface LedgerEntry {
  /** The owned stack id, so a duplicate stack is not confused with another copy. */
  cardId: string
  defId: string
  name: string
  rating: number
  /** How many copies of this stack went in. */
  quantity: number
  /**
   * FOR ALL `quantity` COPIES, not per copy. Per copy figures and stack figures
   * look identical in a JSON file and differ by a factor of four in a ledger, so
   * this says which it is rather than leaving it to be inferred.
   */
  coinsSpent: number
  valueBurned: number
}

export interface Submission {
  id: string
  sbcName: string
  /** ISO 8601. Supplied by the caller so this file has no clock in it. */
  submittedAt: string
  squadCount: number
  coinsSpent: number
  valueBurned: number
  reward?: string
  fodder: LedgerEntry[]
}

export interface History {
  submissions: Submission[]
}

export const EMPTY_HISTORY: History = { submissions: [] }

export interface SubmissionTotals {
  submissions: number
  squads: number
  coinsSpent: number
  valueBurned: number
  cardsBurned: number
}

export function totals(history: History): SubmissionTotals {
  return history.submissions.reduce<SubmissionTotals>(
    (running, submission) => ({
      submissions: running.submissions + 1,
      squads: running.squads + submission.squadCount,
      coinsSpent: running.coinsSpent + submission.coinsSpent,
      valueBurned: running.valueBurned + submission.valueBurned,
      cardsBurned:
        running.cardsBurned +
        submission.fodder.reduce((sum, entry) => sum + entry.quantity, 0),
    }),
    { submissions: 0, squads: 0, coinsSpent: 0, valueBurned: 0, cardsBurned: 0 },
  )
}

export class NotEnoughCopiesError extends Error {}

/**
 * Take the submitted cards out of the club.
 *
 * REFUSES rather than clamping. Asking to consume three copies of a stack that
 * holds two means the caller's idea of the club and the club itself have already
 * diverged, and silently taking two would hide that. Returns a NEW club: nothing
 * here mutates what it was given.
 */
export function consume(club: readonly OwnedCard[], fodder: readonly LedgerEntry[]): OwnedCard[] {
  const remaining = new Map(club.map((card) => [card.id, { ...card }]))
  for (const entry of fodder) {
    const card = remaining.get(entry.cardId)
    if (card === undefined) {
      throw new NotEnoughCopiesError(
        `${entry.name} (${entry.cardId}) is not in the club, so it cannot be submitted`,
      )
    }
    if (card.quantity < entry.quantity) {
      throw new NotEnoughCopiesError(
        `the club holds ${card.quantity} of ${entry.name} (${entry.cardId}) and the ` +
          `submission uses ${entry.quantity}`,
      )
    }
    card.quantity -= entry.quantity
  }
  return [...remaining.values()].filter((card) => card.quantity > 0)
}

export function record(history: History, submission: Submission): History {
  if (history.submissions.some((existing) => existing.id === submission.id)) {
    throw new Error(`submission ${submission.id} is already recorded`)
  }
  return { submissions: [...history.submissions, submission] }
}

/** Where the fodder went, by rating, newest first. */
export function ledgerByRating(history: History): { rating: number; cards: number; valueBurned: number }[] {
  const byRating = new Map<number, { cards: number; valueBurned: number }>()
  for (const submission of history.submissions) {
    for (const entry of submission.fodder) {
      const current = byRating.get(entry.rating) ?? { cards: 0, valueBurned: 0 }
      byRating.set(entry.rating, {
        cards: current.cards + entry.quantity,
        valueBurned: current.valueBurned + entry.valueBurned,
      })
    }
  }
  return [...byRating.entries()]
    .map(([rating, totalsForRating]) => ({ rating, ...totalsForRating }))
    .sort((a, b) => b.rating - a.rating)
}
