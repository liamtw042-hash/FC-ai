# Second audit: incompleteness reported as fact

The first audit (`SINGULARITY-AUDIT.md`) asked where a single cause, depth,
requirement or supply was reported as if it were the whole picture. This one asks
a different question of the solve loop and the queue and set paths:

> **Where does a result that means "we did not finish looking" get reported as
> "we looked and it is not there"?**

They are the same family. The first is about breadth, this one is about
confidence. Both produce a sentence that is more certain than the work behind it.

Verdicts are `complete`, `incomplete` (with what, and whether it is fixed), or
`incomplete, not worth fixing` (with why). Everything checked is listed, including
what turned out to be fine.

Audited at 526 Python tests, 356 TypeScript tests.

---

## The root cause, found first

`_Search.feasible` returns a `bool`. CP-SAT returns one of `OPTIMAL`, `FEASIBLE`,
`INFEASIBLE` and `UNKNOWN`, and `UNKNOWN` means the budget ran out. Collapsing four
states into two makes **"we could not find one" indistinguishable from "there is
not one"**, and every conclusion drawn above it inherits that.

That single line is behind items 1, 2 and 3 below. It is not a bug in `feasible`:
a predicate has to return a bool. It is a bug in everything that used the answer
without asking whether it was reliable.

---

## Solve loop, `solver/fc_ai_solver/repeat_solve.py`

### 1. Every diagnosis mode, when a probe times out
**Was: incomplete, and the worst of the set. FIXED.**

`_diagnose` runs up to `|R|` singles, `|R|` squared over 2 pairs, `|R|` deletion
filter steps and a bisection per named requirement. Each is a probe with a budget.
A timed out probe returned `False`, which reads as "removing this does not help",
and the answer came back as flat assertion: "playersFromLeague min 9 blocks this,
your club can manage at best 6".

`_Search` now counts probes that came back `UNKNOWN`. `_diagnose` snapshots the
count on entry and stamps every answer it returns with how many probes behind it
never finished, appending **"NOT A COMPLETE ANSWER: N of the probes behind it ran
out of time rather than finishing, so this is what was found and not what is
there"** to the explanation itself, not to a separate field. A caveat only counts
if it is where the number is, which was the finding from the first audit's item on
the unpriced weight bias.

`ShortfallDiagnosis.complete` is the machine readable form.

### 2. `_club_limit` bisection under a timeout
**Incomplete, fixed by item 1, no separate fix.** The bisection asks `satisfiable`
repeatedly and each call can time out, which would make the reported "best your
club can manage" a number rather than a bound. It is covered by the stamp above:
the caveat is attached to the whole diagnosis, and the limit lines are inside it.
A per limit flag was considered and rejected as noise: the reader needs to know the
answer is provisional, not which of eleven probes was.

### 3. `largest_feasible` under a timeout
**Incomplete, not worth fixing separately, and DOCUMENTED.** The upward doubling and
bisection use the same `feasible`, so an achieved count of 7 under time pressure
can mean "7 is the most" or "we stopped at 7". `RepeatOutcome.proven_optimal` is
already False in that case and the callers print "NOT PROVEN OPTIMAL: this is the
best found inside the time budget", which is the same statement in the words a
reader wants. Adding a second flag saying the same thing twice was rejected.

### 4. `_supply_diagnosis`
**Complete.** It is a relaxed model with no requirements, no positions and no
chemistry, and it solves in milliseconds on any realistic pool. It has no probe
budget to run out of. Its honesty problem was prices, fixed in the first audit and
again in RESEARCH.md 8.8.

### 5. `_minimal_blocking_set` returning `None`
**Complete.** `None` means the problem is infeasible with EVERY requirement removed,
which is a positive finding rather than an absence, and the caller says so in those
words: "removing EVERY requirement does not unblock it either, so the requirements
are RULED OUT rather than merely unproven". If the probe behind it timed out, item
1's stamp catches it.

---

## Grind planner, `solver/fc_ai_solver/grind_planner.py`

### 6. A baseline model the planner could not solve
**Was: incomplete, and actively false. FIXED.**

`plan_grind` returned `GrindPlan(baseline={}, steps=[], ...)` when its own baseline
solve came back `None`, which happens on a timeout. `summary()` then printed
**"Nothing left to unlock by buying: the queue is fully fed."**

That is not a hedge, it is a false statement of the opposite of the truth, produced
by a timeout. The plan now carries `baseline_failed` and says: "NO PLAN. The
planner could not solve its own baseline model inside its time budget, so it does
not know what the club can feed and has nothing to say about buying. This is not
the same as there being nothing to buy."

### 7. The purchase step loop stopping early
**Was: incomplete. FIXED.** The loop breaks on the first step whose model does not
solve. A break at step 1 of 3 produced a plan with one step and no indication that
two more were never looked at, and an empty steps list produced "fully fed" again.
`steps_truncated`, `steps_probed` and `steps_requested` are recorded, and the
summary says "UNKNOWN beyond that, not nothing" or, where a purchase was found,
"a better one further out is UNKNOWN rather than ruled out".

### 8. `max_extra_steps` defaulting to 3
**Complete, after item 7.** The planner only ever looks three squads ahead. That is
a deliberate bound, and it is now reported as one: `steps_requested` is the smaller
of the cap and what the queue actually asked for, so a plan that stopped at the cap
is distinguishable from one that ran out of things to buy.

### 9. `_diagnose_depths` probing cap
**Complete.** `RequirementBlock.probing_was_capped` already exists and
`describe()` already says "squads N to M were not probed, so what blocks them is
UNKNOWN rather than nothing". This was fixed in the first audit and survives.

---

## Queue and set, `solver/fc_ai_solver/queue_solve.py`

### 10. The whole queue model returning nothing
**Was: incomplete. FIXED.** `status not in (OPTIMAL, FEASIBLE)` returned an empty
`QueueOutcome`, whose `describe()` rendered "0 squad(s) built, 0 coins spent, 0
value burned" with no explanation at all. A proved impossibility and a timeout
looked identical, and the reader would reasonably read the first.

The outcome now carries `failure`, set to either "NOTHING BUILT, and the model
PROVED it" or "NOTHING FOUND in Ns, which is NOT the same as nothing being
possible", and `describe()` returns it instead of a row of zeroes.

Worth noting what this path is NOT: a club that cannot feed a single squad does not
reach it. `built[j]` may be zero, so the model is feasible with nothing built, and
each item comes back with its own diagnosis. That is the gate that makes partial
queues work, and it means the failure path is almost entirely about timeouts.

### 11. One time budget for the whole queue model
**Incomplete, not worth fixing.** `time_budget_seconds` covers the single joint
solve, so a ten item queue gets the same wall clock as a one item queue. That is
correct, because it IS one model, and per item budgets would be meaningless. The
result is labelled `proven_optimal` either way, which is the honest signal.

### 12. `_diagnose_in_queue` budget capped at 10 seconds
**Incomplete, fixed by item 1.** `min(time_budget_seconds, 10.0)` is a deliberate
cap so a diagnosis cannot outrun the solve that produced it. Under that cap probes
do time out, and item 1's stamp is exactly what makes the resulting sentence
honest.

### 13. Contention, when the "would it build alone" probe times out
**Incomplete, fixed by item 1, worth stating separately because the failure mode
is nasty.** `_diagnose_in_queue` asks whether the item is feasible alone. A timeout
answers "no", which routes to the intrinsic diagnosis rather than to contention,
and the reader is told their SBC is impossible when it is merely outbid. The
diagnosis it falls back to now carries the stamp, so the sentence ends with the
reason to doubt it.

### 14. `solve_set` mutating the items it is given
**Incomplete, not worth fixing.** It sets `kind`, `count` and `set_name` on the
caller's `QueueItem` objects rather than copying them. Nothing in the codebase
reuses an item across calls and the tests construct fresh ones. Recorded so that
if anything ever does, this is where the surprise comes from.

### 15. `solve_alternatives` exhaustion
**Was: incomplete, and worse than the first pass of this audit recorded. FIXED.**

The first pass called this "not worth fixing" on the grounds that the wording
already said "found" rather than "exist". Reading the code rather than the output
showed the flag itself was wrong: `status not in ("optimal", "feasible")` set
`exhausted=True`, and `unknown` means the search ran out of time. So a timeout
printed **"the pool has no further squad differing by 3 cards"**, which nobody had
checked.

`exhausted` and `timed_out` are now separate, set from separate statuses, and the
timeout case says "the search RAN OUT OF TIME rather than running out of squads.
Whether a further one exists is UNKNOWN."

That makes five paths that produced a false or misleading sentence, not four, and
the fifth was one this audit had already waved through once. Reading the output is
not the same as reading the code.

---

## The TypeScript side

### 16. `SolverClient` timeout default
**Complete, and it started as a bug.** `fetch` gave undici a 300 second headers
timeout that could not be reached from the calling code, so a long solve died with
"fetch failed" while the solver was still working: incompleteness reported as a
network error, which is this audit's question in its purest form. Now `node:http`
with no socket timeout by default. RESEARCH.md 8.9.

### 17. `rebuild` mismatches
**Complete.** A disagreement between the solver and the rules engine is reported as
MISMATCH rather than resolved in either direction, in both the command line and the
UI.

### 18. `parseRequirementText`
**Complete.** Returns every line, parsed or not, with the reason. Nothing is
dropped and no number is guessed from a word.

### 19. `takeRatingCombinations` limit
**Incomplete, not worth fixing.** The command line and the UI ask for 60 rating
multisets. If the sixty first would have been cheaper, nobody hears about it. The
enumerator is best first on an exact cost to go bound, so the cheapest shapes come
first by construction and the 61st is worse than the 60th by that bound. Recorded
because it is a real cap, and the reason it is safe is a property of the
enumerator rather than an accident.

### 20. `buildPool` unpriced ratings
**Complete.** Reported as a list and, downstream, no coin figure is quoted for
them at all.

---

## Summary

Twenty paths. **Five** were incomplete in a way that produced a false or misleading
sentence, and all five are fixed: the diagnosis stamp, the planner's "NO PLAN", the
truncated step search, the queue's empty outcome, and the alternatives exhaustion
flag. Five more inherit the fix from item 1. Ten were already complete or are
bounded in a way that is stated where the number is.

Two things worth keeping from how this went.

**Item 6 printed the opposite of the truth.** Every other finding made an answer
look more certain than it was; that one said "the queue is fully fed" because a
solver timed out.

**Item 15 was waved through once, in this document, on the strength of its output
wording, and the code said something different.** The first audit had the same
reversal in its item 5. Reading what a path prints is not the same as reading what
it does, and the second is the one that finds these.
