/**
 * The card type registry.
 *
 * One place describes what a card class is and how much it contributes to each
 * chemistry threshold. Replaces the isIcon and isHero booleans from brief 4.2.
 * See RESEARCH.md 2.1 and 5.2.
 *
 * Adding a new promo class is a data edit here or in the override file, never a
 * code change. That matters: Festival of Football Captains already exist and do
 * not fit the two boolean model, and there will be another class this cycle.
 */

import type {
  CardType,
  CardTypeDefinition,
  CardTypeGroup,
  ChemistryContribution,
} from '../types/cards'

/** What an ordinary card does: one increment to each of its own three entities. */
export const DEFAULT_CONTRIBUTION: ChemistryContribution = {
  club: 1,
  league: 1,
  nation: 1,
  appliesLeagueToAll: false,
  alwaysMaxChem: false,
}

interface DefineOptions {
  contribution?: Partial<ChemistryContribution>
  verified?: boolean
  source?: string
  pendingRef?: string
}

function define(
  id: CardType,
  displayName: string,
  group: CardTypeGroup,
  options: DefineOptions = {},
): CardTypeDefinition {
  const base: CardTypeDefinition = {
    id,
    displayName,
    group,
    contribution: { ...DEFAULT_CONTRIBUTION, ...options.contribution },
    isRare: group !== 'common',
    isTotw: group === 'totw',
    isIcon: group === 'icon',
    isHero: group === 'hero',
    verified: options.verified ?? false,
    source: options.source ?? 'Unknown card type, defaulted to ordinary card behaviour.',
  }
  return options.pendingRef === undefined ? base : { ...base, pendingRef: options.pendingRef }
}

/**
 * Built in card types.
 *
 * The Icon and Hero rows reproduce brief 4.2 exactly:
 *   Icons contribute 2 increments to their nation and 1 to EVERY league.
 *   Heroes contribute 1 to their nation and 2 to their league.
 *   Both always sit at 3 chemistry when in a preferred position.
 * Icons have no club and no league, Heroes have no club, so their club weight is
 * 0 and the null entity is skipped by the counter regardless.
 */
const CONFIRMED = 'Confirmed across multiple independent FC 26 chemistry references.'

export const BUILT_IN_CARD_TYPES: CardTypeDefinition[] = [
  define('common', 'Common', 'common', { verified: true, source: CONFIRMED }),
  define('rare', 'Rare', 'rare', { verified: true, source: CONFIRMED }),
  define('totw', 'Team of the Week', 'totw', { verified: true, source: CONFIRMED }),
  define('icon', 'Icon', 'icon', {
    contribution: {
      club: 0,
      league: 1,
      nation: 2,
      appliesLeagueToAll: true,
      alwaysMaxChem: true,
    },
    verified: true,
    source: CONFIRMED + ' 2 increments to nation, 1 to every league, always 3 in position.',
  }),
  define('hero', 'Hero', 'hero', {
    contribution: { club: 0, league: 2, nation: 1, alwaysMaxChem: true },
    verified: true,
    source: CONFIRMED + ' 1 increment to nation, 2 to league, always 3 in position.',
  }),
  /**
   * Festival of Football Captains. FC 26, 44 items at launch.
   * Three nation links, one club link, one league link.
   *
   * PARTLY INFERRED. The 3/1/1 contribution comes from published write ups.
   * alwaysMaxChem is inferred by analogy with Icons and Heroes, from the claim
   * that Captains are inherently 3 chemistry. Nobody has confirmed a Captain
   * sitting at 3 with no supporting links. See PENDING.md P-002.
   */
  define('fof_captain', 'Festival of Football Captain', 'promo', {
    contribution: { club: 1, league: 1, nation: 3, alwaysMaxChem: true },
    verified: false,
    source:
      '3 nation, 1 club, 1 league from published write ups. alwaysMaxChem INFERRED by ' +
      'analogy with Icons and Heroes, never observed in game.',
    pendingRef: 'P-002',
  }),
]

export class CardTypeRegistry {
  private readonly byId: Map<CardType, CardTypeDefinition>

  constructor(definitions: readonly CardTypeDefinition[]) {
    this.byId = new Map(definitions.map((d) => [d.id, d]))
  }

  /**
   * Unknown card types resolve to an ordinary card rather than throwing.
   *
   * A dataset refresh that introduces a class we have not described yet must not
   * take the solver down. It is wrong quietly, which is why unknown() exists and
   * why the loader's coverage report names every unmapped type it saw.
   */
  get(id: CardType): CardTypeDefinition {
    return this.byId.get(id) ?? define(id, id, 'promo')
  }

  /** Rows carrying any inferred value. Feeds the startup warning. */
  unverified(): CardTypeDefinition[] {
    return this.list().filter((d) => !d.verified)
  }

  has(id: CardType): boolean {
    return this.byId.has(id)
  }

  /** Card types present in the data that the registry does not describe. */
  unknown(idsSeen: Iterable<CardType>): CardType[] {
    const missing = new Set<CardType>()
    for (const id of idsSeen) if (!this.byId.has(id)) missing.add(id)
    return [...missing].sort()
  }

  list(): CardTypeDefinition[] {
    return [...this.byId.values()]
  }
}

/**
 * Built in types plus a local override file, later entries winning.
 *
 * The override file is how a class the dataset does not cover gets described
 * without waiting on a dataset refresh.
 */
export function createCardTypeRegistry(
  overrides: readonly CardTypeDefinition[] = [],
): CardTypeRegistry {
  const merged = new Map<CardType, CardTypeDefinition>()
  for (const d of BUILT_IN_CARD_TYPES) merged.set(d.id, d)
  for (const d of overrides) merged.set(d.id, d)
  return new CardTypeRegistry([...merged.values()])
}

export const defaultCardTypeRegistry = createCardTypeRegistry()
