/**
 * Builds the sample card database and sample club. Deterministic, so the file it
 * writes is reproducible and a diff on it means something.
 *
 * WHY THIS EXISTS. Checkpoint 2, the FutDB loader, is blocked on a key and on the
 * real rate limits, and neither may be invented. Nothing downstream of a card
 * database can be exercised without one, so this builds a synthetic one instead
 * of waiting. It is SYNTHETIC AND SAYS SO: the players are invented, the clubs
 * and leagues are plausible names rather than a copy of the game's, and no row
 * here is evidence about anything in EA FC 26. It exists so the solver, the cost
 * model, the grind planner and the CLI can be run end to end today.
 *
 * Run: npx tsx scripts/generateSampleData.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'data', 'sample')

/** A small deterministic generator. Seeded, so the output never drifts. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    // xorshift32. Plenty for laying out fodder, and it needs no dependency.
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

const random = makeRandom(20260220)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
const between = (low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1))

const LEAGUES: { name: string; clubs: string[] }[] = [
  { name: 'Premier Division', clubs: ['Ashford United', 'Brackley City', 'Comberton', 'Denholm Rovers', 'Eastgate', 'Fairhaven'] },
  { name: 'Liga Primera', clubs: ['Alcazar', 'Bellamar', 'Castellano', 'Duranza', 'Elvira CF', 'Fuentes'] },
  { name: 'Serie Prima', clubs: ['Aterno', 'Boldini', 'Cerveto', 'Doriano', 'Emporia', 'Fiorente'] },
  { name: 'Bundesklasse', clubs: ['Adlerberg', 'Brandhof', 'Coburg SV', 'Dornbach', 'Eichwald', 'Freistadt'] },
  { name: 'Ligue Premiere', clubs: ['Aubertin', 'Beaufort', 'Chalonne', 'Dumarais', 'Estrelle', 'Fontenay'] },
  { name: 'Eredivisie Noord', clubs: ['Aalsmeer', 'Broekhof', 'Cuijkstad', 'Dinxperlo', 'Eemsdijk'] },
  { name: 'Liga Sul', clubs: ['Aracaju FC', 'Barreiro', 'Cascavel', 'Diamantina', 'Estrela'] },
  { name: 'Saudi Elite', clubs: ['Al Farid', 'Al Bahri', 'Al Qamar', 'Al Rakan'] },
]

const NATIONS = [
  'Albion', 'Batavia', 'Caledonia', 'Danmarken', 'Eiretown', 'Francia', 'Germania', 'Hispania',
  'Italica', 'Japonia', 'Koria', 'Lusitania', 'Marokka', 'Norvegia', 'Osteria', 'Polonia',
  'Quebeca', 'Rioverde', 'Senegalia', 'Turkia',
]

const POSITION_GROUPS: string[][] = [
  ['GK'],
  ['CB'], ['CB', 'RB'], ['CB', 'LB'], ['LB', 'LM'], ['RB', 'RM'],
  ['CDM', 'CM'], ['CM'], ['CM', 'CAM'], ['CAM', 'CF'],
  ['LM', 'LW'], ['RM', 'RW'], ['LW', 'ST'], ['RW', 'ST'], ['ST'], ['ST', 'CF'],
]

const FIRST = ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'J.', 'K.', 'L.', 'M.', 'N.', 'P.', 'R.', 'S.', 'T.', 'V.']
const LAST_A = ['Mar', 'Val', 'Ber', 'Sor', 'Kal', 'Ren', 'Dal', 'Fen', 'Gor', 'Lun', 'Tam', 'Vor', 'Han', 'Pel', 'Ras', 'Ost', 'Nur', 'Cav']
const LAST_B = ['tinez', 'sson', 'nardo', 'ley', 'derse', 'ovic', 'gaard', 'aoui', 'escu', 'inho', 'mann', 'ridge', 'kova', 'stad', 'zaki', 'oulos']

/**
 * How many DEFINITIONS at each rating. Weighted like a real club: a wall of
 * fodder in the low eighties and a handful of anything above 86.
 */
const SHAPE: { rating: number; definitions: number; maxQuantity: number }[] = [
  { rating: 88, definitions: 4, maxQuantity: 1 },
  { rating: 87, definitions: 8, maxQuantity: 1 },
  { rating: 86, definitions: 46, maxQuantity: 2 },
  { rating: 85, definitions: 46, maxQuantity: 2 },
  { rating: 84, definitions: 54, maxQuantity: 2 },
  { rating: 83, definitions: 60, maxQuantity: 3 },
  { rating: 82, definitions: 62, maxQuantity: 3 },
  { rating: 81, definitions: 40, maxQuantity: 3 },
  { rating: 80, definitions: 34, maxQuantity: 3 },
  { rating: 79, definitions: 26, maxQuantity: 4 },
  { rating: 78, definitions: 22, maxQuantity: 4 },
  { rating: 77, definitions: 16, maxQuantity: 4 },
  { rating: 76, definitions: 12, maxQuantity: 4 },
  { rating: 75, definitions: 10, maxQuantity: 4 },
]

/**
 * Coins at each rating. INVENTED, like everything else here, but ordered and
 * convex the way a real market is, so the cost model and the grind planner get
 * something with the right shape to reason about.
 */
const PRICE: Record<number, number> = {
  75: 400, 76: 450, 77: 500, 78: 550, 79: 650, 80: 750, 81: 900, 82: 1100,
  83: 1400, 84: 1900, 85: 2700, 86: 4200, 87: 7500, 88: 14000,
}

interface Card {
  defId: string
  name: string
  rating: number
  positions: string[]
  nation: string
  league: string | null
  club: string | null
  cardType: string
  isWomens: boolean
  promoName: string
}

const cards: Card[] = []
const names = new Set<string>()
let serial = 0

function uniqueName(): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = `${pick(FIRST)} ${pick(LAST_A)}${pick(LAST_B)}`
    if (!names.has(candidate)) {
      names.add(candidate)
      return candidate
    }
  }
  // Falls back to a numbered name rather than colliding silently.
  const candidate = `${pick(FIRST)} Player${serial}`
  names.add(candidate)
  return candidate
}

for (const band of SHAPE) {
  for (let index = 0; index < band.definitions; index += 1) {
    serial += 1
    const league = pick(LEAGUES)
    // A handful of TOTW cards in the fodder band, so totwCount requirements have
    // something to bite on. Everything else is a plain rare or common.
    const totw = band.rating >= 82 && random() < 0.06
    const womens = random() < 0.12
    cards.push({
      defId: `s${String(serial).padStart(4, '0')}`,
      name: uniqueName(),
      rating: band.rating,
      positions: pick(POSITION_GROUPS),
      nation: pick(NATIONS),
      league: league.name,
      club: pick(league.clubs),
      cardType: totw ? 'totw' : band.rating >= 75 ? 'rare' : 'common',
      isWomens: womens,
      promoName: '',
    })
  }
}

// A few Icons, which have no club and no league. They are here so the chemistry
// contribution table and the null club handling get exercised by real rows.
const ICONS = ['Baggiotti', 'Cruyffsen', 'Eusebiu', 'Garrinho', 'Hagiescu']
for (const surname of ICONS) {
  serial += 1
  cards.push({
    defId: `s${String(serial).padStart(4, '0')}`,
    name: `${pick(FIRST)} ${surname}`,
    rating: between(86, 91),
    positions: pick(POSITION_GROUPS.filter((group) => group[0] !== 'GK')),
    nation: pick(NATIONS),
    league: null,
    club: null,
    cardType: 'icon',
    isWomens: false,
    promoName: '',
  })
}

const quantityOf = new Map<string, number>()
for (const card of cards) {
  const band = SHAPE.find((entry) => entry.rating === card.rating)
  const cap = card.cardType === 'icon' ? 1 : (band?.maxQuantity ?? 1)
  quantityOf.set(card.defId, between(1, cap))
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function csv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

mkdirSync(OUT, { recursive: true })

writeFileSync(
  resolve(OUT, 'cards.csv'),
  csv(
    ['defId', 'name', 'rating', 'positions', 'nation', 'league', 'club', 'cardType', 'isWomens', 'promoName'],
    cards.map((card) => [
      card.defId, card.name, String(card.rating), card.positions.join('|'),
      card.nation, card.league ?? '', card.club ?? '', card.cardType,
      card.isWomens ? 'yes' : 'no', card.promoName,
    ]),
  ),
)

/**
 * The club. Deliberately IMPERFECT: the untradeable pass covers most of it, the
 * loan pass covers all of it, and nobody ran a locked pass. That is what a real
 * intake looks like and it is what makes the coverage report say something.
 */
writeFileSync(
  resolve(OUT, 'club.csv'),
  csv(
    ['defId', 'quantity', 'pool', 'untradeable', 'isLoan', 'isEvolved', 'locked', 'inActiveSquad', 'estimatedPrice', 'positionOverride', 'squadName', 'favourite', 'observed'],
    cards.map((card, index) => {
      const untradeableSeen = index % 5 !== 0
      const untradeable = untradeableSeen && random() < 0.25
      const inSquad = card.rating >= 86 && random() < 0.25
      const observed = ['isLoan', 'inActiveSquad']
      if (untradeableSeen) observed.unshift('untradeable')
      return [
        card.defId,
        String(quantityOf.get(card.defId) ?? 1),
        'club',
        untradeable ? 'yes' : 'no',
        'no',
        'no',
        'no',
        inSquad ? 'yes' : 'no',
        String(PRICE[card.rating] ?? 0),
        '',
        inSquad ? 'Starting XI' : '',
        '',
        observed.join('|'),
      ]
    }),
  ),
)

writeFileSync(
  resolve(OUT, 'prices.json'),
  JSON.stringify(
    {
      note: 'SYNTHETIC. Invented prices for the sample club, not observed in any market.',
      lastUpdated: '2026-02-20',
      entries: Object.entries(PRICE).map(([rating, coins]) => ({
        rating: Number(rating),
        coins,
      })),
    },
    null,
    2,
  ) + '\n',
)

const total = cards.reduce((sum, card) => sum + (quantityOf.get(card.defId) ?? 1), 0)
console.log(`${cards.length} card definitions, ${total} cards in the club, written to data/sample`)
