# PENDING.md

Everything that needs the owner. Nothing here blocks the build: every unverified value has a
best supported implementation in place, marked `verified: false` in the data and surfaced in
the startup warning.

Cleared in batches. Status is `open` until a reading comes back.

---

## P-001 Squad rating, floor versus round

**Status:** open
**Needs:** the game open, Concept Squad only, no card ownership required.

**Do:** build a Concept Squad of one 95 rated player and ten 84 rated players, any formation.
**Report:** the displayed squad rating.
**Expected:** 85.

**Why it matters:** this is the only case that separates `floor` from `round` in step 5 of the
squad rating formula. None of the four test vectors in the brief reach past the .5 boundary.
`floor` gives 85, `round` gives 86.

**Unblocks:** clearing `pending_verification` on fixture `gt-001-floor-vs-round`. If the answer
is 86, step 5 changes to `round` and every rating in the solver shifts.

---

## P-002 Festival of Football Captains chemistry

**Status:** open
**Needs:** the game open, and a squad containing at least one FoF Captain.

**Do:** build any squad containing an FoF Captain, ideally one where the Captain has few other
links so its own value is isolated.
**Report:** the squad rating, the squad chemistry total, and **every player's individual
chemistry value**, in slot order.

**Why it matters:** the Captain contribution values, 3 nation, 1 club, 1 league, come from
published write ups. The `alwaysMaxChem` value on top of them is **inferred**, by analogy with
Icons and Heroes and from the claim that Captains are "inherently 3 chemistry". Nobody has
confirmed a Captain sitting at 3 with no supporting links. It is currently `verified: false`.

**Unblocks:** the `alwaysMaxChem` flag on `fof_captain` in the card type registry. Individual
chemistry values are needed rather than the total, because a total of 27 can be produced a
dozen ways and cannot say which threshold misfired.

---

## P-003 FutDB free tier

**Status:** open
**Needs:** a FutDB account. Free, but it is a signup, so it is not something to do unasked.

**Do:** register a free API key at futdb.app and read the docs behind the signup.
**Report:** the real free tier request limit, and which endpoints return 403 on a free key.

**Why it matters:** the published plan table shows 5,000 per day at the lowest tier and 20,000
higher up, but the free tier figure is not published anywhere public. The loader reads its
limit from response headers when present and otherwise from config, defaulting conservatively
to 2 per second and 4,000 per day, so nothing is hardcoded and nothing is invented.

**Unblocks:** checkpoint 2, the seed pull. The loader is written and unit tested against a
recorded fixture regardless, so only the live pull waits on this.

---

## P-004 Formation slot labels

**Status:** open
**Needs:** the game open. Only for the formations actually used, not all fifteen.

**Do:** for each formation used regularly, note the position label the game prints on every
one of the eleven slots.
**Report:** formation name, then the eleven labels in order.

**Why it matters:** the positioning gate compares a card's preferred positions against the
slot label exactly. A slot this repo calls CDM that the game calls CM silently zeroes that
player's chemistry, and every squad built in that formation is then wrong in a way no unit
test can see. The table was rebuilt from the public formation list rather than vendored from
extracted game data, so the labels are plausible but unconfirmed.

**Unblocks:** `FORMATIONS_VERIFIED` in `src/rules/formations.ts`. Partly self clearing: any
chemistry fixture recorded in a formation implicitly confirms that formation's labels, so
P-005 will clear 4-4-2 on its own.

---

## P-005 Chemistry ladder probes

**Status:** open
**Needs:** the game open. Two Concept Squads, no card ownership required.

**Do:** build these two squads, both 4-4-2, both with every player in a slot they actually
play. Any ratings will do for chemistry, but 84s everywhere also gives a second rating
reading for free.

**Squad A, `gt-002-club-ladder`:** four players from one club, seven from a second club, and
no two players sharing a nation or a league.
**Report:** squad chemistry total and all eleven individual values.
**Expected:** the four on 2 each, the seven on 3 each, total 29.

**Squad B, `gt-003-league-asymmetry`:** two players from one league, three from a second,
five from a third, one from a fourth, and no two players sharing a club or a nation.
**Report:** squad chemistry total and all eleven individual values.
**Expected:** the pair on 0, the three on 1 each, the five on 2 each, the last on 0, total 13.

**Why it matters:** these are built to confirm several ladder steps per reading rather than
one. Squad A settles club +2 at 4 and club +3 at 7 together. Squad B settles league +1 at 3
and +2 at 5, and confirms the asymmetry directly: the pair scoring nothing is the whole
point, since two players is enough for a club or nation point but not for a league point.

**Unblocks:** `pending_verification` on `gt-002` and `gt-003`, and implicitly the 4-4-2 slot
labels in P-004.
