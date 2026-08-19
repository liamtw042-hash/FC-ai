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

**Status:** open, **corrected since first written**
**Needs:** the game open. Two Concept Squads, no card ownership required.
**Order:** **take Squad B first.** Squad A's four player row cannot be read until B is
in, see the dependency note below.

Both are 4-4-2 with every player in a slot they actually play. Any ratings will do for
chemistry, but 84s everywhere gives a second rating reading for free.

### Squad B, `gt-003-league-asymmetry`. TAKE THIS ONE FIRST.

Two players from one league, three from a second, five from a third, one from a fourth,
**no two players sharing a club or a nation**. All clubs different is what keeps the
club ladder out of it.

**Report:** squad chemistry total and all eleven individual values.
**Expected:** the pair on 0, the three on 1 each, the five on 2 each, the last on 0.
Total **13**.

**What it pins:** league +1 at 3 and league +2 at 5, cleanly, with no club contribution
anywhere. The pair scoring **0** is the sharpest single number in either squad: it is
the club versus league asymmetry stated directly, since two players is enough for a club
or nation point but not for a league point.

### Squad A, `gt-002-club-league-entanglement`

Eleven players, all in position:

- **2** from one club, in league A
- **3** from a second club, in league B
- **4** from a third club, in league C
- **2** more at two further clubs in two further leagues, **sharing a nationality with
  each other only**
- every other nationality distinct, and none shared across the groups above

**Report:** squad chemistry total and all eleven individual values.
**Expected:** the pair on 1, the trio on 2 each, the four on 3 each, the nation pair on
1 each. Total **22**.

| Group | Expected | Pins |
|---|---|---|
| club pair | 1 | club +1 fires at 2, and league +1 does NOT fire at 2. A 0 means club needs 3, a 2 means league fires at 2. |
| club trio | 2 | league +1 fires at 3, and club does not step up at 3. A 1 means league needs more than 3, a 3 means club +2 fires at 3. |
| club four | 3 | club +2 fires at 4, **but only once Squad B is in.** See below. |
| nation pair | 1 | nation +1 fires at 2. A 0 means nation needs 3. |

**Dependency, and it is why B goes first.** A reading of 3 on the club four row is
consistent with two different worlds: club +2 with league +1, or club +1 with league +2.
On its own the row cannot tell them apart. Squad B settles league +2 at 5 independently,
because all of B's clubs and nations are distinct, and with league +2 pinned at 5 the
four player row can only be club +2. Take B first and A's four row becomes decisive.
Take A alone and that row proves nothing.

Group sizes were chosen so **no player reaches the 3 point cap by accident**. A capped
player reveals nothing, which is exactly what was wrong with the first version of this
squad.

**Unblocks:** `pending_verification` on `gt-002` and `gt-003`, and implicitly the 4-4-2
slot labels in P-004.

---

## P-006 Nation ladder probe

**Status:** open
**Needs:** the game open. One Concept Squad, 4-4-2, everyone in position.

**Do:** nation groups of **2, 5 and 4**, with **all eleven clubs distinct and all eleven
leagues distinct**.
**Report:** squad chemistry total and all eleven individual values.
**Expected:** the pair on 1 each, the five on 2 each, the four on 1 each. Total **16**.

**Why this and not another league probe.** After P-005 Squad B, league has 2, 3 and 5
pinned and only the +3 step at 8 left open. Nation has **nothing** pinned, and nation +2
at 5 fires in every nation hybrid, which is most of what a solver actually builds. Nation
also entangles with nothing, unlike club and league, so the ladder can be read cleanly
with no dependency on any other reading.

**What it pins, all three in one reading:** nation +1 at 2 (the pair on 1, not 0), nation
+2 at 5 (the five on 2, not 1), and that nation does **not** step up at 4 (the four on 1,
not 2).

**Unblocks:** `pending_verification` on `gt-004`.

---

## P-007 League +3 at 8, optional

**Status:** open, **lowest priority, only if you want the last step pinned**
**Needs:** the game open. One Concept Squad.

**Do:** eight players from the same league at eight different clubs, with all eleven
nationalities distinct, plus three players sharing a fourth league between them.
**Report:** squad chemistry total and all eleven individual values.
**Expected:** the eight on 3 each, the three on 1 each. Total 27.

**Why it is last.** It pins league +3 at 8, the only live step P-005 and P-006 leave
open. Nation +3 at 8 comes from the same source sentence, so this reading is evidence
for both. No fixture has been written for it: writing one now would park a permanently
pending entry in the startup warning for a reading that may never be taken. Say the word
and `gt-005` appears.
