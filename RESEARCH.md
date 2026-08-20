# RESEARCH.md

The findings and decisions this build rests on. **Current state only**: superseded
research and the verbatim decisions log live in `RESEARCH-ARCHIVE.md`, with their
section numbers unchanged so a reference to `7.1` in a commit message still finds it.

Research date: 2026-08-19. Last updated: 2026-08-20.

## What to read, depending on what you want

| You want | Read |
|---|---|
| What is blocked and why | 0 |
| The chemistry rules as implemented, and what they cost to verify | 2, 2.1, 2.3 |
| The squad rating formula, and why upgrading a player can never hurt | 4.1, 4.2 |
| Why the Python service holds no game rules | 8.3, and the invariant in `CLAUDE.md` |
| How prices work, and why an unpriced rating gets no number | 8.1, 8.8 |
| Queue mode, set mode and the five kinds of cause | 8.3, 8.4, 8.6 |
| Why the CSV loaders exist while checkpoint 2 is blocked | 8.7 |
| The UI, and what it deliberately does not have | 8.10 |
| What is still open | 9 |

---

## 0. Read this first: blockers

### 0.1 Network egress policy blocks most of the sources you named

This session runs behind an organisation egress proxy. The following hosts return
HTTP 403 at the CONNECT stage and cannot be read at all from here:

| Host | Needed for | Status |
|---|---|---|
| `futgenie.gg` | Step 0 item 1, reference product | BLOCKED 403 |
| `fifauteam.com` | Step 0 item 2, chemistry thresholds | BLOCKED 403 |
| `futbin.com` | Step 0 item 4, rating combinations | BLOCKED 403 |
| `sofifa.com` | dataset provenance | BLOCKED 403 |
| `kaggle.com` | Step 0 item 5, dataset download | BLOCKED 403 |
| `fut.gg`, `futdb.app`, `huggingface.co`, `wikipedia.org` | dataset alternatives | BLOCKED 403 |
| `github.com`, `raw.githubusercontent.com` | Step 0 item 3 | OK |

So items 1, 2, 4 and 5 were researched through web search and secondary sources
rather than read at source. I have flagged below exactly which numbers are
independently confirmed and which are not. Item 3 was cloned and read properly.

**Consequence: I cannot download a player dataset in this environment.** Section 3.1
is the second build checkpoint and it is not executable here. See 0.2.

### 0.2 Dataset route: FutDB. Decided.

The first pass found that every public FC 26 dataset I could identify (Kaggle
`rovnez/fc-26-fifa-26-player-data`, `flynn28/eafc26-player-database`,
`talhademirezen/fc-26-player-stats`, `justdhia/ea-sports-fc-26-player-ratings`, and the
GitHub project `ismailoksuz/EAFC26-DataHub` that consumes one of them) is a career mode
or sofifa style scrape. Roughly 16,000 to 18,000 rows, 110+ attributes, keyed to a
footballer rather than to an Ultimate Team card. No card version, no card type, no promo,
no TOTW, no Icons or Heroes. That covers base golds and nothing else, which is most of the
SBC surface missing.

**Decision: use FutDB (`futdb.app`).** Section 8's "do not scrape price sites" was about
scraping and about EA endpoints, not about documented APIs. FutDB is a free keyed JSON REST
API covering players, prices, nations, leagues, clubs and card types, and card type is
precisely the field the career mode dumps lack. Section 1.2 is untouched: FutDB is not EA
and no EA hostname is resolved anywhere in this codebase.

Architecture constraints that come with the decision, all binding:

- **One time pull, cached into SQLite as `card_definitions`.** Not a live dependency.
  After the initial pull the application must work fully offline, including solving.
- **API key lives in `.env`, never in the repo.** `.env` is already gitignored,
  `.env.example` is committed and is the only key related file that is.
- **Prices go behind the existing `PriceProvider` interface.** FutDB refreshes prices
  somewhere between 30 minutes and 24 hours depending on the card's rating and rarity,
  so every price is stamped with its fetch time and labelled indicative in the UI.
  The file backed provider stays as a fallback and remains the default.
- **The loader ships with a schema mapping file**, as Section 3.1 requires, so a different
  dump can be swapped in later without a code change.

### 0.3 FutDB is unreachable from here, and that no longer blocks anything

Probed before writing anything against it:

| Host | Result |
|---|---|
| `futdb.app` | CONNECT tunnel failed, 403 |
| `api.futdb.app` | CONNECT tunnel failed, 403 |
| `futdb.app/docs` | CONNECT tunnel failed, 403 |
| `futdatabase.com` | CONNECT tunnel failed, 403 |

Organisation egress policy denials, same class as 0.1, not retried and not routed around.

**Their terms, read by you and recorded here as fact:**

- A free key is the entry point. Confirmed.
- **Some endpoints are premium only.** Confirmed verbatim in their FAQ. A 403 on free is
  therefore an expected condition to be handled, not a crash.
- **Prices are premium only**, and there is **no bulk price endpoint and never will be**,
  so prices are one request per card even on premium. This kills FutDB as a price source.
  See 8.1.
- **Rate limits:** their plan table lists 5,000 requests per day at the lowest tier and
  20,000 at the higher ones, and above 20,000 you contact them. **The free tier figure is
  not published anywhere public.** So it stays uninvented.
- **Redistribution:** no terms page found at all. The seed database is treated as non
  redistributable. Local DB gitignored, repo ships loader plus mapping plus a download
  instruction.

**Checkpoint 2 is unblocked**, because the loader was never meant to run in this sandbox.
It is written here and executed on your machine. The shape:

- Loader plus field mapping file, so a different dump swaps in without a code change.
- **A recorded sample response committed as a test fixture**, constructed from the
  documented response shape, with the mapping unit tested against it offline. That is the
  verification, not a live call.
- **No hardcoded rate limit.** Read it from response headers when the API supplies them,
  otherwise from config with a deliberately conservative default of **2 requests per second
  and 4,000 per day**.
- Exponential backoff on 429, and the pull is **resumable**, checkpointing progress so a
  mid pull throttle does not lose completed work.
- A 403 on any endpoint means "premium only, skip and record", and the pull ends with a
  **coverage report** naming every field that came back null or unavailable.

Still to come from you: the real free tier limit and which endpoints 403, once you have
registered a key and read the docs behind the signup.

---

---

## 1. Step 0 item 1: FUTGenie, the reference product

**Superseded, moved to `RESEARCH-ARCHIVE.md`.** The reference product study. Its one live consequence is recorded in 5.7: the product whose whole distribution model is the thing Section 1.2 forbids.

---

## 2. Step 0 item 2: chemistry thresholds

`fifauteam.com` is blocked. I confirmed the numbers across independent secondary sources
(Yardbarker, eafczone, TeamGullit, Operation Sports, TheGamer, Total Apex, MMOMAX).

Confirmed:

- Squad chemistry is the sum over the 11 starters, 3 each, **max 33**. Confirmed.
- League needs 3 shared players for its first point while club and nation need 2.
  Confirmed explicitly and repeatedly. The asymmetry you flagged in Section 4.2 is real.
- Nation and league both reach +3 at 8. Confirmed.
- League reaches +2 at 5. Confirmed.
- Categories are counted separately then summed per player, capped at 3. Confirmed.
- Out of position means the player earns nothing. Confirmed.
- Icons and Heroes always sit at 3 chemistry when in a preferred position. Confirmed.
- **Icons contribute 2 increments to their nation and 1 to every league. Heroes contribute
  1 to their nation and 2 to their league.** Confirmed verbatim.
- Manager gives +1 to any player sharing their nation or league, capped at +1 per player
  even when both match. Confirmed.
- **Women link to men through club and nation only, never league**, because the men's and
  women's competitions are separate leagues. Confirmed, with the Sam Kerr / Enzo Fernandez
  Chelsea example given directly.

**Previously unconfirmed, now confirmed.** You obtained the FC 26 chemistry reference that
is blocked at this proxy. Verbatim:

- +1 when 2 players are from the same club or country
- +1 when 3 players are from the same league
- +2 when 4 players are from the same club
- +2 when 5 players are from the same country or league
- +3 when 7 players are from the same club
- +3 when 8 players are from the same country or league

So the full ladder, all six steps confirmed, no hedging remains:

| Category | +1 | +2 | +3 |
|---|---|---|---|
| Club | 2 | 4 | 7 |
| Nation | 2 | 5 | 8 |
| League | 3 | 5 | 8 |

Section 4.2 of the brief is correct as written and is implemented as certain.

### 2.1 APPROVED: chemistry contribution is a data table, not two booleans

FC 26 shipped **Festival of Football Captains**. Per multiple write ups (SI, MSN, inkl,
itemd2r), these items provide **three nation links, one club link and one league link**,
which is why they inherently sit at 3 chemistry alone. They are described as sitting
between a Hero and an Icon for squad building. There were 44 of them at launch with more
arriving through objectives and SBCs.

Section 4.2 models chemistry contribution as two hardcoded special cases, `isIcon` and
`isHero`. That is already out of date. EA is now shipping promo classes with bespoke
contribution weights, and it will keep doing it.

**Approved and now specification.** The boolean special cases are replaced with explicit
per card contribution weights, defaulting to 1/1/1:

```ts
interface ChemistryContribution {
  club: number      // increments added to the club count, 0 when the card has no club
  league: number    // increments added to every league for Icons, else to its own league
  nation: number
  appliesLeagueToAll: boolean   // true only for Icons
  alwaysMaxChem: boolean        // true for Icons, Heroes, FoF Captains
}
```

Then `isIcon` becomes `{club: 0, league: 1, nation: 2, appliesLeagueToAll: true, alwaysMaxChem: true}`,
`isHero` becomes `{club: 0, league: 2, nation: 1, appliesLeagueToAll: false, alwaysMaxChem: true}`,
FoF Captain becomes `{club: 1, league: 1, nation: 3, appliesLeagueToAll: false, alwaysMaxChem: true}`,
and a normal card is `{club: 1, league: 1, nation: 1, appliesLeagueToAll: false, alwaysMaxChem: false}`.

Same behaviour for everything Section 4.2 describes, plus the class that already exists,
plus the next one, without a code change. The rules engine stays pure and the table lives
in data.

Binding conditions attached to the approval:

- The table must reproduce the Icon rules (2 nation increments, 1 increment to every
  league) and the Hero rules (1 nation, 2 league) exactly. **Tests must prove the table
  produces identical results to the old boolean logic for Icons and Heroes**, so the
  generalisation is provably behaviour preserving and not a rewrite in disguise.
- Contribution values are sourced from the dataset card type where available, with a
  **local override file** for classes the dataset does not yet cover. FoF Captains are the
  first entry in that override file.
- `alwaysMaxChem` covers Icons, Heroes and FoF Captains, and remains gated on the
  positioning rule. An Icon out of position is still 0, not 3.

### 2.3 Club and league are entangled, and it limits what can be verified

Found while designing the ground truth probes, and it changed the design.

**Clubmates are always league mates.** A club belongs to exactly one league, so a
club group of n is also a league group of n. The club ladder and the league ladder
can never be read separately for ordinary cards. Only Icons, who have no club and
no league, and Heroes, who have no club, break the pairing, and neither helps here.

Running the engine over club group sizes with the pairing respected:

| Clubmates | Club | League | Chemistry |
|---|---|---|---|
| 2 | +1 | 0 | **1** |
| 3 | +1 | +1 | **2** |
| 4 | +2 | +1 | **3** |
| 5 | +2 | +2 | 3, capped |
| 6 | +2 | +2 | 3, capped |
| 7 | +3 | +2 | 3, capped |
| 8 | +3 | +3 | 3, capped |

**The club +3 at 7 step has no observable consequence.** By four clubmates a player
already holds club +2 plus league +1, which is the cap. Everything from four upward
reads 3 whatever the club ladder does above it. Whether that step is 7 or 6 or 9
cannot change any squad's chemistry, so it is not worth a reading and no probe
attempts one.

**What is observable, and where:** club +1 at 2 (a pair scores 1, not 0), that club
does not step up at 3 (a trio scores 2, not 3), league +1 at 3 (a trio scores 2, not
1), that league does not fire at 2 (a pair scores 1, not 2), and club +2 at 4 (a
quartet scores 3, not 2). All five are in `gt-002`.

This also killed the first version of `gt-002`, which gave every player a unique
league in order to isolate the club ladder. That squad cannot exist. The engine
scored it 29 correctly, but 29 was the answer to a question the game will never be
asked. The replacement respects the pairing and expects 22.

### 2.2 APPROVED: club alias table

"Women's players link to men's players by club and nation only, never league" is correct
as a statement about the game. As an implementation instruction it is a trap. If leagues
are modelled as distinct string identifiers, the league part needs no special case at all,
because "Barclays Women's Super League" and "Premier League" are simply different values
and never match. The part that **does** need work is the opposite one: the club link only
works if the women's club resolves to the **same club entity** as the men's club. If the
dataset gives "Arsenal Women" and "Arsenal" as two strings, club links silently break and
we will fail ground truth. So the real work item is a **club alias table**, not a league
exclusion rule.

**Approved.** The alias table is built, and the Arsenal Women to Arsenal case is unit
tested specifically. The league exclusion needs no code: distinct league strings never
match, so the rule falls out of the data model for free.

## 3. Step 0 item 3: kosciukiewicz/sbc-solver

**Superseded, moved to `RESEARCH-ARCHIVE.md`.** The prior art read. Its live consequences are the CP-SAT choice and the rating multiset approach, both now implemented and described in 8.3 to 8.6.

---

## 4. Step 0 item 4: FUTBIN rating combinations

`futbin.com` is blocked, so I could not read the page. The concept is well established and
Section 5 describes it correctly: for a target squad rating, enumerate the multisets of 11
player ratings that produce it, then shop each multiset. Search results surfaced the exact
worked examples your brief already uses, 2x91 plus 9x88 for 89, and the standard "top heavy"
observation that one or two very high cards let the remaining nine be much cheaper.

I do not need the page to build the enumerator, because Section 4.1 gives the formula and
Section 5 gives the round trip test that validates the enumerator against it. Flagging only
that item 4 of Step 0 is unread, not that anything is missing.

### 4.1 Squad rating formula: verified by hand, with one gap

I worked all four required test vectors through the Section 4.1 algorithm by hand. **All
four produce the stated answer.** The formula is internally consistent and I have no
correction to offer:

| Ratings | SUM | AR | CF | T | floor(T/11) | Expected |
|---|---|---|---|---|---|---|
| 83,82,81,80,75,82,80,76,77,78,78 | 872 | 79.2727 | 12.3636 | 884 | 80 | 80 |
| 2x91 + 9x88 | 974 | 88.5454 | 4.9091 | 979 | 89 | 89 |
| 2x90 + 9x87 | 963 | 87.5454 | 4.9091 | 968 | 88 | 88 |
| 11x84 | 924 | 84.0 | 0 | 924 | 84 | 84 |

**The gap.** Step 5 says `RATING = floor(T / 11)`. **None of the four test vectors
discriminate between `floor` and `round`.** In all four cases `T/11` is either exact or
below the .5 boundary, so both operations return the same answer. The tests as specified
therefore cannot catch the single most damaging possible error in the whole rules engine.

A case that does discriminate: **one 95 plus ten 84s.** SUM 935, AR 85.0, CF 10.0,
T 945, `945/11 = 85.909`. `floor` gives **85**, `round` gives **86**.

**DECIDED: implement `floor`.** Every published version of the formula spells the last two
steps out as round to the nearest integer, then round down, so the documented method and my
reading agree. Step 5 is `floor`.

Verification is still happening, because no reachable source tests a case past the .5
boundary. You are building 95 + 10x84 as a **Concept Squad** in the web app, which needs no
ownership of the cards. If the game shows 85, `floor` is confirmed and nothing changes.
If it shows 86, step 5 becomes `round`.

That squad is entry `gt-001-floor-vs-round` in `tests/fixtures/ground-truth.json` right now,
with expected value 85 and `pending_verification: true` so it is visibly unconfirmed until
you report back. The harness runs it and the flag is surfaced, it does not block anything.
The `floor` versus `round` discriminator is also an explicitly named unit test in the rules
engine so it can never silently regress.

Separately, note that `fifauteam` publishes the squad rating formula as `SR = (SUM + CF)/18`.
That is the **18 man squad** rating including the 7 substitutes, which is what the club
screen shows. SBC requirements are evaluated on the **11 starters**. Your `/11` is the right
one for this tool. Recording it here so that when someone later finds the `/18` version they
do not "fix" our formula.

Section 4.1's warning about upgrading your worst player lowering the rating is correct and
falls straight out of the maths. It will be preserved and I will add a test that asserts it,
so nobody "fixes" that either.

### 4.2 NEW FINDING: the counterintuitive behaviour in 4.1 does not exist

Section 4.1 says:

> Preserve the counterintuitive behaviour: upgrading your worst player can lower the
> squad rating, because it lifts the average and shrinks everyone's correction factor.
> Do not "fix" it.

**Under the formula in 4.1, that cannot happen.** I am not fixing it and I am not
quietly dropping it, I am telling you it is not there.

**The algebra.** Increase one rating by d > 0. The average rises by d/11, so every
other above-average player's correction term loses d/11.

- If the upgraded player is below the average and stays below it, SUM gains d and CF
  loses k'·d/11 where k' is the number of other above-average players. k' is at most 10,
  so SUM + CF changes by at least d/11, which is positive.
- If the upgraded player is above the average, its own term gains d - d/11 while the
  other k' lose d/11 each, so SUM + CF changes by 2d - (1 + k')·d/11, and 1 + k' is at
  most 11, so that is at least d, which is positive.
- Crossing the boundary only adds a max(0, ...) term, which is continuous and monotone.

So SUM + CF strictly increases. Step 4 is round and step 5 is floor, both non-decreasing,
so the squad rating **can never fall when any player is upgraded**. Upgrading the worst
player is just the special case.

**The brute force.** 20,281,170 exhaustive checks over spread multisets with the worst
player upgraded by 1 to 15, plus 300,000 random checks upgrading any player by any amount.
**Zero cases where the rating dropped.** Both properties are now permanent tests in
`src/rules/squadRating.test.ts`, so if the formula ever changes we find out immediately.

**What is actually true, and it costs real coins.** Against ten 84s, replacing the
eleventh 84 with an 85, 86, 87, 88 or 89 moves the squad rating **not one point**. It
stays 84 the whole way and only ticks to 85 at 90. Buy the 89 and you paid a lot for
nothing. That is the trap worth preserving, it is preserved, and it is tested.

**RESOLVED.** The sentence is wrong and is deleted from the brief. You verified the ten 84s
case by hand independently: 85 through 89 all give 84, and it only ticks over at 90.

**Both monotonicity tests stay, and here is what they actually mean.** They are not
regression tests on the implementation. Monotonicity is a **consequence of the exact
correction factor**, which is to say it follows from the formula itself, not from how we
coded it. The implementation cannot violate it without also failing the equivalence
property test against the literal transcription.

So the tests are pointed outward, at the formula. If you ever observe the game lowering a
squad rating after a player is upgraded, that observation **falsifies the formula in 4.1,
not our implementation of it.** The correct response would be to change the formula and to
add the observed squad as a ground truth fixture, not to relax the tests. That is the only
reading under which these tests can ever fail, and it is why they are worth keeping.

## 5. Disagreements and gaps in the rest of the brief

Numbered so you can answer by number. **All of these are now decided.** 5.1, 5.2, 5.3,
5.4, 5.5 and 5.7 are approved, see the decisions log in section 7 and the plan changes in
section 8. 5.6 needed no decision.

### 5.1 APPROVED: per player chemistry requirement

There is no per player chemistry requirement. The reference project models
`PlayersChemistryPointsRequirement`, and SBCs of the form "every player must have at least
N chemistry" do exist. Section 4.4 only has `teamChemistry` with `op: 'min'`, which is the
squad total. These are different constraints and a squad can satisfy the total while failing
the per player floor.

Proposed addition:

```ts
| { type: 'perPlayerChemistry'; op: 'min'; value: number; count?: number }
```

`count` omitted means all 11, matching the `minPlayerRating` convention you already set.
**Approved and added to the union.**

### 5.2 APPROVED: kill the closed `Rarity` union

`type Rarity = 'common' | 'rare' | 'totw' | 'icon' | 'hero' | 'promo'` collapses every promo
into one value, then Section 2 separately carries `promoName?: string` and Section 4.4 has
both `cardTypeCount` keyed on `Rarity` and `promoCount` keyed on a promo name. FUT has dozens
of distinct rarity IDs and `cardTypeCount { rarity: 'promo' }` is not a constraint anyone can
express meaningfully.

**Approved, and taken further than I proposed.** The closed union is removed entirely.
Card type is an **open string** keyed off FutDB's card types, because new promo classes land
constantly and a closed union would need a code change every fortnight. `cardTypeCount` keys
on that open string.

Readability is preserved by **derived helpers** rather than by stored booleans:
`isRare`, `isTotw`, `isIcon`, `isHero` and a coarse `cardTypeGroup` are all computed from the
card type registry. The registry is the same file that carries the chemistry contribution
weights from 2.1, so there is exactly one place where a new promo class gets described.
`isWomens` stays a stored field because it is not derivable from card type.

### 5.3 Section 2's `OwnedCard` mixes two identity models

`id: string` plus `quantity: number` with "duplicates collapse into one row", against the
rule in the same section that "duplicates are separate submittable items, do not dedupe them
away". Both can be true, the row is a stack and the solver treats it as `quantity` distinct
submittable units, but it needs saying explicitly or someone will write `usedCards.has(id)`
and silently cap every stack at one. I will implement it as a stack with an integer usage
variable in the CP-SAT model rather than a boolean, and I will comment it. No change needed
to your spec, just recording the interpretation.

### 5.4 APPROVED: queue mode gets its own time budget

"Under 5 seconds on a 600 card club" is reasonable for a single challenge with the rating
combination pruning doing its job. Section 6.3 queue mode is a different problem: joint
optimisation across many challenges with a global no reuse constraint is combinatorially
much larger, and 6.1 repeat mode with N large is too. Holding queue mode to 5 seconds will
either be missed or met by silently returning a worse answer.

**Approved.** The 5 second target stays for single solves only. Queue and repeat modes get
their own configurable budget defaulting to **60 seconds**, with **anytime behaviour and
progress reporting**, and a result clearly labelled "best found, not proven optimal" on
timeout. Never an invalid squad. The correctness guarantee is untouched, only the wall clock
promise moves.

### 5.5 Section 3.2's OCR target needs a caveat

"My whole club in under ten minutes of screenshotting and a handful of review clicks" is a
fine goal. The risk is not the OCR of name and rating, that part is tractable. It is that a
club page tile does **not** show rarity reliably at tile size, does not show `untradeable`,
`isLoan`, `locked` or `inActiveSquad` as text, and shows position only for some layouts.
Several of those are the exact fields Section 7.1 uses to decide what is safe to burn.

I will build 3.2 as specified. Flagging now that the intake pipeline will need either the
in game filters used deliberately, screenshot the loans view separately, screenshot the
untradeables filter separately, or an explicit post import pass in the club table. Cheap if
planned, painful if discovered at checkpoint 13.

### 5.6 Section 10, stack

No strong argument for a different stack. Next.js 15 plus TypeScript plus Tailwind is fine,
a Python FastAPI sidecar is the right call because OR-Tools CP-SAT and OpenCV both live
there, and pure TS rules in `src/rules/` with Vitest is exactly right for the part that has
to be provably correct. I accept Section 10 as written.

One observation, not a request to change: Prisma is heavier than a single user local SQLite
file needs, and its migration flow will be the slowest part of the dev loop. It is not wrong,
and Section 12 says do not change what you did not ask for, so I am building it as specified.

### 5.7 Section 1.2

No exception found, and I am not looking for one. Reviewed specifically against the reference
product in Section 1 above, whose entire distribution model is the thing Section 1.2 forbids.
The architecture stands: this tool reads images I am given and does maths, and has no code
path that resolves an EA hostname. I would like to add one CI guard, a test that greps the
built output for EA domains and fails the build if any appear, so that this cannot regress by
accident. Say the word and I will add it, it is about ten lines.

---

## 6. Ground truth fixture schema: per player chemistry

**Changed on instruction, and it is the right call.** A squad total of 27 can be produced a
dozen different ways, so a total only fixture cannot tell us which threshold misfired. The
fixture schema now stores **every player's individual chemistry value** alongside the squad
total.

- `displayedPlayerChemistry` is 11 integers in slot order.
- The fixture entry UI asks for those 11 values plus the squad rating and squad chemistry,
  and **cross checks that the individual values sum to the stated total before saving**.
  A mismatch is a data entry error and is rejected at the form, not stored and puzzled over
  later.
- The harness asserts per player values as well as the totals, so a failure names the
  player and the category rather than just saying the squad is wrong.
- `displayedChemistry` and `displayedPlayerChemistry` may both be null for a fixture that
  only exercises the rating path. `gt-001-floor-vs-round` is exactly that case: it settles
  `floor` versus `round` and says nothing about chemistry, so demanding 11 chem values for
  it would be noise.
- `pending_verification: true` marks a fixture whose expected values are the documented
  behaviour rather than an observed in game reading. The harness runs it and reports it,
  visibly flagged, and does not treat it as ground truth until the flag is cleared.

## 7. Decisions log

**Moved to `RESEARCH-ARCHIVE.md`.** The verbatim record of every decision taken in conversation, kept so nothing depends on chat scrollback. Nothing in it is contradicted by what is above; it is history rather than specification.

---

## 8. Plan changes

### 8.1 Prices: a price by rating table, not per card prices

FutDB prices are premium only and there is no bulk endpoint even then, so FutDB is out as a
price source for now. **The file backed `PriceProvider` becomes the primary implementation,
not the fallback.**

More importantly the shape changes. For SBC solving the cost of a *specific* card is almost
never the question. Fodder is fungible, so the question is **the cheapest price at each
rating**. That is roughly 40 numbers, one per rating from about 60 to 99, typed in five
minutes and refreshed weekly.

- Primary price model is a **price by rating table**, keyed on rating, with an optional
  second dimension for rare versus common where the gap matters.
- **Per card overrides** layer on top, for anything genuinely expensive or specific.
- Section 8's cost model sources from that table.
- The table carries a **last updated date, surfaced in the UI**, so staleness is visible.
- The `PriceProvider` interface stays intact, so a premium FutDB implementation can drop in
  later without touching the cost model.

### 8.2 Club intake status fields, and their provenance

Club tiles do not reliably show rarity and never show `untradeable`, `isLoan`, `locked` or
`inActiveSquad`, which are exactly the fields Section 7.1 uses to decide what is safe to
burn. Separate filtered screenshot passes for loans and untradeables, tagged on import,
is the answer for three of the four.

**`inActiveSquad` is different and does not come from a club filter pass.** It comes from
screenshotting the **squad screen itself**, which is authoritative and is only 18 cards.
More reliable and less work.

Defaults are explicit: a card not seen in a status pass is **not a loan, not in an active
squad, and tradeable**. But **the provenance of each of those four fields is recorded per
card**, whether it came from a pass or was defaulted, and the club page shows a coverage
figure. "Untradeable status known for 210 of 612 cards", not a quiet assumption.

### 8.3 Queue and set mode: one model, one pool

A set is several challenges that must ALL complete; a queue is any mix of one offs, sets
and repeats. Both are solved **jointly against the same club** rather than one at a time,
because solving in sequence burns the good fodder on the first item and then fails on the
fourth. Neither restates requirement logic: both compose `add_challenge`, and queue mode
reports its supply picture through the existing grind planner rather than a second one.

Two things made this work:

- **Requirements are enforced only on squads that are actually built.** `add_challenge`
  takes an optional `active` literal and gates every constraint on it. Without that gate an
  unbuilt squad fails its own minimums and a queue the club cannot fully feed comes back
  infeasible instead of partially solved.
- **The objective is lexicographic**, build weighted by priority first and spend least
  second, on the same `cost x (max + 1)` scale as repeat mode. Priority is what decides who
  gets the scarce fodder.

Set level infeasibility is reported **per challenge**, not as one failure for the set.
"Challenges 1, 2 and 4 solvable, 3 fails on minimum 2 TOTW" is actionable; "the set failed"
is not.

### 8.4 CONTENTION: the fifth kind of cause

Diagnosis had four modes: `requirement`, `requirement_pair`, `supply`, `unexplained`. There
is a fifth, and queue mode is where it appears.

The first mixed queue run produced a straight contradiction. Item `set: challenge B` was
diagnosed as blocked by "the pool, though it holds enough cards at every rating" while the
grind planner, in the same output, said buying 1x85 and 2x86 would unlock it. Both were
right about different pools. The diagnosis ran against the **whole club**; the planner knew
the other twelve squads had already spent it.

**Contention is exactly "buildable alone, not buildable here", so that is the question asked
first.**

- Feasible alone, short in the queue: `mode="contention"`. It names the rivals at or above
  this item's priority and gives the three real fixes: raise this item's priority, drop one
  of those, or buy more fodder. The detail is then taken from the **residual** pool, what is
  left after everyone else has taken their share, so the numbers agree with the planner.
- Not feasible alone: the cause is intrinsic to the item, so the **whole club** is the right
  pool to diagnose against. Against the residual an impossible requirement reads as "the
  club is running out of cards", which is true of the leftovers and useless as advice. This
  distinction cost a test to find and is asserted in
  `test_an_item_that_could_not_be_built_ALONE_keeps_its_real_cause`.

An item that is alone in the queue can never be reported as contention. There is nobody to
blame but the club.

**The contradiction had a second half, in the planner.** The planner decides whether a
challenge is blocked by comparing what the queue built against its own per challenge
ceiling. Those two numbers come from two different optimal solutions of a degenerate
objective: when two challenges carry the same priority and the club can feed only one of
them, which one gets the squad is an arbitrary tie break, and the two solvers are free to
break it opposite ways. A challenge nothing was blocking then got flagged, reported as
"the club can feed 1 squads but only 0 can be built. Buying cards would not help", and had
its baseline read off the planner's tie break rather than what was really built, which made
the first purchase step offer a squad back "for nothing".

So when the real counts are known, each challenge is re ceilinged with every OTHER challenge
**held at what it actually achieved**. That asks the only question a flag should turn on:
with the rest of the queue as it stands, could this one have done better? If not, it lost
the race rather than hitting a wall, and that is reported per item as contention, not as a
block.

**Prices come from the whole club, counts from what is left.** HOW MANY cards are missing is
a question about the residual pool. HOW MUCH EACH costs is a question about the market, so
`_Search` carries an optional `price_pool`. Without it, a rating the queue had spent down to
zero read as having no price at all while the planner quoted it by name in the same output.

### 8.5 Multi solution diversity

`solve_alternatives` re solves with a hard difference constraint rather than reranking one
solution. Each new squad must share at most `SQUAD_SIZE - min_difference` cards with **every**
earlier one, not just the last, which is enforced with a per card overlap variable so
duplicate quantities count correctly. **Pinned cards are excluded from the difference
requirement**, otherwise a pin and a large K are contradictory and the search reports
exhausted when it is only over constrained. Running out is reported honestly, "Only 1 of 5
found", not as a failure. Count is capped at 20.

### 8.6 Checkpoint 12: impossibility diagnosis, folded in rather than added beside

No fourth path. `diagnose_impossibility` is a front door onto the requirement, pair,
supply and depth machinery that repeat mode, set mode, queue mode and the grind planner
already share. Three things were added, and all three live inside that machinery so every
caller gets them.

**Binding constraint identification, with the number.** Naming the requirement is half an
answer. "min 9 from Serie A blocks this" leaves the reader to work out whether they are one
card short or five. Every mode that names a requirement now carries a `ClubLimit`: the
tightest value this club could actually meet with every other requirement still in force,
found by bisection against the real pool. "Your club can manage at best 6, 3 short of the 9
asked for."

The old code loosened by 1, 2 and 3 and gave up, which answers "is it close" but never "how
far". The span is found by **doubling first, then bisecting**, the same idiom as
`largest_feasible`, rather than from a formula. A formula would have to know what the value
means: `max 3` on a league count loosens toward eleven, `max 84` on a player rating loosens
toward ninety nine, and that difference is a game rule this service is not allowed to hold.
Doubling until it works needs to know nothing. The ceiling comes from the data, the highest
rating in the club, not from a rule.

**The minimal blocking set.** Singles find one blocker, pairs find two, and an SBC whose
requirements only conflict three at a time fell off the end of both and came back as
unexplained. A deletion filter walks the list once, dropping any requirement the problem
stays infeasible without, in `|R|` checks rather than the pair search's `|R|` squared.

**The two are not the same kind of statement, and the wording says so.** Singles and pairs
report a set whose REMOVAL unblocks the squad. The deletion filter returns a set that is
INFEASIBLE ON ITS OWN and minimally so. Removing one member of a minimal infeasible set
makes that subset feasible, but the whole challenge can still fail on a second conflict. So
the sentence is "these three conflict with each other against your club, no proper subset
of them is impossible, dropping any single one settles THIS conflict, though the challenge
may still fail on another", and not the stronger claim the filter never checked.

The filter also detects for free that the requirements are not the cause: if the problem is
still infeasible with every requirement removed, it returns nothing and the diagnosis falls
through to supply, where it belongs. When it does, the unexplained text is upgraded from
"no requirement loosened by up to 3 unblocks it" to "removing EVERY requirement does not
unblock it either, so the requirements are RULED OUT rather than merely unproven".

**Universal conflicts stay on the TypeScript side.** A contradiction between requirements is
a fact about the SBC and true for everyone; `detectConflicts` decides that, and the answer
is passed in as a list of sentences. When it is non empty the club is never consulted at
all, because telling someone their club is short of Serie A cards for an SBC nobody could
build sends them shopping for nothing. The Python service does not and must not derive it.

**The single solve stopped shrugging.** `SolveResponse.reason` on an infeasible single solve
was "no squad in the available pool satisfies these requirements", which is precisely the
sentence this checkpoint exists to replace. It now carries the diagnosis. Two guards: a
diagnosis that throws degrades to the old sentence plus the error rather than turning a
clean infeasible into a crash, and a diagnosis that comes back SOLVABLE, which can happen
because it does not enforce pins or exclusions, says the limit is in the pins, the
exclusions or the exact rating multiset rather than printing two contradictory sentences.

### 8.7 The usable path: CSV in, command line out

Checkpoint 2 is blocked on a FutDB key and its real rate limits, and neither may be
invented. Everything downstream of a card database was therefore unreachable, which is
a bad place for a tool to sit. Three things fix that without touching the blocker.

**A source agnostic CSV loader, not a FutDB substitute.** `src/data/cardDefinitions.ts`
takes a `ColumnMap`, so the column NAMES are data rather than something an export has to
be edited into. It is the other half of the same requirement, not a stand in: a card
database that can only arrive over one vendor's API has a single point of failure.
Nothing is guessed. A row missing a required field is an error carrying its line number,
a duplicate defId is an error, and an unrecognised yes or no value is an error rather
than a quiet false. The league and club COLUMNS are required even though their CELLS may
be blank, because an Icon has no league and a file that omits the columns cannot be told
apart from one that forgot them.

**A synthetic sample dataset, labelled as such.** `data/sample/` holds 445 invented card
definitions, a club of 824 cards and an invented price table, generated by a seeded
script so the files are reproducible. Its README says in the first line that none of it
is evidence about EA FC 26. Its club is deliberately imperfect: the locked pass was never
run, so the coverage report has something true to say.

**Provenance survives the import.** `src/data/clubImport.ts` records per card whether each
of the four status fields was observed or defaulted, and the coverage line counts CARDS
rather than stacks, because a stack of six untradeable duplicates is six cards whose
status is known.

### 8.8 A number that looked like coins and was not

Running the command line end to end surfaced a real defect that no unit test had caught.
The shortfall diagnosis priced a rating from the cheapest card of that rating in the pool,
using `PoolCard.cost`. That field is the WEIGHTED figure the solver minimises: with the
untradeable weighting applied it can be 50 for a card that lists at 4200. The output read
"short 4 cards rated 86, 50 each from the pool", which is a shopping list priced at a
fiftieth of the truth, and it is exactly the failure mode the price audit was about.

`PoolCard` now carries `market_price`, what one copy would cost to buy, and that is the
only field a shortfall is priced from short of the price table. The `cost` fallback is
gone rather than kept as a last resort: a wrong number gets acted on, a missing one gets
asked about. `rating_prices` is also threaded through `_Search` so repeat and queue mode
price their shortfalls from the table the caller supplied, which previously only the
grind planner used.

### 8.9 node:http rather than fetch, and why it is not taste

The ten squad solve takes several minutes. `fetch` hands undici a 300 second headers
timeout that cannot be reached from the calling code, so the request died with "fetch
failed" while the solver was still working happily: a wrong answer dressed as a network
error. The client is a `node:http` request with no socket timeout by default and an
explicit `--timeout` flag. This is a local socket to a process on 127.0.0.1, and the right
default is to wait.

### 8.10 Checkpoint 14: the UI, and what it deliberately does not have

Next.js 15 App Router, Tailwind, dark, function over form, as the brief asked. Seven pages:
club, intake, SBC library, queue and solve, results (inside solve, because a result with no
squad in front of it is a page nobody visits), grind planner, history with the fodder
ledger, and fixture entry.

**One implementation, two front ends.** `app/lib/server.ts` is the only place the pages
reach the club, the solver or the rules engine, and it reaches them through the same
`buildPool`, `loadState` and `SolverClient` the command line uses. The two read the same
`data/club/state.json`, so an import made in one is visible in the other. Nothing in `app/`
re-implements a rule, a cost or a requirement.

**Every returned squad is re-validated in the browser's server component, not trusted.**
`app/lib/solve.ts` rebuilds each squad as a `Squad` and runs `calculateSquadRating`,
`calculateChemistry` and `validateSquad` over it. Where the Python service and the rules
engine disagree, the squad card prints MISMATCH in a red box rather than preferring either.

**The unverified banner is on every page.** Not an about box, not a footnote. Eleven rule
values are inferred rather than observed and any of them could change a returned squad.

**The screenshot drop zone is a labelled empty state.** OCR needs a real player database to
match names against and that loader is blocked. A drop zone that half worked would be worse
than one that says it does not, so it says it does not, and says why.

**Mark as submitted is the one place a report writes back.** After a submission the cards
really are gone, and a club that still lists them will solve with cards that do not exist.
It REFUSES rather than clamping: if the club holds fewer copies than the squad used, the
club and this tool have already diverged and quietly taking what is there would hide it.

**The paste parser never silently drops a line.** `parseRequirementText` returns every line
of the pasted text, parsed or not, with its line number and the reason it was not
understood, and the page shows all of them before anything is saved. A parser that ignores
what it does not understand produces a squad that satisfies four of five requirements and
looks like a success. It also never guesses a number from a word: "Rare: a few" is an
unrecognised line, not a 3.

**Fixture entry calls the same `validateFixture`.** A fixture that the engine disagrees with
is still saved, and the disagreement is reported as a FINDING rather than an error, because
the fixture is what the game displayed and the engine is the thing under test.

### 8.11 The second audit: incompleteness reported as fact

`SECOND-AUDIT.md`, over the solve loop and the queue and set paths, asking a different
question from the first one: **where does a result that means "we did not finish looking"
get reported as "we looked and it is not there"?**

One line is behind most of it. `_Search.feasible` returns a `bool`, and CP-SAT returns four
states. `UNKNOWN` means the budget ran out, and collapsing it into `False` makes "we could
not find one" indistinguishable from "there is not one". That is not a bug in `feasible`, a
predicate has to return a bool; it is a bug in everything that used the answer without
asking whether it was reliable.

Five paths produced a false or misleading sentence, and all five are fixed:

1. **Every diagnosis mode.** `_Search` now counts probes that came back `UNKNOWN`, and
   `_diagnose` stamps every answer with how many probes behind it never finished, in the
   explanation itself rather than in a separate field. A caveat only counts if it is where
   the number is.
2. **The planner's baseline.** An empty `GrindPlan` used to render as "Nothing left to
   unlock by buying: the queue is fully fed", which is the OPPOSITE of the truth produced by
   a timeout. It now says "NO PLAN... this is not the same as there being nothing to buy".
3. **The purchase step loop**, which broke on the first unsolved step and said nothing about
   the ones never looked at. Now "UNKNOWN beyond that, not nothing".
4. **The queue's empty outcome**, which rendered a row of zeroes whether the model proved
   impossibility or ran out of time. Those are now different sentences.
5. **`solve_alternatives`.** `exhausted` was set by a timeout as well as by a proof, so a
   timeout printed "the pool has no further squad differing by 3 cards" when nobody had
   checked. `exhausted` and `timed_out` are now separate.

Item 5 is the one to remember. **The first pass of this audit waved it through**, on the
strength of its output wording, and the code said something different. The first audit had
the same reversal in its item 5, on prices. Reading what a path prints is not the same as
reading what it does.

## 9. Still open

| Ref | Item | Status |
|---|---|---|
| 0.3 | FutDB free tier request limit, and which endpoints 403 on a free key. | Blocked on you registering a key. The loader reads limits from headers or config and is written without them. Checkpoint 2 stays blocked; `data/sample/` stands in so nothing downstream is stuck. |
| 13 | Screenshot OCR intake. | Blocked on checkpoint 2's database to match names against. No placeholder path has been built and no database has been synthesised to unblock it. |
| P-001 | 95 plus ten 84s, which settles `floor` versus `round`. | Pending your in game reading. Flagged in every test run and named in the startup warning. |
| P-002 | Festival of Football Captain chemistry contribution. | Pending. `alwaysMaxChem` is inferred by analogy with Icons and Heroes. |
| P-004 | Formation slot labels. | Pending. Rebuilt from the public formation list rather than extracted game data, and the positioning gate compares slot labels exactly. |
| P-005 | Club and league ladder probes. | Pending. Squad B first: it pins league +2 at 5 separately, which is what makes Squad A decisive. |
| P-007, P-008 | League +3 at 8 and nation +3 at 8. | Pending, and observable, so they are in the live tier rather than the unobservable one. |

**Resolved since the first pass**, kept here only so the trail is not lost: 4.2's
counterintuitive behaviour question, closed by you deleting the sentence from the brief;
5.1, 5.2, 5.4, 5.6 and 5.7, all approved and implemented; 5.7's proposed CI guard against
EA hostnames, now a test in both suites rather than an offer.
