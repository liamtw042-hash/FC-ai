/**
 * SBC definitions on disk, and the shorthand for writing one at the prompt.
 *
 * An SBC is a name, a formation, an optional team rating and a list of
 * requirements. Nothing here interprets a requirement: `validateSquad` and the
 * solver's challenge model do that, and this file only reads and writes them.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Requirement } from '../types/requirements'

export interface SbcDefinition {
  name: string
  /** A formation name from src/rules/formations.ts. */
  formation: string
  /** The squad rating to hit, when the SBC asks for one. */
  teamRating?: number
  requirements: Requirement[]
  /** How many times it can be completed. 1 for a one off. */
  repeatable: number
  notes?: string
}

export function sbcDirectory(root: string): string {
  return resolve(root, 'data', 'sbc')
}

export function listSbcs(root: string): SbcDefinition[] {
  const directory = sbcDirectory(root)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as SbcDefinition)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function loadSbc(root: string, name: string): SbcDefinition | null {
  return listSbcs(root).find((sbc) => sbc.name === name) ?? null
}

export function saveSbc(root: string, sbc: SbcDefinition): string {
  const directory = sbcDirectory(root)
  mkdirSync(directory, { recursive: true })
  const path = resolve(directory, `${slug(sbc.name)}.json`)
  writeFileSync(path, JSON.stringify(sbc, null, 2) + '\n')
  return path
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export class RequirementSyntaxError extends Error {}

/**
 * `type:op:value` with optional `:key=value` extras, which is enough to type an
 * SBC at a prompt without a JSON file.
 *
 *   playersFromLeague:min:4:league=Premier Division
 *   totwCount:min:1
 *   teamChemistry:min:27
 *
 * Anything richer is written as JSON and loaded. This is a shorthand, not a
 * second requirement language, and it refuses what it does not understand rather
 * than guessing at it.
 */
export function parseRequirement(text: string): Requirement {
  const parts = text.split(':')
  const [type, op, rawValue, ...extras] = parts
  if (type === undefined || type === '') {
    throw new RequirementSyntaxError(`empty requirement in ${JSON.stringify(text)}`)
  }
  const requirement: Record<string, unknown> = { type }
  if (op !== undefined && op !== '') {
    if (!['min', 'max', 'exact'].includes(op)) {
      throw new RequirementSyntaxError(
        `${JSON.stringify(op)} is not min, max or exact, in ${JSON.stringify(text)}`,
      )
    }
    requirement.op = op
  }
  if (rawValue !== undefined && rawValue !== '') {
    const value = Number(rawValue)
    if (!Number.isInteger(value)) {
      throw new RequirementSyntaxError(
        `${JSON.stringify(rawValue)} is not a whole number, in ${JSON.stringify(text)}`,
      )
    }
    requirement.value = value
  }
  for (const extra of extras) {
    const index = extra.indexOf('=')
    if (index < 1) {
      throw new RequirementSyntaxError(
        `${JSON.stringify(extra)} is not key=value, in ${JSON.stringify(text)}`,
      )
    }
    const key = extra.slice(0, index)
    const value = extra.slice(index + 1)
    requirement[key] = /^-?\d+$/.test(value) ? Number(value) : value
  }
  return requirement as unknown as Requirement
}
