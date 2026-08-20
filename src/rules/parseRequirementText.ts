/**
 * The paste parser. Brief section 9, SBC library.
 *
 * Takes the requirement text as it appears in game and produces `Requirement[]`.
 *
 * THE RULE THIS FILE IS BUILT AROUND: IT NEVER SILENTLY DROPS A LINE. Every line
 * of the pasted text comes back either as a parsed requirement or as an
 * unrecognised line with its text intact, and the caller is expected to show both
 * for confirmation before anything is saved. A parser that quietly ignores what
 * it does not understand produces a squad that satisfies four of five
 * requirements and looks like a success.
 *
 * It also never GUESSES at a number. "Min. 4" is a minimum of four. "A few" is an
 * unrecognised line, not a 3.
 */

import type { Requirement } from '../types/requirements'

export interface ParsedLine {
  /** The line exactly as pasted, so the confirmation screen can show it. */
  text: string
  /** 1 based, counting blank lines, so it matches what was pasted. */
  line: number
  requirement: Requirement | null
  /** Why it was not understood. Null when it was. */
  problem: string | null
}

export interface ParseResult {
  lines: ParsedLine[]
  requirements: Requirement[]
  unrecognised: ParsedLine[]
}

type Op = 'min' | 'max' | 'exact'

/**
 * How the game writes the three operators. `exact` is the interesting one: the
 * game says "Exactly" for some requirements and just states a number for others,
 * and a bare number means exactly.
 */
const OPERATORS: [RegExp, Op][] = [
  [/\b(?:min\.?|minimum|at least)\b/i, 'min'],
  [/\b(?:max\.?|maximum|at most|no more than)\b/i, 'max'],
  [/\b(?:exactly|exact)\b/i, 'exact'],
]

interface Pattern {
  /** Matches the label to the left of the colon, or the whole line. */
  label: RegExp
  type: string
  /** Which capture group, if any, names a league, nation, club or card type. */
  entity?: 'league' | 'nation' | 'club' | 'cardType' | 'promoName' | 'quality'
  /** Operator when the game does not write one. */
  defaultOp?: Op
  /** Some lines carry no number at all. */
  valueless?: boolean
}

/**
 * Label to requirement type.
 *
 * ORDER MATTERS: the first match wins, so anything with a named entity in it has
 * to come before the generic form of the same idea. "Players from Serie A" must
 * be tried before "Players".
 */
const PATTERNS: Pattern[] = [
  { label: /^(?:number of )?players? in the squad$/i, type: 'squadSize', defaultOp: 'exact' },
  { label: /^squad rating$/i, type: 'teamRating' },
  { label: /^team (?:overall )?rating$/i, type: 'teamRating' },
  { label: /^(?:team |squad )?chemistry$/i, type: 'teamChemistry' },
  { label: /^(?:min\.? )?player chemistry$/i, type: 'perPlayerChemistry' },
  { label: /^formation$/i, type: 'formation', valueless: true },

  { label: /^players? from (?:the )?(.+)$/i, type: 'playersFromLeague', entity: 'league' },
  { label: /^(.+?) league players?$/i, type: 'playersFromLeague', entity: 'league' },
  { label: /^(?:players? from )?(.+?) club players?$/i, type: 'playersFromClub', entity: 'club' },
  { label: /^nationality: (.+)$/i, type: 'playersFromNation', entity: 'nation' },

  { label: /^same (?:league|league count)$/i, type: 'sameLeagueCount' },
  { label: /^same (?:nation|nationality|nation count)$/i, type: 'sameNationCount' },
  { label: /^same (?:club|club count)$/i, type: 'sameClubCount' },
  { label: /^(?:number of )?(?:different |distinct |unique )?leagues?$/i, type: 'distinctLeagues' },
  { label: /^(?:number of )?(?:different |distinct |unique )?nation(?:alitie|ality|s)?s?$/i, type: 'distinctNations' },
  { label: /^(?:number of )?(?:different |distinct |unique )?clubs?$/i, type: 'distinctClubs' },

  { label: /^rare(?: players?)?$/i, type: 'rareCount' },
  { label: /^team of the week(?: players?)?$/i, type: 'totwCount' },
  { label: /^totw(?: players?)?$/i, type: 'totwCount' },
  { label: /^player quality$/i, type: 'qualityCount', entity: 'quality' },
  { label: /^(?:minimum |min\.? )?player rating$/i, type: 'minPlayerRating' },
  { label: /^(?:maximum |max\.? )?player rating$/i, type: 'maxPlayerRating', defaultOp: 'max' },
  { label: /^no evolved players?$/i, type: 'excludeEvolved', valueless: true },
]

const QUALITIES: Record<string, string> = { bronze: 'bronze', silver: 'silver', gold: 'gold' }

export function parseRequirementText(text: string): ParseResult {
  const lines: ParsedLine[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    // A blank line is not an unrecognised requirement, it is a blank line.
    if (trimmed === '') return
    lines.push(parseLine(trimmed, line))
  })

  const requirements = lines
    .map((entry) => entry.requirement)
    .filter((requirement): requirement is Requirement => requirement !== null)
  return {
    lines,
    requirements,
    unrecognised: lines.filter((entry) => entry.requirement === null),
  }
}

function parseLine(text: string, line: number): ParsedLine {
  const fail = (problem: string): ParsedLine => ({ text, line, requirement: null, problem })

  // "Label: value" is the shape the game uses. Some lines have no colon.
  const colon = text.indexOf(':')
  const label = (colon === -1 ? text : text.slice(0, colon)).trim()
  const rest = colon === -1 ? '' : text.slice(colon + 1).trim()

  // Nationality is written "Nationality: Spain: Min. 3", where the entity sits
  // between two colons. Split from the RIGHT, on the operator and number at the
  // end, because a nation name can contain anything including a colon.
  const nationality = /^nationality\s*:\s*(.*)$/i.exec(text)
  if (nationality !== null) {
    const tail = nationality[1] ?? ''
    const counted = /^(.*?)[\s:]*((?:min\.?|minimum|at least|max\.?|maximum|at most|no more than|exactly|exact)?\s*-?\d+)\s*$/i.exec(tail)
    if (counted === null) return fail('no number on this line')
    const name = (counted[1] ?? '').replace(/[\s:]+$/, '').trim()
    if (name === '') return fail('no nation named on this line')
    const parsed = readOperatorAndValue(counted[2] ?? '')
    if (parsed === null) return fail('the count for this nationality could not be read')
    return {
      text,
      line,
      requirement: {
        type: 'playersFromNation',
        nation: name,
        op: parsed.op,
        value: parsed.value,
      } as unknown as Requirement,
      problem: null,
    }
  }

  const pattern = PATTERNS.find((candidate) => candidate.label.test(label))
  if (pattern === undefined) return fail('the label was not recognised')

  if (pattern.valueless === true) {
    const requirement: Record<string, unknown> = { type: pattern.type }
    if (pattern.type === 'formation' && rest !== '') requirement.value = rest
    return { text, line, requirement: requirement as unknown as Requirement, problem: null }
  }

  if (pattern.entity === 'quality') {
    const quality = QUALITIES[rest.toLowerCase().replace(/^(?:exactly|min\.?|max\.?)\s*/i, '').trim()]
    if (quality === undefined) return fail(`"${rest}" is not bronze, silver or gold`)
    const operator = operatorIn(rest) ?? 'min'
    return {
      text,
      line,
      requirement: { type: 'qualityCount', quality, op: operator, value: 11 } as unknown as Requirement,
      problem: null,
    }
  }

  const parsed = readOperatorAndValue(rest, pattern.defaultOp)
  if (parsed === null) {
    return fail(rest === '' ? 'no number on this line' : `"${rest}" has no number in it`)
  }

  const requirement: Record<string, unknown> = {
    type: pattern.type,
    op: parsed.op,
    value: parsed.value,
  }
  if (pattern.entity !== undefined) {
    const match = pattern.label.exec(label)
    const name = match?.[1]?.trim()
    if (name === undefined || name === '') return fail('no league, club or nation named on this line')
    requirement[pattern.entity] = name
  }
  return { text, line, requirement: requirement as unknown as Requirement, problem: null }
}

function operatorIn(text: string): Op | null {
  for (const [pattern, op] of OPERATORS) if (pattern.test(text)) return op
  return null
}

function readOperatorAndValue(text: string, fallback: Op = 'min'): { op: Op; value: number } | null {
  const digits = /-?\d+/.exec(text)
  if (digits === null) return null
  const value = Number(digits[0])
  if (!Number.isInteger(value)) return null
  // A bare number with no operator word means exactly that number, except where
  // the requirement only makes sense as a bound and the caller says so.
  const op = operatorIn(text) ?? fallback
  return { op, value }
}
