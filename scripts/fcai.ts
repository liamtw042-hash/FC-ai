/**
 * The FC-ai command line. Import a club, look at it, define an SBC, solve it.
 *
 * This is the whole tool without a browser. The UI at checkpoint 14 calls the
 * same solver endpoints and the same rules engine; nothing here is a second
 * implementation of anything.
 *
 * NOTHING IN THIS FILE TALKS TO EA. It reads CSV files the user exported or
 * typed, and it posts to a solver on 127.0.0.1. Brief section 1.2.
 *
 *   npx tsx scripts/fcai.ts help
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCardDefinitions } from '../src/data/cardDefinitions'
import { describeCoverage, loadClub } from '../src/data/clubImport'
import { buildPool, supplyAndPrices } from '../src/cli/pool'
import { loadState, saveState, statePath, type ClubState } from '../src/cli/state'
import {
  RequirementSyntaxError,
  listSbcs,
  loadSbc,
  parseRequirement,
  saveSbc,
  type SbcDefinition,
} from '../src/cli/sbc'
import {
  SolverClient,
  SolverRejectedError,
  SolverUnavailableError,
  type WireQueueResponse,
  type WireRepeatResponse,
} from '../src/cli/solverClient'
import { formatDiagnosis, formatRequirements, formatSpend, formatSquad, rebuild } from '../src/cli/report'
import { detectConflicts } from '../src/rules/detectConflicts'
import { getFormation, listFormations } from '../src/rules/formations'
import { formatAvailability } from '../src/rules/exclusions'
import { takeRatingCombinations } from '../src/rules/ratingCombinations'
import { resolveClub } from '../src/cli/pool'
import { buildChemistryConfig } from '../src/solver/chemistryConfig'
import { MAX_COPIES_PER_SQUAD } from '../src/rules/squadRules'
import {
  collectUnverified,
  formatStartupWarning,
  liveItems,
} from '../src/rules/verification'
import { defaultCardTypeRegistry } from '../src/rules/cardTypes'
import type { Requirement } from '../src/types/requirements'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface Options {
  /** Last one wins, which is what a repeated --time should do. */
  flags: Map<string, string>
  /** Every value, in order, for flags meant to be given more than once. */
  repeated: Map<string, string[]>
  positional: string[]
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>()
  const repeated = new Map<string, string[]>()
  const positional: string[] = []
  const record = (name: string, value: string): void => {
    flags.set(name, value)
    repeated.set(name, [...(repeated.get(name) ?? []), value])
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (argument.startsWith('--')) {
      const equals = argument.indexOf('=')
      if (equals > 0) {
        record(argument.slice(2, equals), argument.slice(equals + 1))
      } else {
        const next = argv[index + 1]
        if (next === undefined || next.startsWith('--')) {
          record(argument.slice(2), 'true')
        } else {
          record(argument.slice(2), next)
          index += 1
        }
      }
    } else {
      positional.push(argument)
    }
  }
  return { flags, repeated, positional }
}

const HELP = `FC-ai, a local SBC solver. Nothing here talks to EA.

  import cards <file.csv>          load a card database
  import club <file.csv>           load your club, with provenance
  import prices <file.json>        load the price by rating table
  status                           what is loaded, and how much of it is known
  list [--rating N] [--league L] [--nation N] [--position P] [--limit N]
  sbc list                         the SBCs you have defined
  sbc add <file.json>              copy a definition into your library
  sbc show <name>
  sbc define <name> --formation 4-4-2 [--rating 85] [--repeatable N]
                    [--requirement type:op:value[:key=value] ...]
  solve <name> [--repeat N] [--time SECONDS] [--combinations N]
  queue <file.json> [--time SECONDS]
  formations                       formation names this build knows

Flags that apply everywhere:
  --solver-url http://127.0.0.1:8000
  --timeout MILLISECONDS       0, the default, waits as long as the solve takes
`

async function main(): Promise<number> {
  const { flags, repeated, positional } = parseArgs(process.argv.slice(2))
  const command = positional[0] ?? 'help'
  const client = new SolverClient(flags.get('solver-url'), Number(flags.get('timeout') ?? 0))

  switch (command) {
    case 'help':
      process.stdout.write(HELP)
      return 0
    case 'formations':
      for (const formation of listFormations()) {
        process.stdout.write(`${formation.name}  ${formation.slots.join(' ')}\n`)
      }
      return 0
    case 'import':
      return importCommand(positional.slice(1))
    case 'status':
      return status()
    case 'list':
      return list(flags)
    case 'sbc':
      return sbcCommand(positional.slice(1), flags, repeated.get('requirement') ?? [])
    case 'solve':
      return await solve(positional[1], flags, client)
    case 'queue':
      return await queue(positional[1], flags, client)
    default:
      process.stderr.write(`unknown command ${JSON.stringify(command)}\n\n${HELP}`)
      return 2
  }
}

function importCommand(args: string[]): number {
  const what = args[0]
  const file = args[1]
  if (what === undefined || file === undefined) {
    process.stderr.write('usage: import cards|club|prices <file>\n')
    return 2
  }
  const state = loadState(ROOT)
  const text = readFileSync(resolve(file), 'utf8')

  if (what === 'cards') {
    const result = loadCardDefinitions(text)
    reportErrors(result.errors, file)
    if (result.rows.length === 0) return 1
    state.cards = result.rows
    state.cardsImportedFrom = file
    saveState(ROOT, state)
    process.stdout.write(`${result.rows.length} card definition(s) imported from ${file}\n`)
    if (result.ignoredColumns.length > 0) {
      process.stdout.write(`  columns not used: ${result.ignoredColumns.join(', ')}\n`)
    }
    if (result.errors.length > 0) {
      process.stdout.write(`  ${result.errors.length} row(s) rejected, listed above\n`)
    }
    return 0
  }

  if (what === 'club') {
    const known = new Set(state.cards.map((card) => card.defId))
    const result = loadClub(text, known.size > 0 ? { knownDefIds: known } : {})
    reportErrors(result.errors, file)
    if (result.rows.length === 0) return 1
    state.club = result.rows
    state.clubImportedFrom = file
    saveState(ROOT, state)
    process.stdout.write(`Imported from ${file}\n${describeCoverage(result.coverage)}\n`)
    if (result.unknownDefIds.length > 0) {
      process.stdout.write(
        `  ${result.unknownDefIds.length} defId(s) have no card definition and will NOT be ` +
          `solved with: ${result.unknownDefIds.slice(0, 8).join(', ')}` +
          `${result.unknownDefIds.length > 8 ? ' ...' : ''}\n`,
      )
    }
    return 0
  }

  if (what === 'prices') {
    const parsed = JSON.parse(text) as { entries: { rating: number; coins: number }[] }
    const prices: Record<number, number> = {}
    for (const entry of parsed.entries) prices[entry.rating] = entry.coins
    state.prices = prices
    state.pricesImportedFrom = file
    saveState(ROOT, state)
    process.stdout.write(`${parsed.entries.length} price(s) imported from ${file}\n`)
    return 0
  }

  process.stderr.write(`unknown import target ${JSON.stringify(what)}\n`)
  return 2
}

function reportErrors(errors: readonly { line: number; column?: string | undefined; message: string }[], file: string): void {
  for (const error of errors.slice(0, 25)) {
    process.stderr.write(
      `${file}:${error.line}${error.column === undefined ? '' : ` [${error.column}]`}: ${error.message}\n`,
    )
  }
  if (errors.length > 25) process.stderr.write(`... and ${errors.length - 25} more\n`)
}

function requireState(): ClubState | null {
  const state = loadState(ROOT)
  if (state.cards.length === 0 || state.club.length === 0) {
    process.stderr.write(
      `nothing imported yet. Run:\n` +
        `  npx tsx scripts/fcai.ts import cards data/sample/cards.csv\n` +
        `  npx tsx scripts/fcai.ts import club data/sample/club.csv\n` +
        `  npx tsx scripts/fcai.ts import prices data/sample/prices.json\n`,
    )
    return null
  }
  return state
}

function status(): number {
  const state = loadState(ROOT)
  process.stdout.write(`State file: ${statePath(ROOT)}\n`)
  process.stdout.write(`Cards: ${state.cards.length} definition(s) from ${state.cardsImportedFrom ?? 'nothing yet'}\n`)
  process.stdout.write(`Club: ${state.club.length} stack(s) from ${state.clubImportedFrom ?? 'nothing yet'}\n`)
  process.stdout.write(`Prices: ${Object.keys(state.prices).length} rating(s) from ${state.pricesImportedFrom ?? 'nothing yet'}\n`)

  if (state.cards.length > 0 && state.club.length > 0) {
    const pool = buildPool(state.club, state.cards, { prices: state.prices })
    process.stdout.write(`\n${formatAvailability(pool.availability)}\n`)
    if (pool.missingDefinitions.length > 0) {
      process.stdout.write(
        `${pool.missingDefinitions.length} stack(s) have no card definition and are NOT in the pool\n`,
      )
    }
    if (pool.unpricedRatings.length > 0) {
      process.stdout.write(
        `Ratings with no price: ${pool.unpricedRatings.join(', ')}. No coin figure will be ` +
          `quoted for these, by design\n`,
      )
    }
    const { supply } = supplyAndPrices(pool.cards)
    const ratings = [...supply.entries()].sort((a, b) => b[0] - a[0])
    process.stdout.write(`\nAvailable by rating: ${ratings.map(([r, n]) => `${r}x${n}`).join(' ')}\n`)
  }

  // Anything inferred rather than observed is surfaced here, every run, whether
  // or not it is convenient. Tests prove the code matches the spec; they do not
  // prove the spec matches the game.
  const unverified = collectUnverified(defaultCardTypeRegistry)
  const live = liveItems(unverified)
  process.stdout.write(`\n${formatStartupWarning(unverified)}\n`)
  if (live.length > 0) {
    process.stdout.write(
      `${live.length} rule value(s) could change a returned squad and are NOT verified.\n`,
    )
  }
  return 0
}

function list(flags: Map<string, string>): number {
  const state = requireState()
  if (state === null) return 1
  const { resolved } = resolveClub(state.club, state.cards)
  const rating = flags.get('rating')
  const limit = Number(flags.get('limit') ?? 40)

  const matches = resolved.filter((card) => {
    const definition = card.definition
    if (rating !== undefined && definition.rating !== Number(rating)) return false
    if (flags.has('league') && definition.league !== flags.get('league')) return false
    if (flags.has('nation') && definition.nation !== flags.get('nation')) return false
    if (flags.has('position') && !card.effectivePositions.includes(flags.get('position') ?? '')) {
      return false
    }
    if (flags.has('name')) {
      const needle = (flags.get('name') ?? '').toLowerCase()
      if (!definition.name.toLowerCase().includes(needle)) return false
    }
    return true
  })

  matches.sort((a, b) => b.definition.rating - a.definition.rating)
  for (const card of matches.slice(0, limit)) {
    const definition = card.definition
    process.stdout.write(
      `${String(definition.rating).padStart(2)} ${definition.name.padEnd(20)} ` +
        `${card.effectivePositions.join('/').padEnd(8)} ${(definition.club ?? '-').padEnd(16)} ` +
        `${(definition.league ?? '-').padEnd(18)} ${definition.nation.padEnd(12)} ` +
        `x${card.owned.quantity}${card.owned.untradeable ? ' untradeable' : ''}` +
        `${card.owned.inActiveSquad ? ' in active squad' : ''}\n`,
    )
  }
  process.stdout.write(`${matches.length} match(es), showing ${Math.min(limit, matches.length)}\n`)
  return 0
}

function sbcCommand(args: string[], flags: Map<string, string>, requirementText: string[]): number {
  const action = args[0] ?? 'list'
  if (action === 'list') {
    const sbcs = listSbcs(ROOT)
    if (sbcs.length === 0) {
      process.stdout.write('No SBCs defined yet. See: sbc define\n')
      return 0
    }
    for (const sbc of sbcs) {
      process.stdout.write(
        `${sbc.name}  ${sbc.formation}` +
          `${sbc.teamRating === undefined ? '' : `  rating ${sbc.teamRating}`}` +
          `  x${sbc.repeatable}  ${sbc.requirements.length} requirement(s)\n`,
      )
    }
    return 0
  }

  if (action === 'add') {
    const file = args[1]
    if (file === undefined) {
      process.stderr.write('usage: sbc add <file.json>\n')
      return 2
    }
    const sbc = JSON.parse(readFileSync(resolve(file), 'utf8')) as SbcDefinition
    try {
      getFormation(sbc.formation)
    } catch (error) {
      process.stderr.write(`${String(error)}\n`)
      return 2
    }
    for (const conflict of detectConflicts(sbc.requirements)) {
      process.stdout.write(`WARNING, impossible for everyone: ${conflict.reason}\n`)
    }
    process.stdout.write(`Added ${sbc.name} from ${file} to ${saveSbc(ROOT, sbc)}\n`)
    return 0
  }

  if (action === 'show') {
    const sbc = loadSbc(ROOT, args[1] ?? '')
    if (sbc === null) {
      process.stderr.write(`no SBC called ${JSON.stringify(args[1] ?? '')}\n`)
      return 1
    }
    process.stdout.write(JSON.stringify(sbc, null, 2) + '\n')
    const conflicts = detectConflicts(sbc.requirements)
    for (const conflict of conflicts) {
      process.stdout.write(`IMPOSSIBLE FOR EVERYONE: ${conflict.reason}\n`)
    }
    return 0
  }

  if (action === 'define') {
    const name = args[1]
    if (name === undefined) {
      process.stderr.write('usage: sbc define <name> --formation 4-4-2 [--rating 85] ...\n')
      return 2
    }
    const formation = flags.get('formation') ?? '4-4-2'
    try {
      getFormation(formation)
    } catch (error) {
      process.stderr.write(`${String(error)}\n`)
      return 2
    }
    let requirements: Requirement[]
    try {
      requirements = requirementText.map(parseRequirement)
    } catch (error) {
      if (error instanceof RequirementSyntaxError) {
        process.stderr.write(`${error.message}\n`)
        return 2
      }
      throw error
    }
    const sbc: SbcDefinition = {
      name,
      formation,
      requirements,
      repeatable: Number(flags.get('repeatable') ?? 1),
      ...(flags.has('rating') ? { teamRating: Number(flags.get('rating')) } : {}),
      ...(flags.has('notes') ? { notes: flags.get('notes') ?? '' } : {}),
    }
    const conflicts = detectConflicts(sbc.requirements)
    for (const conflict of conflicts) {
      process.stdout.write(`WARNING, impossible for everyone: ${conflict.reason}\n`)
    }
    const path = saveSbc(ROOT, sbc)
    process.stdout.write(`Saved ${sbc.name} to ${path}\n`)
    return 0
  }

  process.stderr.write(`unknown sbc action ${JSON.stringify(action)}\n`)
  return 2
}

interface Prepared {
  state: ClubState
  pool: ReturnType<typeof buildPool>
  byId: Map<string, import('../src/types/cards').ResolvedCard>
  multisets: Record<number, number>[] | null
}

function prepare(sbc: SbcDefinition, flags: Map<string, string>): Prepared | null {
  const state = requireState()
  if (state === null) return null
  const pool = buildPool(state.club, state.cards, { prices: state.prices })
  const { resolved } = resolveClub(state.club, state.cards)
  const byId = new Map(resolved.map((card) => [card.owned.id, card]))

  let multisets: Record<number, number>[] | null = null
  if (sbc.teamRating !== undefined) {
    const { supply, cheapest } = supplyAndPrices(pool.cards)
    const combinations = takeRatingCombinations(
      {
        target: sbc.teamRating,
        availableRatings: [...supply.keys()],
        priceOf: (rating) => cheapest.get(rating) ?? 0,
        supplyOf: (rating) => supply.get(rating) ?? 0,
      },
      Number(flags.get('combinations') ?? 60),
    )
    if (combinations.length === 0) {
      process.stderr.write(
        `no combination of the ratings you own reaches ${sbc.teamRating}. Nothing to solve.\n`,
      )
      return null
    }
    multisets = combinations.map((combination) => Object.fromEntries(combination.counts))
  }
  return { state, pool, byId, multisets }
}

async function solve(name: string | undefined, flags: Map<string, string>, client: SolverClient): Promise<number> {
  if (name === undefined) {
    process.stderr.write('usage: solve <sbc name> [--repeat N]\n')
    return 2
  }
  const sbc = loadSbc(ROOT, name)
  if (sbc === null) {
    process.stderr.write(`no SBC called ${JSON.stringify(name)}. Try: sbc list\n`)
    return 1
  }
  const conflicts = detectConflicts(sbc.requirements)
  if (conflicts.length > 0) {
    process.stdout.write('IMPOSSIBLE FOR EVERYONE, before your club is even looked at:\n')
    for (const conflict of conflicts) process.stdout.write(`  ${conflict.reason}\n`)
    return 1
  }

  const prepared = prepare(sbc, flags)
  if (prepared === null) return 1
  const formation = getFormation(sbc.formation)
  const requested = Number(flags.get('repeat') ?? sbc.repeatable ?? 1)

  const body = {
    pool: prepared.pool.cards,
    formation_slots: formation.slots,
    requested,
    requirements: sbc.requirements,
    chemistry: buildChemistryConfig(),
    allowed_rating_multisets: prepared.multisets,
    rating_prices: prepared.state.prices,
    max_copies_per_squad: MAX_COPIES_PER_SQUAD,
    time_budget_seconds: Number(flags.get('time') ?? 60),
  }

  let response: WireRepeatResponse
  try {
    response = await client.post<WireRepeatResponse>('/solve/repeat', body)
  } catch (error) {
    return solverError(error)
  }

  process.stdout.write(`${sbc.name}: ${response.achieved} of ${requested} squad(s) built\n`)
  if (!sbc.requirements.some((requirement) => requirement.type === 'teamChemistry' || requirement.type === 'perPlayerChemistry')) {
    // Otherwise a squad of eleven zeroes reads as a bug rather than as the answer
    // to the question that was actually asked.
    process.stdout.write(
      '  No chemistry requirement was set, so the solver spent nothing on chemistry. ' +
        'Add teamChemistry:min:N to the SBC if you want it to care\n',
    )
  }
  process.stdout.write(formatSpend(response.coins_spent, response.value_burned, response.total_cost) + '\n')
  if (!response.proven_optimal) {
    process.stdout.write('  NOT PROVEN OPTIMAL: this is the best found inside the time budget\n')
  }
  response.squads.forEach((squad, index) => {
    const rebuilt = rebuild(squad, sbc.formation, prepared.byId, sbc.requirements)
    process.stdout.write(
      formatSquad(rebuilt, index + 1, {
        cost: squad.cost,
        coinsSpent: squad.coins_spent,
        valueBurned: squad.value_burned,
      }) + '\n',
    )
    process.stdout.write(formatRequirements(rebuilt.results) + '\n')
  })
  if (response.diagnosis !== null) {
    process.stdout.write(formatDiagnosis(response.diagnosis) + '\n')
  }
  return response.achieved === requested ? 0 : 1
}

async function queue(file: string | undefined, flags: Map<string, string>, client: SolverClient): Promise<number> {
  if (file === undefined) {
    process.stderr.write('usage: queue <file.json>\n')
    return 2
  }
  const wanted = JSON.parse(readFileSync(resolve(file), 'utf8')) as {
    name?: string
    items: { sbc: string; kind?: string; count?: number; priority?: number; set?: string }[]
  }
  const state = requireState()
  if (state === null) return 1
  const pool = buildPool(state.club, state.cards, { prices: state.prices })
  const { resolved } = resolveClub(state.club, state.cards)
  const byId = new Map(resolved.map((card) => [card.owned.id, card]))

  const items = []
  const sbcs = new Map<string, SbcDefinition>()
  for (const entry of wanted.items) {
    const sbc = loadSbc(ROOT, entry.sbc)
    if (sbc === null) {
      process.stderr.write(`no SBC called ${JSON.stringify(entry.sbc)}\n`)
      return 1
    }
    sbcs.set(entry.sbc, sbc)
    const prepared = prepare(sbc, flags)
    if (prepared === null) return 1
    items.push({
      name: entry.sbc,
      formation_slots: getFormation(sbc.formation).slots,
      requirements: sbc.requirements,
      chemistry: buildChemistryConfig(),
      multisets: prepared.multisets,
      kind: entry.kind ?? 'one_off',
      count: entry.count ?? 1,
      priority: entry.priority ?? 1,
      set_name: entry.set ?? null,
    })
  }

  let response: WireQueueResponse
  try {
    response = await client.post<WireQueueResponse>('/solve/queue', {
      pool: pool.cards,
      items,
      rating_prices: state.prices,
      max_copies_per_squad: MAX_COPIES_PER_SQUAD,
      time_budget_seconds: Number(flags.get('time') ?? 120),
    })
  } catch (error) {
    return solverError(error)
  }

  process.stdout.write(`${wanted.name ?? 'queue'}: ${response.squads_built} squad(s) built\n`)
  process.stdout.write(formatSpend(response.coins_spent, response.value_burned, response.total_cost) + '\n')
  for (const item of response.items) {
    process.stdout.write(`\n${item.name}: ${item.achieved} of ${item.requested}, ${item.cost} cost\n`)
    const sbc = sbcs.get(item.name)
    item.squads.forEach((squad, index) => {
      if (sbc === undefined) return
      const rebuilt = rebuild(squad, sbc.formation, byId, sbc.requirements)
      process.stdout.write(
        formatSquad(rebuilt, index + 1, {
          cost: squad.cost,
          coinsSpent: squad.coins_spent,
          valueBurned: squad.value_burned,
        }) + '\n',
      )
      process.stdout.write(formatRequirements(rebuilt.results) + '\n')
    })
    if (item.diagnosis !== null) process.stdout.write(formatDiagnosis(item.diagnosis) + '\n')
  }
  if (response.plan_summary !== null) {
    process.stdout.write(`\n${response.plan_summary}\n`)
  }
  return response.complete ? 0 : 1
}

function solverError(error: unknown): number {
  if (error instanceof SolverUnavailableError) {
    process.stderr.write(`${error.message}\n`)
    return 3
  }
  if (error instanceof SolverRejectedError) {
    process.stderr.write(`the solver refused this request (${error.status}): ${error.message}\n`)
    return 4
  }
  throw error
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
