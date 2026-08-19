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

## Permanent architectural invariant

**No game rule is written down twice.**

Every rule that could be wrong about EA FC lives in `src/rules/`, which is the only
implementation under ground truth verification. The Python solver is a constraint
compiler that knows no game rules:

- Rating maths never crosses the boundary. TypeScript enumerates the rating multisets
  and asks the solver to fill an exact one.
- Chemistry ladders and card contribution weights arrive as **data in the request**,
  serialised from the engine constants by `src/solver/chemistryConfig.ts`.
- The solver holds **no defaults and no fallbacks**. A missing config or an unknown
  card type raises and the API returns 422. A guess would silently mis-score every
  squad containing that card while the tests stayed green.
- Every squad the solver returns is re-validated by the TypeScript engine before it
  reaches the user. If the two disagree the authoritative one wins and the
  disagreement is surfaced.
- `scripts/generate-chemistry-crosscheck.ts` and `solver/tests/test_chemistry_model.py`
  hold the two implementations against each other on 300 random squads, so drift
  fails a test rather than shipping.

This is not negotiable and does not get relaxed to save a round trip.

## The one unforgivable thing

Silently guessing on a game rule and letting passing tests make it look verified. Tests
prove the code matches the spec. They do not prove the spec matches the game. Keep that
distinction visible in the code and in every report.
