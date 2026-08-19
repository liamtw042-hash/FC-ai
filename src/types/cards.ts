/**
 * Card and club types.
 *
 * Section 2 of the brief, with the changes approved in RESEARCH.md sections
 * 2.1 (chemistry contribution table) and 5.2 (open card type) applied.
 */

/**
 * Canonical card type identifier, keyed off FutDB's card types.
 *
 * DELIBERATELY AN OPEN STRING. See RESEARCH.md 5.2. New promo classes land every
 * fortnight and a closed union would need a code change for each one. Readability
 * comes from the derived helpers in src/rules/cardTypes.ts, not from the type.
 */
export type CardType = string

/**
 * Coarse grouping, derived from the card type registry, for UI and for the
 * common requirement shorthands. Never stored on a card.
 */
export type CardTypeGroup = 'common' | 'rare' | 'totw' | 'icon' | 'hero' | 'promo'

/** Derived from rating, never stored. bronze <= 64, silver 65 to 74, gold >= 75. */
export type Quality = 'bronze' | 'silver' | 'gold'

/** Which pool an owned copy sits in. */
export type Pool = 'club' | 'sbc_storage'

/**
 * How many increments a card contributes to each chemistry threshold count.
 *
 * Replaces the isIcon and isHero booleans from the brief. See RESEARCH.md 2.1.
 * A normal card is {club: 1, league: 1, nation: 1, appliesLeagueToAll: false,
 * alwaysMaxChem: false}, which is the default when a card type is unknown.
 */
export interface ChemistryContribution {
  /** Increments added to the club count. 0 when the card has no club. */
  club: number
  /** Increments added to a league count. */
  league: number
  /** Increments added to the nation count. */
  nation: number
  /** True only for Icons: the league increments apply to EVERY league, not one. */
  appliesLeagueToAll: boolean
  /**
   * True for Icons, Heroes and Festival of Football Captains.
   * Still gated on position: an Icon played out of position is 0, not 3.
   */
  alwaysMaxChem: boolean
}

/**
 * One row of the card type registry.
 *
 * Sourced from the dataset where possible, with a local override file for classes
 * the dataset does not yet cover. See RESEARCH.md 2.1.
 */
export interface CardTypeDefinition {
  id: CardType
  displayName: string
  group: CardTypeGroup
  contribution: ChemistryContribution
  isRare: boolean
  isTotw: boolean
  isIcon: boolean
  isHero: boolean
  /**
   * False when any part of this row is inferred rather than read off the game.
   *
   * Tests prove the code matches the spec. They do not prove the spec matches the
   * game. This flag is how that distinction stays visible: everything false here
   * is listed in the startup warning and has an entry in PENDING.md.
   */
  verified: boolean
  /** Where the numbers came from, in one line. */
  source: string
  /** PENDING.md entry id that would verify this, when verified is false. */
  pendingRef?: string
}

/**
 * An immutable card definition from the player database.
 *
 * One footballer can have many of these. Base gold Saka and a promo Saka are
 * different defIds with different ratings. Disambiguation key is
 * name + rating + cardType + promo.
 */
export interface CardDefinition {
  defId: string
  name: string
  rating: number
  /** All preferred positions, primary first. */
  positions: string[]
  /** Canonical nation id, after alias resolution. */
  nation: string
  /** Canonical league id after alias resolution. null for Icons. */
  league: string | null
  /** Canonical club id after alias resolution. null for Icons and Heroes. */
  club: string | null
  /** Open string, resolved against the card type registry. */
  cardType: CardType
  /** Not derivable from card type, so stored. Drives the club-and-nation-only linking. */
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
  type: CardTypeDefinition
  /** positionOverride when present, otherwise definition.positions. */
  effectivePositions: string[]
}

/**
 * Resolves a raw club, league or nation string to its canonical id.
 *
 * Exists because women's items must club-link to the men's club. If the dataset
 * gives "Arsenal Women" and "Arsenal" as different strings the link silently
 * breaks. See RESEARCH.md 2.2. League needs no exclusion rule: distinct league
 * strings never match, so the women's league rule falls out for free.
 */
export interface AliasTable {
  clubs: Record<string, string>
  leagues: Record<string, string>
  nations: Record<string, string>
}
