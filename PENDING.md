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

**Status:** open, and **corrected since first written**
**Needs:** the game open. Two Concept Squads, no card ownership required.

Both are 4-4-2 with every player in a slot they actually play. Any ratings will do
for chemistry, but 84s everywhere gives a second rating reading for free.

### Why the first version of Squad A was wrong

It asked for four players from one club and seven from another with **no two players
sharing a league**. That squad cannot exist. A club sits in exactly one league, so
four clubmates are four league mates. The expected 29 was club points with the league
contribution left out, and no reading could have produced it. Corrected below.

### Squad A, `gt-002-club-league-entanglement`

Eleven players, all in position:

- **2** from one club, in league A
- **3** from a second club, in league B
- **4** from a third club, in league C
- **2** more, at two further clubs in two further leagues, **sharing a nationality
  with each other only**
- every other nationality distinct, and no nationality shared across the groups above

**Report:** squad chemistry total and all eleven individual values.
**Expected:** the pair on 1, the trio on 2 each, the four on 3 each, the nation pair
on 1 each. Total **22**.

**What each number discriminates:**

| Group | Expected | Confirms |
|---|---|---|
| club pair | 1 | club +1 fires at 2, AND league +1 does NOT fire at 2. A 0 means club needs 3, a 2 means league fires at 2. |
| club trio | 2 | league +1 fires at 3, AND club does not step up at 3. A 1 means league needs more than 3, a 3 means club +2 fires at 3. |
| club four | 3 | club +2 fires at 4. A 2 means club is still on +1 at four. |
| nation pair | 1 | nation +1 fires at 2. A 0 means nation needs 3. |

Group sizes were chosen so **no player reaches the 3 point cap by accident**. A capped
player reveals nothing, which is exactly what went wrong with the first version.

### Squad B, `gt-003-league-asymmetry`

Unchanged, and already checked by hand. Two players from one league, three from a
second, five from a third, one from a fourth, **no two players sharing a club or a
nation**. Clubs must all be different, which is what keeps the club ladder out of it.

**Report:** squad chemistry total and all eleven individual values.
**Expected:** the pair on 0, the three on 1 each, the five on 2 each, the last on 0.
Total **13**.

**What it discriminates:** league +1 at 3 and league +2 at 5, cleanly, with no club
contribution anywhere. The pair scoring **0** is the sharpest single number in either
squad: it is the club versus league asymmetry stated directly, since two players is
enough for a club or nation point but not for a league point.

### What these two deliberately do NOT probe

- **Club +3 at 7.** Unobservable. By four clubmates a player is already on club +2 plus
  league +1, which is the cap, so every group of four or more reads 3 whatever the club
  ladder does above it. No reading can distinguish a correct +3 step from a wrong one,
  so none is asked for.
- **League +3 at 8, nation +2 at 5, nation +3 at 8.** Not covered, for want of slots.
  They come from the same source sentence as the steps Squad B does confirm ("+2 when 5
  players are from the same country or league", "+3 when 8 ..."), so confirming the
  league side is meaningful evidence for the nation side. See P-006 if you want them
  pinned properly.

**Unblocks:** `pending_verification` on `gt-002` and `gt-003`, and implicitly the 4-4-2
slot labels in P-004.

---

## P-006 The remaining ladder steps, optional

**Status:** open, **low priority, only if you want the last steps pinned**
**Needs:** the game open. One Concept Squad.

**Do:** eight players from the same league at eight different clubs, with all eleven
nationalities distinct, plus three players sharing a fourth league between them.
**Report:** squad chemistry total and all eleven individual values.
**Expected:** the eight on 3 each, the three on 1 each, total 27.

**Why it is optional:** it pins league +3 at 8, which P-005 cannot reach for want of
slots. Everything else in use is either confirmed by P-005 or unobservable. If you
never take this reading the solver is very probably still correct, and the startup
warning will keep saying so rather than pretending otherwise.
