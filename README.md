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

## Status

Checkpoint 1 of the build order. Repo, `RESEARCH.md` and the type definitions.

See `RESEARCH.md` for the Step 0 findings and for the open questions that block
checkpoint 2.

## Layout

```
src/types/      shared TypeScript types, no logic
src/rules/      the rules engine, pure TS, zero dependencies, Vitest
solver/         Python CP-SAT service, FastAPI, localhost only
scripts/        CLI tools, currently ground truth fixture entry
data/seed/      player database seed and schema mapping                 (checkpoint 2)
data/club/      my club data, gitignored, example files only
data/screenshots/  screenshot intake, gitignored
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
npm run solver:dev    start the local solver service on 127.0.0.1:8000

npm run fixture:template 4-4-2 > squad.json    ground truth entry
npm run fixture:add squad.json                 validate, score, store
npm run fixture:check                          run every fixture
```

## Conventions

- Branch as `feat/<thing>`, merge to `main` when tests pass.
- Small commits, plain messages, no emoji.
- Rules engine changes ship with tests in the same commit.
- Club data is never committed. `data/club/*.json`, `data/club/*.csv` and
  `data/screenshots/` are all gitignored. Example files only.
- No em dashes in code, docs or UI copy.

## Licence

MIT. See `LICENSE`.
