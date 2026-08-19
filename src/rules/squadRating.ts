/**
 * Squad rating. Section 4.1 of the brief.
 *
 * Pure TypeScript, zero dependencies.
 *
 *   1. SUM = sum of the 11 ratings
 *   2. AR  = SUM / 11                                (do NOT round)
 *   3. CF  = sum over players of max(0, rating - AR) (do NOT round)
 *   4. T   = round(SUM + CF)                         (nearest integer)
 *   5. RATING = floor(T / 11)
 *
 * Step 5 is floor. See RESEARCH.md 4.1: none of the brief's four test vectors
 * reach past the .5 boundary, so fixture gt-001-floor-vs-round exists to settle it
 * against the real game. Until that fixture is verified this is documented
 * behaviour, not observed behaviour.
 */

export const SQUAD_SIZE = 11

export class InvalidSquadSizeError extends Error {
  constructor(actual: number) {
    super(`A squad rating needs exactly ${SQUAD_SIZE} ratings, got ${actual}`)
    this.name = 'InvalidSquadSizeError'
  }
}

/**
 * The literal transcription of the five steps above, in floating point.
 *
 * Kept because it is the spec written out, and because it is what the property
 * test in the suite checks the exact implementation against. Do not call this in
 * application code: near a rounding boundary the accumulated error in step 3 can
 * flip step 4. Call calculateSquadRating instead.
 */
export function calculateSquadRatingReference(ratings: readonly number[]): number {
  if (ratings.length !== SQUAD_SIZE) throw new InvalidSquadSizeError(ratings.length)

  const sum = ratings.reduce((a, b) => a + b, 0)
  const averageRating = sum / SQUAD_SIZE
  let correctionFactor = 0
  for (const rating of ratings) {
    correctionFactor += Math.max(0, rating - averageRating)
  }
  const total = Math.round(sum + correctionFactor)
  return Math.floor(total / SQUAD_SIZE)
}

/**
 * Squad rating, computed in exact integer arithmetic.
 *
 * Same five steps, no floating point anywhere, so no rounding boundary can be
 * flipped by accumulated error. The algebra:
 *
 *   A = sum of the ratings strictly above the average
 *   k = how many those are
 *   "r is above the average" is r > SUM/11, which is exactly 11*r > SUM
 *
 *   SUM + CF = SUM + A - k*SUM/11
 *   11*(SUM + CF) = 11*SUM + 11*A - k*SUM   <- an integer, call it N
 *   T = round(N / 11), ties away from zero, which for positive N is
 *       floor((2N + 11) / 22)
 *   RATING = floor(T / 11)
 */
export function calculateSquadRating(ratings: readonly number[]): number {
  if (ratings.length !== SQUAD_SIZE) throw new InvalidSquadSizeError(ratings.length)

  let sum = 0
  for (const rating of ratings) sum += rating

  // Step 3, without ever materialising the fractional average.
  let aboveSum = 0
  let aboveCount = 0
  for (const rating of ratings) {
    if (rating * SQUAD_SIZE > sum) {
      aboveSum += rating
      aboveCount += 1
    }
  }

  // Step 4. n is 11 * (SUM + CF) and is exactly an integer.
  const n = SQUAD_SIZE * sum + SQUAD_SIZE * aboveSum - aboveCount * sum
  const total = Math.floor((2 * n + SQUAD_SIZE) / (2 * SQUAD_SIZE))

  // Step 5.
  return Math.floor(total / SQUAD_SIZE)
}

/** Intermediate values, for explaining a rating in the UI and for debugging. */
export interface SquadRatingBreakdown {
  sum: number
  averageRating: number
  correctionFactor: number
  total: number
  rating: number
}

export function explainSquadRating(ratings: readonly number[]): SquadRatingBreakdown {
  if (ratings.length !== SQUAD_SIZE) throw new InvalidSquadSizeError(ratings.length)

  const sum = ratings.reduce((a, b) => a + b, 0)
  const averageRating = sum / SQUAD_SIZE
  const correctionFactor = ratings.reduce((a, r) => a + Math.max(0, r - averageRating), 0)
  const rating = calculateSquadRating(ratings)
  return {
    sum,
    averageRating,
    correctionFactor,
    total: Math.round(sum + correctionFactor),
    rating,
  }
}
