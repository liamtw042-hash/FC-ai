# RESEARCH.md

Step 0 output. Findings first, then everything in the brief I think is wrong,
unverified, or blocked. Nothing beyond checkpoint 1 of Section 11 has been built.

Date of research: 2026-08-19.

---

## 0. Read this first: two blockers before any more code

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

### 0.2 The dataset premise in Section 3.1 is only half true

Section 3.1 assumes "a current public FC 26 player dataset" exists that carries
rating, positions, nation, league, club, **rarity, promo, TOTW, Icon and Hero**.

What actually exists publicly, and what I found:

- Kaggle FC 26 datasets (`rovnez/fc-26-fifa-26-player-data`, `flynn28/eafc26-player-database`,
  `talhademirezen/fc-26-player-stats`, `justdhia/ea-sports-fc-26-player-ratings`) and
  the GitHub project `ismailoksuz/EAFC26-DataHub` which consumes one of them.
  Roughly 16,000 to 18,000 rows, 110+ attributes.
- **These are career mode / sofifa style scrapes.** They carry base overall, potential,
  age, contract, pace/shooting/passing and so on. They are keyed to a footballer, not
  to an Ultimate Team card. They contain no `defId` per card version, no rarity, no
  promo name, no TOTW, no Icon or Hero items, and no women's items in most of them.
- Licence could not be confirmed. Kaggle is blocked, and `EAFC26-DataHub` declares no
  licence on its landing content. Treat all of them as unlicensed until checked.

A career mode dump gets you base gold cards and nothing else. An SBC solver that only
knows base golds cannot model "min 1 TOTW", "min 3 rare", `promoCount`, Icons, Heroes,
or the Festival of Football items discussed in Section 2 below. That is most of the
interesting SBC surface.

Real Ultimate Team card databases: FUTBIN, FUT.GG, WeFUT, FUTNext, Futdatabase.com,
and **FutDB (`futdb.app`), which publishes a free JSON REST API covering players,
prices, nations, leagues, clubs and card types, gated on a free API key.**

FutDB is not EA, so Section 1.2 does not apply to it. But Section 8 says "do not scrape
price sites", and I am not going to decide on my own whether a keyed public API counts
as scraping. **This is decision 1 for you.** Options:

1. **FutDB API seed.** You create a free key, a one-off loader script pulls card
   definitions into SQLite. Best field coverage by far. Needs your explicit sign off
   against Section 8, and a check of their terms.
2. **You supply the dump.** You download a card export yourself on your own machine and
   drop the CSV into `data/seed/`. The loader plus schema mapping file in Section 3.1 is
   built either way, so this costs nothing extra to support.
3. **Career mode dataset only.** Ships now, works offline, but permanently cannot model
   rarity, promo, TOTW, Icon or Hero requirements. I do not recommend this.

Whichever you pick, the loader plus mapping file architecture in Section 3.1 is correct
and is what I will build. The only thing blocked is which file it eats.

---

## 1. Step 0 item 1: FUTGenie, the reference product

Read via search index only, the site is blocked. Feature set as advertised:

- Browser extension that plugs directly into the EA FC Ultimate Team web app.
- "AI powered" SBC solver that builds the cheapest valid squad for a challenge and can
  complete whole SBC sets in one click.
- Auto fills the squad in the web app, with visual indicators on selected players.
- Uses untradeable duplicates and unused club players before spending coins.
- Player locking, so the solver never touches cards you want to keep.
- Real time price overlays on player cards inside the web app.
- Free tier with a daily solve allowance, subscription for unlimited solves.

**The parts we are copying:** cheapest valid squad, dupes and untradeables first, locking,
set completion, price awareness.

**The parts we are deliberately not copying, and this is the whole point of Section 1.2:**
everything that touches the web app. Their auto fill and one click set completion are
exactly the "third party software performing tasks in the Web App" behaviour EA groups
with bots and auto buyers. FUTGenie's own feature list is the clearest possible statement
of what our architecture must not do. No exception found, nothing to raise.

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

**Not independently confirmed, needs a ground truth fixture:**

- Club +2 at 4 and club +3 at 7. Every source I could reach states the club +1 at 2 rule
  and the nation and league ladders, but none of the reachable ones spelled out the club
  4 and 7 steps. They match FC 24 and FC 25 and I have no reason to doubt them, but I am
  not marking them confirmed on inference. **Fixture needed.**
- Nation +2 at 5. Same situation, stated by inference from the shared "+3 at 8" phrasing
  rather than read directly. **Fixture needed.**

So Section 4.2's table is very probably correct and I will implement it as written. Two
of its nine numbers rest on secondary inference, and 4.3 is exactly the mechanism for
settling them. I suggest your first two hand built ground truth squads are chosen to
pin the club 4/7 and nation 5 steps specifically, rather than being arbitrary squads.

### 2.1 Disagreement: Section 4.2 is missing a card class that exists right now

FC 26 shipped **Festival of Football Captains**. Per multiple write ups (SI, MSN, inkl,
itemd2r), these items provide **three nation links, one club link and one league link**,
which is why they inherently sit at 3 chemistry alone. They are described as sitting
between a Hero and an Icon for squad building. There were 44 of them at launch with more
arriving through objectives and SBCs.

Section 4.2 models chemistry contribution as two hardcoded special cases, `isIcon` and
`isHero`. That is already out of date. EA is now shipping promo classes with bespoke
contribution weights, and it will keep doing it.

**Proposed change, not applied, awaiting your call.** Replace the boolean special cases
with explicit per card contribution weights, defaulting to 1/1/1:

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
in data. If you say no I will hardcode Icons and Heroes exactly as written, but the solver
will then produce wrong chemistry for any squad containing an FoF Captain.

### 2.2 Small note on 4.2's women's rule

"Women's players link to men's players by club and nation only, never league" is correct
as a statement about the game. As an implementation instruction it is a trap. If leagues
are modelled as distinct string identifiers, the league part needs no special case at all,
because "Barclays Women's Super League" and "Premier League" are simply different values
and never match. The part that **does** need work is the opposite one: the club link only
works if the women's club resolves to the **same club entity** as the men's club. If the
dataset gives "Arsenal Women" and "Arsenal" as two strings, club links silently break and
we will fail ground truth. So the real work item is a **club alias table**, not a league
exclusion rule. I will build it that way unless told otherwise.

## 3. Step 0 item 3: kosciukiewicz/sbc-solver

Cloned and read. MIT licence, copyright 2024 Witold Kosciukiewicz. Archived in effect:
the README states development moved to FUT Mind and MyClub and this repo is unmaintained.

**Approach, which we are ignoring as instructed:** genetic algorithm, engine written in
Rust and compiled to WebAssembly running client side. Notably the optimisation engine
itself was **never published**, only the React front end. The README says the engine code
"is planned to be published" and it was not. So there is no reference implementation of
the solving to learn from, only the data model.

**Data model, which is the useful part.** From `src/data/interfaces.ts`:

```ts
interface ClubPlayerCard {
  id, asset_id, rare_flag, card_subtype_id, name, position,
  overall, is_rare, has_loyalty, card_quality, team, league, nationality
}
```

Three things worth taking:

1. **Entities are numeric IDs, not names.** `team`, `league`, `nationality` are integers,
   EA's own internal IDs, because the extension reads EA's payloads directly. We cannot,
   so our OCR and dataset paths produce **names**. That means we need a canonical entity
   resolution layer that the reference project never needed: name to canonical club,
   league and nation id, with the alias table from 2.2 living inside it. This is real work
   that Section 3 does not currently account for. Flagging it as a build item.
2. **Card identity is `asset_id` plus `card_subtype_id` plus `rare_flag`**, which is the
   ID equivalent of the "name plus rating plus rarity plus promo" disambiguation in
   Section 3.1. Your approach is sound, it is just the lossy version of the same key.
3. **`has_loyalty` exists in their model.** Loyalty is a match chemistry concept and does
   not affect SBC validity, so we correctly do not need it. Noted so nobody adds it later.

**Their requirement enum**, which is a useful cross check on Section 4.4:
`PlayerQualityRequirement, OverallRequirement, ChemistryRequirement, LeagueCountRequirement,
ClubCountRequirement, NationCountRequirement, SameNationCountRequirement,
SameClubCountRequirement, SameLeagueCountRequirement, PlayersChemistryPointsRequirement,
PlayerCountRequirement, NotImplementedRequirement`.

Section 4.4 covers all of these except one. See 5.1 below.

**`src/assets/formations.json`** contains 30 formations mapped to 11 position slots each,
plus a legacy `positionBonusTable`, `chemLinks` and `bonusValues`. The formation to slot
mapping is directly useful. The other three tables are **pre FC 24 link based chemistry**
and are dead weight for us: `positionBonusTable` awards partial values of 2 and 1 for
related positions, which is the old model, not the binary in position gate FC 26 uses.
Do not let that file's existence tempt anyone into reintroducing partial position chemistry.

Licence wise the repo is MIT, but that JSON is extracted EA game data, so the MIT grant
does not really speak to it. I will rebuild the formation table from the public formation
list rather than vendoring their file, unless you would rather I vendor it with attribution.

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

I believe `floor` is correct, that is the community consensus and it matches how the game
displays squad rating. But I am not going to ship a solver whose entire rating layer rests
on my belief. **Decision 2 for you: please build 95 + 10x84 in game and tell me the
displayed rating.** It is one squad and it settles the question permanently. I will add it
as the first entry in `tests/fixtures/ground-truth.json` either way, and I will add the
`floor` versus `round` discriminator as an explicit named unit test so it can never silently
regress.

Separately, note that `fifauteam` publishes the squad rating formula as `SR = (SUM + CF)/18`.
That is the **18 man squad** rating including the 7 substitutes, which is what the club
screen shows. SBC requirements are evaluated on the **11 starters**. Your `/11` is the right
one for this tool. Recording it here so that when someone later finds the `/18` version they
do not "fix" our formula.

Section 4.1's warning about upgrading your worst player lowering the rating is correct and
falls straight out of the maths. It will be preserved and I will add a test that asserts it,
so nobody "fixes" that either.

## 5. Disagreements and gaps in the rest of the brief

Numbered so you can answer by number. Nothing here has been acted on.

### 5.1 Section 4.4 is missing a requirement type that real SBCs use

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

### 5.2 Section 2's `Rarity` union is too narrow to survive a season

`type Rarity = 'common' | 'rare' | 'totw' | 'icon' | 'hero' | 'promo'` collapses every promo
into one value, then Section 2 separately carries `promoName?: string` and Section 4.4 has
both `cardTypeCount` keyed on `Rarity` and `promoCount` keyed on a promo name. FUT has dozens
of distinct rarity IDs and `cardTypeCount { rarity: 'promo' }` is not a constraint anyone can
express meaningfully.

Proposed: keep `Rarity` as the coarse **quality class** it is actually used for, and add a
separate canonical `cardType: string` field carrying the real rarity identifier from the
dataset. `cardTypeCount` then keys on `cardType`, `promoCount` stays as is, and the six value
union stays useful for the UI. Small change, avoids a rewrite in three months.

### 5.3 Section 2's `OwnedCard` mixes two identity models

`id: string` plus `quantity: number` with "duplicates collapse into one row", against the
rule in the same section that "duplicates are separate submittable items, do not dedupe them
away". Both can be true, the row is a stack and the solver treats it as `quantity` distinct
submittable units, but it needs saying explicitly or someone will write `usedCards.has(id)`
and silently cap every stack at one. I will implement it as a stack with an integer usage
variable in the CP-SAT model rather than a boolean, and I will comment it. No change needed
to your spec, just recording the interpretation.

### 5.4 Section 5's performance target is stated for the wrong scope

"Under 5 seconds on a 600 card club" is reasonable for a single challenge with the rating
combination pruning doing its job. Section 6.3 queue mode is a different problem: joint
optimisation across many challenges with a global no reuse constraint is combinatorially
much larger, and 6.1 repeat mode with N large is too. Holding queue mode to 5 seconds will
either be missed or met by silently returning a worse answer.

Proposed: keep 5 seconds as the single challenge target. Give queue and repeat modes their
own configurable budget defaulting to 60 seconds, with the same rule you already set, that
a timeout returns the best found clearly labelled "best found, not proven optimal", never
an invalid squad. Your correctness guarantee is untouched, only the wall clock promise moves.

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

## 6. What I need from you before checkpoint 2

1. **Dataset route.** FutDB keyed API, you supply a card dump, or career mode data only and
   accept losing every rarity, promo, TOTW, Icon and Hero requirement. See 0.2.
2. **The 95 + 10x84 squad rating.** Build it in game, tell me the displayed number. Settles
   `floor` versus `round`. See 4.1.
3. **Chemistry contribution weights**, yes or no to the data driven table in 2.1. Saying no
   means the engine is knowingly wrong for Festival of Football Captains.
4. **The four smaller items**, 5.1 per player chemistry, 5.2 `cardType`, 5.4 queue mode time
   budget, 5.7 the CI egress guard. Each is independent, answer by number.

Also worth knowing: the network restrictions in 0.1 mean any dataset download, and the OCR
accuracy measurement in 3.2 which needs your actual screenshots, have to happen somewhere
with your files and normal internet access. The rules engine, the enumerator, the CP-SAT
model and everything in Sections 4 through 7 can be built and tested here without any of it.
That is the natural order and it happens to match your Section 11 build order from item 3
onward, so the plan is to do 3 through 12 here and land 2 and 13 when the dataset question
is settled.
