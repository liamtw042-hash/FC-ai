# Quickstart

Ten 85 rated squads out of one club, from a standing start, with no browser and
nothing that talks to EA.

Every command below is real and is checked by `npm run quickstart`, which runs
this page top to bottom and fails if the last step does not build ten squads.

## What you need

Node 20 or newer, Python 3.11 or newer, and about ten minutes. The whole page
takes around seven of those, and nearly all of it is the last step: a real
optimisation over about eight hundred cards, solved as one model rather than ten.

```bash
npm install
npm run solver:install
```

## 1. Start the solver

The rules engine is TypeScript and the search is Python. They talk over HTTP on
127.0.0.1 and nothing else.

```bash
npm run solver:dev
```

Leave that running and open a second terminal for everything below.

## 2. Import a card database and a club

The sample data under `data/sample/` is **invented**: made up players, made up
clubs, invented prices. It is there because the real player database loader is
blocked on an API key, and nothing downstream of a card database can be run
without one. See `data/sample/README.md`.

```bash
npx tsx scripts/fcai.ts import cards data/sample/cards.csv
npx tsx scripts/fcai.ts import club data/sample/club.csv
npx tsx scripts/fcai.ts import prices data/sample/prices.json
```

The club import prints its coverage rather than a tick:

```
824 card(s) in 445 stack(s)
  untradeable known for 651 of 824, the other 173 DEFAULTED rather than seen
  isLoan known for 824 of 824
  locked known for 0 of 824, the other 824 DEFAULTED rather than seen
  inActiveSquad known for 824 of 824
```

Nobody ran a locked pass on this club, so `locked` is known for none of it. Those
824 cards are treated as unlocked because that is the documented default, and the
line says DEFAULTED so nobody mistakes the default for an observation.

Your own club goes in the same way. Any CSV that can name its columns works:
`--columns` is not needed for the layout above, and `src/data/cardDefinitions.ts`
takes a column map for anything else.

## 3. Look at what you have

```bash
npx tsx scripts/fcai.ts status
```

```
420 of 445 cards available. 25 excluded: 13 in active squads, 17 auto locked on rating.

Available by rating: 86x59 85x65 84x86 83x123 82x117 81x74 80x65 79x66 78x54 77x37 76x28 75x22
```

It then prints every game rule this build has NOT verified against the game, with
the PENDING.md entry that would clear each one. That list is not decoration.
Passing tests prove the code matches the spec; they do not prove the spec matches
the game, and anything on that list could be wrong in a way no test can catch.

```bash
npx tsx scripts/fcai.ts list --rating 86 --limit 5
```

## 4. Add the SBC

```bash
npx tsx scripts/fcai.ts sbc add data/sample/sbc/eighty-five.json
```

That is a one line definition: 4-4-2, team rating 85, repeatable ten times, no
other requirements. You can write one at the prompt instead:

```bash
npx tsx scripts/fcai.ts sbc define "premier four" --formation 4-3-3 --rating 84 \
  --requirement "playersFromLeague:min:4:league=Premier Division" \
  --requirement "rareCount:min:8"
```

## 5. Solve it ten times

```bash
npx tsx scripts/fcai.ts solve "eighty five" --repeat 10 --time 180
```

```
eighty five: 10 of 10 squad(s) built
  No chemistry requirement was set, so the solver spent nothing on chemistry.
  Add teamChemistry:min:N to the SBC if you want it to care
  0 coins spent, 263400 value burned. Solver cost 271200, which is the weighted
  figure it minimised, not coins
  NOT PROVEN OPTIMAL: this is the best found inside the time budget
  Squad 1: rating 85, chemistry 0, 20350 cost
    GK   84 M. Pelovic    Dornbach   Bundesklasse   Caledonia   chem 0
    ...
```

Three things in that output are deliberate.

**Ten squads are solved together, not one at a time.** Solving greedily burns the
best fodder on squad one and fails on squad seven. Every count is one model over
the whole club.

**Coins spent and value burned are separate numbers and are never added up.**
Nothing was bought, so no coins moved. What happened is that 263,400 coins of
sellable fodder stopped existing. A single "cost" figure would hide which of the
two afternoons you just had. The third number, the solver cost, is the weighted
figure the search minimises, and the line says so rather than letting it be
mistaken for coins.

**"NOT PROVEN OPTIMAL" means what it says.** The search found ten squads inside
the budget but did not prove no cheaper ten exist. Raise `--time` if you want it
to keep trying.

## 6. When it cannot be done, it says why

Ask for more than the club can feed:

```bash
npx tsx scripts/fcai.ts solve "eighty five" --repeat 14 --time 60
```

```
Blocked by the club running out of cards, not any requirement: 14 squads need 66
cards rated 85, you have 65, add 1; 14 squads need 65 cards rated 86, you have
59, add 6. All 2 of these are needed together, not instead of each other, for
27900 coins in total
  short 1 cards rated 85, 2700 each from the table
  short 6 cards rated 86, 4200 each from the table
```

"All 2 of these are needed together, not instead of each other" is there because
the model returns the cheapest SET of additions that reaches the count, so both
lines are required. It used to read as a menu of alternatives.

The diagnosis names which of five kinds of cause it is: one requirement, two
requirements together, a minimal set of three or more, the club running out of
cards, or contention with the rest of your queue. Where a requirement is named it
also says how close your club can get to it, for example "your club can manage at
best 6, 3 short of the 9 asked for". Where a rating has no price, no coin figure
is quoted at all rather than an estimate that would read like one.

## 7. A queue, and the grind planner

A queue is any mix of one offs, sets and repeats solved against one club, with
priorities deciding who gets the scarce fodder.

```bash
npx tsx scripts/fcai.ts sbc add data/sample/sbc/premier-marquee.json
npx tsx scripts/fcai.ts queue data/sample/queue-example.json --time 180
```

Every squad is printed with each requirement's achieved value next to what was
required, and the grind planner ends the report with the cheapest purchase that
would unlock one more squad, or with the fact that nothing would.

## Checking this page still works

```bash
npm run quickstart
```

It runs the commands above in order and fails if the solve does not come back
with ten of ten.

## What this tool will never do

It does not talk to EA. There is no automation of the web app, no browser
extension, no request replay, no token or cookie handling, no automatic pack
opening and no automatic squad submission. It reads files you give it and does
maths. That is not a setting, it is the shape of the thing.
