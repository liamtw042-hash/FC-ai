# CLAUDE.md

Standing rules for this repo. These override the ask-first instructions in the original
brief and in `RESEARCH.md`.

## Default: decide it yourself and keep going

No decision request for anything that can be reasoned out. Make the call, record it in the
decisions log in `RESEARCH.md` with one line of reasoning, and carry on. Do not stop at
checkpoints for approval. Work through the build order continuously.

When choosing between options and one is clearly better, take it. When they are genuinely
close, take the one that is easier to reverse later and say so in the log. A decision the
owner disagrees with, recorded and reversible, costs far less than being asked.

This explicitly covers, and must not be asked about: test naming and coverage, refactors,
type and schema shapes, library choices, error handling, naming, file layout, reordering
the build order, adding missing tests, generalising something narrow (the club alias table
is name normalisation, treat it as such), and fixing anything in the brief that turns out
wrong. The brief is a starting point, not scripture. Where it is wrong, fix it, log it,
move on.

## Stop and ask only for these

1. Readings only the owner can take, because they require the game open. See `PENDING.md`.
2. Credentials and accounts. API keys, signups, anything costing money.
3. Anything touching Section 1.2. Never revisited, never worked around, no exceptions, and
   there is no need to ask because the answer is always no.
4. Destructive or irreversible actions. Force pushes, history rewrites, deleting club data,
   publishing anything.

That is the whole list.

## Pending queue

`PENDING.md` in the repo root is a single running list of everything needed from the owner.
Each entry has an id, exactly what to do, what to report back, and what it unblocks. Append
as items arise.

**Never block on it.** For anything unverified: implement the best supported value, mark it
`verified: false` in the data, surface it in the startup warning the way `gt-001` already
does, and keep building. If a later reading contradicts it, change the value and add the
observed case as a fixture.

The queue is cleared in batches. Assume days, not minutes.

## Reporting

Report at milestones, not checkpoints. A milestone is a working slice: the rules engine
complete, the solver returning a provably cheapest squad, multi SBC solving working, intake
working, the UI usable.

Each report: what now works, what was decided and why briefly, what is unverified and how it
is flagged, what is in `PENDING.md`. Skip passing test lists unless something surprised you.
If something surprised you, lead with it.

More than a day of work from the next milestone: one short progress line, no permission
request.

## Quality bar

- Rules engine changes ship with tests in the same commit.
- Never return an invalid squad. Never return a suboptimal one without labelling it.
- Anything inferred rather than observed is marked `verified: false` and surfaced at startup.
- Work on `feat/` branches, merge to `main` when tests pass, never push to `main` directly.
- Never commit club data or API keys.
- No em dashes anywhere.

## The one unforgivable thing

Silently guessing on a game rule and letting passing tests make it look verified. Tests
prove the code matches the spec. They do not prove the spec matches the game. Keep that
distinction visible in the code and in every report.
