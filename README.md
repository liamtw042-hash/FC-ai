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
src/rules/      the rules engine, pure TS, zero dependencies, Vitest    (checkpoint 3+)
data/seed/      player database seed and schema mapping                 (checkpoint 2)
data/club/      my club data, gitignored, example files only
data/screenshots/  screenshot intake, gitignored
tests/fixtures/ ground truth squads captured from the real game         (checkpoint 5)
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
