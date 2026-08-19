/**
 * Quality bands, derived from rating and never stored. Brief 4.4.
 *
 * Rare is orthogonal to quality. "11 rare gold" is two separate constraints, a
 * qualityCount and a rareCount, not one compound thing.
 */

import type { Quality } from '../types/cards'

export function qualityOf(rating: number): Quality {
  if (rating <= 64) return 'bronze'
  if (rating <= 74) return 'silver'
  return 'gold'
}
