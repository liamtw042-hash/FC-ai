/**
 * Every game rule value in use, and whether it has been checked against the game.
 *
 * THE TIER CRITERION, which is the point of this file.
 *
 * A fact is LIVE when a wrong value could change a returned squad. It is
 * UNOBSERVABLE when a wrong value could not change anything, so no reading can
 * check it and no solution can depend on it.
 *
 * The criterion is NOT "is a reading queued for it". A rule with no queued reading
 * is still live if getting it wrong would change a squad, and a rule with a
 * plausible reading is still unobservable if nothing downstream can see it.
 *
 * `observable` is not taken on trust. observability.test.ts perturbs each
 * threshold step and checks whether any squad's chemistry actually moves, then
 * compares that measurement against the flag declared here. A flag that drifts
 * away from the behaviour fails the build.
 */

export type RuleFactKind = 'threshold_step' | 'rating_step' | 'formation_table'

export interface RuleFact {
  id: string
  kind: RuleFactKind
  what: string
  /** True when a wrong value here could change a returned squad. Measured, not assumed. */
  observable: boolean
  /** Why it can or cannot be seen downstream. */
  reason: string
  /** Confirmed against an observed in game reading. */
  verified: boolean
  /** The reading that would confirm it, when one can exist. */
  pendingRef: string | null
  /** Where the current value came from. */
  source: string
}

const CONFIRMED_IN_WRITING =
  'Stated verbatim in the FC 26 chemistry reference. Documented, but not yet ' +
  'confirmed by an in game reading taken by us.'

export const RULE_FACTS: RuleFact[] = [
  {
    id: 'threshold:club@2',
    kind: 'threshold_step',
    what: 'Club +1 at 2 clubmates',
    observable: true,
    reason: 'A club pair reads 1 if the step fires at 2 and 0 if it needs 3.',
    verified: false,
    pendingRef: 'P-005',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:club@4',
    kind: 'threshold_step',
    what: 'Club +2 at 4 clubmates',
    observable: true,
    reason:
      'Four clubmates read 3 if the step fires at 4 and 2 if it does not. Only ' +
      'decisive once league +2 at 5 is pinned separately, which P-005 Squad B does.',
    verified: false,
    pendingRef: 'P-005',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:club@7',
    kind: 'threshold_step',
    what: 'Club +3 at 7 clubmates',
    observable: false,
    reason:
      'Masked. Clubmates are always league mates, so by four clubmates a player ' +
      'already holds club +2 plus league +1, which is the 3 point cap. Every group ' +
      'of four or more reads 3 whatever this step does, so no squad chemistry and ' +
      'therefore no solution can depend on it.',
    verified: false,
    pendingRef: null,
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:nation@2',
    kind: 'threshold_step',
    what: 'Nation +1 at 2 countrymen',
    observable: true,
    reason: 'A nation pair reads 1 if the step fires at 2 and 0 if it needs 3.',
    verified: false,
    pendingRef: 'P-006',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:nation@5',
    kind: 'threshold_step',
    what: 'Nation +2 at 5 countrymen',
    observable: true,
    reason:
      'Five countrymen at distinct clubs in distinct leagues read 2 if the step ' +
      'fires and 1 if it does not. Nation entangles with nothing, so nothing masks it.',
    verified: false,
    pendingRef: 'P-006',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:nation@8',
    kind: 'threshold_step',
    what: 'Nation +3 at 8 countrymen',
    observable: true,
    reason:
      'Eight countrymen at distinct clubs in distinct leagues read 3 if the step ' +
      'fires and 2 if it does not. Nothing masks it, unlike the club +3 step.',
    verified: false,
    pendingRef: 'P-008',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:league@3',
    kind: 'threshold_step',
    what: 'League +1 at 3 league mates',
    observable: true,
    reason: 'Three league mates at distinct clubs read 1 if the step fires and 0 if not.',
    verified: false,
    pendingRef: 'P-005',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:league@5',
    kind: 'threshold_step',
    what: 'League +2 at 5 league mates',
    observable: true,
    reason: 'Five league mates at distinct clubs read 2 if the step fires and 1 if not.',
    verified: false,
    pendingRef: 'P-005',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'threshold:league@8',
    kind: 'threshold_step',
    what: 'League +3 at 8 league mates',
    observable: true,
    reason:
      'Eight league mates at distinct clubs and nations read 3 if the step fires ' +
      'and 2 if it does not. Nothing masks it, unlike the club +3 step.',
    verified: false,
    pendingRef: 'P-007',
    source: CONFIRMED_IN_WRITING,
  },
  {
    id: 'rating:step5_floor',
    kind: 'rating_step',
    what: 'Squad rating step 5 is floor, not round',
    observable: true,
    reason:
      'One 95 with ten 84s reads 85 under floor and 86 under round. Every rating ' +
      'target in the solver shifts if this is wrong.',
    verified: false,
    pendingRef: 'P-001',
    source:
      'Every published version of the formula spells the last two steps out as ' +
      'round to nearest, then round down.',
  },
  {
    id: 'formations:slot_labels',
    kind: 'formation_table',
    what: 'Formation slot labels',
    observable: true,
    reason:
      'The positioning gate compares a preferred position against the slot label ' +
      "exactly. A slot called CDM here that the game calls CM zeroes that player's " +
      'chemistry and every squad in that formation is wrong.',
    verified: false,
    pendingRef: 'P-004',
    source: 'Rebuilt from the public formation list rather than extracted game data.',
  },
]

export function unverifiedRuleFacts(): RuleFact[] {
  return RULE_FACTS.filter((fact) => !fact.verified)
}
