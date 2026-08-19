/**
 * Test factories. Building an 11 card squad by hand is 200 lines of noise that
 * hides what a test is actually asserting, so it lives here instead.
 */

import type { CardDefinition, OwnedCard, ResolvedCard } from '../../src/types/cards'
import type { PlacedPlayer } from '../../src/types/squad'
import { defaultCardTypeRegistry, type CardTypeRegistry } from '../../src/rules/cardTypes'

let counter = 0

export interface CardSpec {
  name?: string
  rating?: number
  positions?: string[]
  nation?: string
  league?: string | null
  club?: string | null
  cardType?: string
  isWomens?: boolean
  promoName?: string
}

export function cardDefinition(spec: CardSpec = {}): CardDefinition {
  counter += 1
  const base: CardDefinition = {
    defId: `def-${counter}`,
    name: spec.name ?? `Player ${counter}`,
    rating: spec.rating ?? 84,
    positions: spec.positions ?? ['CM'],
    nation: spec.nation ?? `Nation ${counter}`,
    league: spec.league === undefined ? `League ${counter}` : spec.league,
    club: spec.club === undefined ? `Club ${counter}` : spec.club,
    cardType: spec.cardType ?? 'rare',
    isWomens: spec.isWomens ?? false,
  }
  return spec.promoName === undefined ? base : { ...base, promoName: spec.promoName }
}

export function ownedCard(defId: string, overrides: Partial<OwnedCard> = {}): OwnedCard {
  return {
    id: `owned-${defId}`,
    defId,
    quantity: 1,
    pool: 'club',
    untradeable: false,
    isLoan: false,
    isEvolved: false,
    locked: false,
    inActiveSquad: false,
    estimatedPrice: null,
    ...overrides,
  }
}

export function resolvedCard(
  spec: CardSpec = {},
  registry: CardTypeRegistry = defaultCardTypeRegistry,
): ResolvedCard {
  const definition = cardDefinition(spec)
  return {
    owned: ownedCard(definition.defId),
    definition,
    type: registry.get(definition.cardType),
    effectivePositions: definition.positions,
  }
}

/** Place cards into slots. slotPositions defaults to each card's primary position. */
export function placeAll(
  cards: readonly ResolvedCard[],
  slotPositions?: readonly string[],
): PlacedPlayer[] {
  return cards.map((card, index) => ({
    card,
    slotIndex: index,
    slotPosition: slotPositions?.[index] ?? card.effectivePositions[0]!,
  }))
}

/** A squad of n cards that share nothing at all, so every link count is 1. */
export function unlinkedSquad(
  n: number,
  spec: CardSpec = {},
  registry: CardTypeRegistry = defaultCardTypeRegistry,
): ResolvedCard[] {
  return Array.from({ length: n }, () => resolvedCard(spec, registry))
}

export function resetFactoryCounter(): void {
  counter = 0
}
