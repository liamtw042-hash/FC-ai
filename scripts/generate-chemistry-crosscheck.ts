/**
 * Generates the cross check fixture that proves the CP-SAT chemistry model agrees
 * with the TypeScript rules engine.
 *
 * The engine computes chemistry for a batch of random squads. The Python tests
 * pin those exact squads into the solver and compare, per player and in total.
 * If the two ever disagree the pytest run fails, which is the whole point: two
 * implementations of a game rule drifting apart is the failure mode this
 * architecture exists to make impossible.
 *
 *   npm run crosscheck:generate
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { calculateChemistry } from '../src/rules/chemistry.ts'
import { defaultCardTypeRegistry } from '../src/rules/cardTypes.ts'
import { getFormation } from '../src/rules/formations.ts'
import { buildChemistryConfig } from '../src/solver/chemistryConfig.ts'
import type { CardDefinition, ResolvedCard } from '../src/types/cards.ts'
import type { Manager, PlacedPlayer } from '../src/types/squad.ts'

const OUT = fileURLToPath(
  new URL('../solver/tests/fixtures/chemistry-crosscheck.json', import.meta.url),
)

const CLUBS: [string, string][] = [
  ['Arsenal', 'Premier League'],
  ['Chelsea', 'Premier League'],
  ['Real Madrid', 'La Liga'],
  ['Barcelona', 'La Liga'],
  ['Juventus', 'Serie A'],
  ['Bayern', 'Bundesliga'],
]
const NATIONS = ['England', 'Spain', 'Brazil', 'France', 'Italy', 'Germany']
const TYPES = ['common', 'rare', 'totw', 'icon', 'hero', 'fof_captain']
const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2']

function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const rand = makeRandom(20260819)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!

interface WireCard {
  id: string
  rating: number
  positions: string[]
  nation: string
  league: string | null
  club: string | null
  card_type: string
  quantity: number
  cost: number
}

function makeCard(index: number, slot: string): { wire: WireCard; resolved: ResolvedCard } {
  const cardType = pick(TYPES)
  const isIcon = cardType === 'icon'
  const isHero = cardType === 'hero'
  const [club, league] = pick(CLUBS)
  // Roughly one card in five is placed somewhere it cannot play, so the
  // positioning gate is exercised on both sides.
  const positions = rand() < 0.2 ? [slot === 'GK' ? 'ST' : 'GK'] : [slot]

  const definition: CardDefinition = {
    defId: `x-${index}`,
    name: `Cross ${index}`,
    rating: 84,
    positions,
    nation: pick(NATIONS),
    league: isIcon ? null : league,
    club: isIcon || isHero ? null : club,
    cardType,
    isWomens: false,
  }
  const resolved: ResolvedCard = {
    owned: {
      id: `x-${index}`,
      defId: definition.defId,
      quantity: 1,
      pool: 'club',
      untradeable: false,
      isLoan: false,
      isEvolved: false,
      locked: false,
      inActiveSquad: false,
      estimatedPrice: null,
    },
    definition,
    type: defaultCardTypeRegistry.get(cardType),
    effectivePositions: definition.positions,
  }
  return {
    wire: {
      id: definition.defId,
      rating: definition.rating,
      positions: definition.positions,
      nation: definition.nation,
      league: definition.league,
      club: definition.club,
      card_type: cardType,
      quantity: 1,
      cost: 1,
    },
    resolved,
  }
}

const cases: unknown[] = []
for (let caseIndex = 0; caseIndex < 300; caseIndex += 1) {
  const formation = getFormation(pick(FORMATIONS))
  const built = formation.slots.map((slot, i) => makeCard(caseIndex * 11 + i, slot))
  const players: PlacedPlayer[] = built.map((b, i) => ({
    card: b.resolved,
    slotIndex: i,
    slotPosition: formation.slots[i]!,
  }))
  const manager: Manager | undefined =
    rand() < 0.3 ? { nation: pick(NATIONS), league: pick(CLUBS)[1] } : undefined
  const result = calculateChemistry(players, manager)

  cases.push({
    id: `cc-${caseIndex}`,
    formation_slots: formation.slots,
    pool: built.map((b) => b.wire),
    pins: built.map((b, i) => ({ card_id: b.wire.id, slot_index: i })),
    manager: manager ?? null,
    expected_squad_chemistry: result.total,
    expected_player_chemistry: result.players.map((p) => p.chemistry),
  })
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    { chemistry_config: buildChemistryConfig(), cases },
    null,
    2,
  )}\n`,
)
console.log(`wrote ${cases.length} cross check cases to ${OUT}`)
