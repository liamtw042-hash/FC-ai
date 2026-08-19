/**
 * Formations, as a name plus its eleven position slots.
 *
 * Rebuilt from the public formation list rather than vendored from the reference
 * project, whose formations.json is extracted EA game data. See RESEARCH.md 3.
 *
 * NOT VERIFIED against FC 26 in game. Slot labels matter, because the positioning
 * gate compares a card's preferred positions against the slot label exactly: a slot
 * this table calls CDM that the game calls CM would silently zero a player's
 * chemistry. Ground truth fixtures verify this implicitly, since a fixture records
 * its formation and every player's individual chemistry. See PENDING.md P-004.
 */

import type { Formation } from '../types/squad'

export const FORMATIONS_VERIFIED = false
export const FORMATIONS_SOURCE =
  'Rebuilt from the public formation list. Slot labels not yet confirmed in game.'

const TABLE: Record<string, string[]> = {
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '4-4-1-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'CF', 'ST'],
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'],
  '4-3-3-holding': ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CM', 'CM', 'LW', 'ST', 'RW'],
  '4-3-3-attack': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CAM', 'LW', 'ST', 'RW'],
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CDM', 'CAM', 'CAM', 'CAM', 'ST'],
  '4-2-2-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CDM', 'CAM', 'CAM', 'ST', 'ST'],
  '4-1-2-1-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CM', 'CM', 'CAM', 'ST', 'ST'],
  '4-3-2-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'CF', 'CF', 'ST'],
  '4-5-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'CM', 'RM', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LM', 'CDM', 'CM', 'CDM', 'RM', 'ST', 'ST'],
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'RM', 'LW', 'ST', 'RW'],
  '3-4-1-2': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'RM', 'CAM', 'ST', 'ST'],
  '5-3-2': ['GK', 'LWB', 'CB', 'CB', 'CB', 'RWB', 'CM', 'CM', 'CM', 'ST', 'ST'],
  '5-2-1-2': ['GK', 'LWB', 'CB', 'CB', 'CB', 'RWB', 'CM', 'CM', 'CAM', 'ST', 'ST'],
}

export class UnknownFormationError extends Error {
  constructor(name: string) {
    super(`Unknown formation "${name}". Known: ${Object.keys(TABLE).join(', ')}`)
    this.name = 'UnknownFormationError'
  }
}

export function getFormation(name: string): Formation {
  const slots = TABLE[name]
  if (slots === undefined) throw new UnknownFormationError(name)
  return { name, slots: [...slots] }
}

export function listFormations(): Formation[] {
  return Object.entries(TABLE).map(([name, slots]) => ({ name, slots: [...slots] }))
}

export function hasFormation(name: string): boolean {
  return name in TABLE
}
