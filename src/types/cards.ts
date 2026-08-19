/**
 * Card and club types.
 *
 * These are the Section 2 definitions from the brief, implemented as written.
 * Proposed changes to Rarity and to the chemistry contribution model are recorded
 * in RESEARCH.md sections 2.1 and 5.2 and have deliberately NOT been applied here.
 */

/**
 * Coarse card class. See RESEARCH.md 5.2: this collapses every promo into one
 * value, which cardTypeCount cannot express meaningfully. Awaiting a decision.
 */
export type Rarity = 'common' | 'rare' | 'totw' | 'icon' | 'hero' | 'promo'

/** Derived from rating, never stored. bronze <= 64, silver 65 to 74, gold >= 75. */
export type Quality = 'bronze' | 'silver' | 'gold'

/** Which pool an owned copy sits in. */
export type Pool = 'club' | 'sbc_storage'

/**
 * An immutable card definition from the player database.
 *
 * One footballer can have many of these. Base gold Saka and a promo Saka are
 * different defIds with different ratings. Disambiguation key is
 * name + rating + rarity + promo.
 */
export interface CardDefinition {
  defId: string
  name: string
  rating: number
  /** All preferred positions, primary first. */
  positions: string[]
  nation: string
  /** null for Icons. */
  league: string | null
  /** null for Icons and Heroes. */
  club: string | null
  rarity: Rarity
  isRare: boolean
  isTotw: boolean
  isIcon: boolean
  isHero: boolean
  isWomens: boolean
  /** 'FUTTIES', 'TOTS', and so on. */
  promoName?: string
}

/**
 * An actual copy in my club.
 *
 * A row is a STACK, not a single item. quantity copies are quantity separate
 * submittable items. The solver models usage as an integer bounded by quantity,
 * never as a boolean. See RESEARCH.md 5.3.
 */
export interface OwnedCard {
  id: string
  defId: string
  /** Duplicates collapse into one row. This row can be submitted quantity times. */
  quantity: number
  pool: Pool
  /** Affects cost only. Has no effect on SBC eligibility. */
  untradeable: boolean
  /** Loans can never be submitted to an SBC. Filtered at load, not at solve. */
  isLoan: boolean
  isEvolved: boolean
  /** Set when a position modifier has been applied to this copy. */
  positionOverride?: string[]
  locked: boolean
  /** A player in an active squad cannot be submitted. Filtered at load. */
  inActiveSquad: boolean
  squadName?: string
  estimatedPrice: number | null
}

/** An owned stack joined to its definition, which is what the solver consumes. */
export interface ResolvedCard {
  owned: OwnedCard
  definition: CardDefinition
  /** positionOverride when present, otherwise definition.positions. */
  effectivePositions: string[]
}
