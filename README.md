# FC-ai

A personal use SBC solver for EA FC 26 Ultimate Team. Runs on localhost, single user,
no deployment.

**Input:** my club, my SBC storage, my exclusions, and one or more SBC definitions.
**Output:** the cheapest valid squads, placed into formations, with every requirement
shown as passing. Or a precise explanation of what makes the challenge impossible.

## The hard line

This tool never talks to EA. There is no web app automation, no browser extension, no
calls to EA endpoints, no session or cookie capture, no credential handling, no request
replay, no auto pack opening and no auto squad submission.

It reads screenshots I take myself and does maths on them. That is the whole architecture
and it is not up for revision. EA groups third party software that performs tasks in the
Web App with bots and auto buyers, and people have been permanently banned for exactly the
auto SBC feature this tool deliberately does not have.

## Start here

**`QUICKSTART.md` builds ten 85 rated squads from a standing start.** It is checked
by `npm run quickstart`, which runs the page top to bottom and fails if the last
step does not come back with ten of ten.

## Status

Checkpoints 1 and 3 to 12 are done: the rules engine, the ground truth harness,
the rating enumerator, the CP-SAT solve with chemistry and placement, the cost
model, multi solution diversity, repeat, set and queue modes, the grind planner
and the impossibility diagnosis. The command line drives all of it.

**Blocked, and staying blocked:**

- **Checkpoint 2, the real player database loader.** Needs a FutDB key and the
  real rate limits, and neither may be invented. `data/sample/` is a synthetic
  stand in so everything downstream can be run today. It is not evidence about
  anything.
- **Checkpoint 13, screenshot OCR.** Needs checkpoint 2's database to match names
  against. There is no placeholder OCR path and no synthesised database.

Checkpoint 14, the UI, is built: club, intake, SBC library with the paste parser,
queue and solve, results, grind planner, history with the fodder ledger, and
fixture entry. Its intake page has a CSV importer and an autocomplete quick add;
the screenshot drop zone is a labelled empty state rather than a placeholder,
because OCR is blocked on the same database checkpoint 2 needs.

See `RESEARCH.md` for the findings and decisions, and `PENDING.md` for the in game
readings that would clear the rule values this build has not verified.

## Layout

```
src/types/      shared TypeScript types, no logic
src/rules/      the rules engine, pure TS, zero dependencies, Vitest
src/solver/     cost model, chemistry wire format, rating modes, queue guards
src/data/       CSV loaders: card definitions and club intake with provenance
src/cli/        what the command line is made of, so it can be tested
app/            the Next.js UI, App Router, dark, function over form
app/api/        route handlers: import, lock, parse, solve, queue, history, fixtures
solver/         Python CP-SAT service, FastAPI, localhost only
scripts/fcai.ts the command line
scripts/        fixture entry, sample data generator, branch and tree guards
data/sample/    SYNTHETIC card database, club and prices, committed on purpose
data/club/      my club data and CLI state, gitignored
data/sbc/       my SBC library, gitignored, worked examples in data/sample/sbc/
data/screenshots/  screenshot intake, gitignored                       (checkpoint 13)
tests/fixtures/ ground truth squads captured from the real game
```

## Where the game rules live

**All of them are in `src/rules/`, and nowhere else.** That is the only
implementation under ground truth verification, and it is the one that decides
whether a squad is valid.

The Python solver is a constraint compiler that knows no game rules. Rating maths
never reaches it: TypeScript enumerates the rating multisets and asks the solver to
fill an exact one. Chemistry ladders and card contribution weights are passed in as
data. Every squad the solver returns is re-validated by the TypeScript engine before
it reaches the user, so if the two ever disagree the authoritative one wins and the
disagreement is visible.

## Commands

```
npm test              rules engine, Vitest
npm run typecheck     strict TypeScript
npm run solver:test   CP-SAT model, pytest
npm run test:all      both
npm run dev           start the solver and the web app together
npm run solver:dev    start just the local solver service on 127.0.0.1:8000
npm run build         production build of the web app
npm run quickstart    run QUICKSTART.md end to end and check the answer

npm run fixture:template 4-4-2 > squad.json    ground truth entry
npm run fixture:add squad.json                 validate, score, store
npm run fixture:check                          run every fixture
```

### Running it

One command starts both processes:

```bash
npm install
npm run solver:install
npm run dev                   # solver on :8000, web on :3000, output labelled
```

Then open http://127.0.0.1:3000. Or run just the solver, if you only want the
command line:

```bash
npm run solver:dev            # 127.0.0.1:8000, leave it running
```

The command line, in another terminal:

```bash
npx tsx scripts/fcai.ts help
npx tsx scripts/fcai.ts import cards data/sample/cards.csv
npx tsx scripts/fcai.ts import club data/sample/club.csv
npx tsx scripts/fcai.ts import prices data/sample/prices.json
npx tsx scripts/fcai.ts status
npx tsx scripts/fcai.ts sbc add data/sample/sbc/eighty-five.json
npx tsx scripts/fcai.ts solve "eighty five" --repeat 10 --time 180
```

`QUICKSTART.md` explains what each of those prints and why.

### The test split

`npm run solver:test` runs the whole Python suite, which is around ten minutes:
most of it is real CP-SAT searches over real pools, and they are slow because the
thing they are testing is slow. `npm run solver:test:fast` skips everything marked
`@pytest.mark.slow` and finishes in seconds, which is the one to use while
editing. **The fast split is not a substitute for the full one**: the slow tests
are where repeat, set and queue mode are actually exercised, so the full suite is
what has to pass before a merge. `npm test`, the TypeScript side, is seconds
either way.

## Conventions

- Branch as `feat/<thing>`, merge to `main` when tests pass.
- Small commits, plain messages, no emoji.
- Rules engine changes ship with tests in the same commit.
- Club data is never committed. `data/club/*.json`, `data/club/*.csv` and
  `data/screenshots/` are all gitignored. Example files only.
- No em dashes in code, docs or UI copy.

## Licence

MIT. See `LICENSE`.
