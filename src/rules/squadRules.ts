/**
 * Structural rules about a squad that are not requirements.
 *
 * A requirement is something an SBC asks for. This is something the game
 * enforces whatever the SBC says, so it belongs with the rules rather than with
 * the challenge, and the solver is told it as data.
 */

import { RULE_FACTS } from './ruleFacts'

/**
 * How many times one player may appear in a SINGLE squad.
 *
 * UNVERIFIED. See PENDING P-009 and `ruleFacts.ts` id `squad:one_copy_per_player`.
 * The evidence is secondary and none of it was readable at source from here, so
 * this is the best supported value rather than a confirmed one, and it is
 * surfaced in the startup warning like every other unverified value.
 *
 * Across DIFFERENT squads is unaffected and always has been: a stack of four 84s
 * feeding four squads is the normal way a repeatable SBC is fed.
 */
export const MAX_COPIES_PER_SQUAD = 1

/** The fact behind the value, so a caller can show why it is flagged. */
export function copyLimitFact() {
  const fact = RULE_FACTS.find((entry) => entry.id === 'squad:one_copy_per_player')
  if (fact === undefined) {
    throw new Error('the one copy per player rule fact is missing from RULE_FACTS')
  }
  return fact
}

/**
 * What makes two cards "the same player" for the limit above.
 *
 * THE CARD DEFINITION, today. Whether the game blocks two DIFFERENT versions of
 * one footballer, a base gold and a TOTW say, is the open half of P-009, and this
 * database has no footballer id to key on even if the answer is yes: a
 * CardDefinition carries a defId and a name, and names are not unique. If the
 * reading says the limit is per footballer, the fix is a player id from the card
 * database and a change to THIS function, not to the solver.
 */
export function playerKeyOf(definition: { defId: string }): string {
  return definition.defId
}
