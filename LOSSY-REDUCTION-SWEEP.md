# Lossy reduction sweep

Five defects in this project turned out to be one pattern, and every one was found
after the fact:

| Found | The reduction |
|---|---|
| singles missing pairs | one blocking requirement stood for the blocking set |
| requirement-only diagnosis missing supply | one class of cause stood for all causes |
| next-squad diagnosis standing in for the challenge | one depth stood for every depth |
| contention as a fifth cause | four causes stood for the space of causes |
| `feasible: bool` over four CP-SAT states | two states stood for four |

So this is a sweep for the class rather than the instance. Three questions, asked
of every path in the codebase:

1. **Is a multi-state result reduced to a bool, or to a `None`?**
2. **Is the first of many returned as if it were the only one?**
3. **Does one depth, one cause or one branch stand for the whole?**

Everything found is listed, `FIXED`, `LEFT` with the reason, or `COMPLETE` where
the reduction turned out to be sound. Swept at 549 Python tests, 378 TypeScript.

---

## 1. Multi-state reduced to a bool or a None

### 1.1 `_Search.feasible`, four CP-SAT states into two
**FIXED, in the second audit.** The one that started this. `UNKNOWN` means the
budget ran out and collapsed into the same `False` as a proof of infeasibility.
`_Search` counts unknowns and `_diagnose` stamps every answer with how many probes
behind it never finished.

### 1.2 `plan_grind`'s inner `solve()`, returning `None` for both
**FIXED HERE.** The same reduction one level up, and it survived the second audit
because that audit fixed the *caller* and not the *reducer*. `solve()` returned
`None` for `INFEASIBLE` and for `UNKNOWN` alike, so `baseline_failed` was set for
both and the summary said "could not solve its own baseline model inside its time
budget" for a model that was proved impossible in a millisecond.

`last_status` is now recorded and `baseline_timed_out` distinguishes them. The
infeasible case says "not for want of time ... raising the budget will not change
it", which is the opposite advice.

The step loop had the same bug in a subtler form: `steps_truncated` was set on any
unsolved step, so an INFEASIBLE step, which correctly means no deeper step is
reachable either, reported that later steps "were not looked at". It is now
`timed_out() and target <= total_requested`.

### 1.3 `validateSquad`, an exhaustive switch over a union that runtime data escapes
**FIXED HERE, and it was the worst find of the sweep.** TypeScript proves the
switch exhaustive over the `Requirement` union. Requirements arrive from pasted SBC
text, from JSON on disk and from HTTP bodies, none of which the compiler has seen.
A type outside the union fell off the end of the switch and came back as
`undefined` in the results array, which rendered as a `null` row and made
`squadPasses` throw `Cannot read properties of undefined`.

The asymmetry is what makes it bad: **the Python side raises `UnsupportedRequirement`
loudly for exactly this case**, precisely so a dropped constraint cannot return a
squad the game rejects. The TypeScript side, which is the authoritative one, was
silently returning nothing.

Three parts to the fix. `REQUIREMENT_TYPES` is the union as runtime values, with a
`satisfies` clause proving every entry is a real type and a `MissingFromList`
conditional type proving every real type is an entry, so the list cannot drift from
the union without failing the build. `isKnownRequirementType` is the runtime guard.
`validateSquad` returns an explicit `NOT CHECKED` result, which can never pass, and
`uncheckedRequirements` separates "could not be checked" from "checked and failed".

### 1.4 `solve_alternatives`, `exhausted` set by a timeout
**FIXED, in the second audit**, after being waved through once.

### 1.5 `SolverClient.healthy(): boolean`
**LEFT.** Collapses "not answering", "answering with a 500" and "answering" into
two states. Nothing branches on which: its only caller wants to know whether to
print "start the solver". The `post` path, which is what every real call uses,
already distinguishes `SolverUnavailableError` from `SolverRejectedError` with the
status.

### 1.6 `RequirementResult.passed: boolean` with `achieved: number | string | null`
**COMPLETE.** `passed: false` covers both "failed" and "could not be evaluated",
but `achieved` carries which: an unscoreable squad reports `'incomplete squad'` and
an unknown type reports `'NOT CHECKED: ...'`. The bool is the safe direction of the
two, and the string next to it is where the distinction lives. Forced and asserted
in `degradedStates.test.ts`.

### 1.7 `parseFlag`, `ClubLimit.reachable`, `SupplyShortfall.is_priced`
**COMPLETE.** All three already return or carry three states: `parseFlag` returns
`boolean | null` and an unrecognised value is an error rather than a `false`;
`ClubLimit` separates "no numeric value", "not reachable at any value" and "best
is N"; `is_priced` sits alongside `unit_cost: int | None` and `basis`.

---

## 2. First of many returned as the only one

### 2.1 The history write back, matching on name and rating
**FIXED HERE.** `resolved.find(name === player.name && rating === player.rating)`
took the first stack matching a name and a rating, and **name plus rating does not
identify a stack**: a base gold and a special card can share both. Submitting would
consume the wrong stack and leave the club quietly wrong until a later solve failed
for no visible reason.

The root of it was upstream: `SquadView` did not carry the card id, so the write
back had nothing better to match on. It carries `cardId` now, and the write back
matches on it and refuses with a 409 rather than guessing.

### 2.2 `squadSizeOf`, first `squadSize` requirement wins
**FIXED HERE.** Two `squadSize` requirements stating different sizes meant the
second was silently dropped, and one of the two is what the game will actually
enforce. It now collects the distinct values and throws `ConflictingSquadSizeError`
naming both. Two requirements stating the *same* size are a harmless duplicate and
still pass.

### 2.3 `_minimal_blocking_set`, one minimal infeasible subset of possibly several
**LEFT, and now SAID.** A deletion filter returns whichever minimal set its drop
order reaches, and a challenge can hold several. Enumerating them all is
exponential. The wording now ends "this is ONE minimal conflicting set and there
may be others the filter did not look for" rather than implying it found the only
one.

### 2.4 `_diagnose` pairs loop, first pair only
**LEFT.** Recorded in the first audit and unchanged. A pair is already a statement
that neither member alone suffices, and enumerating every such pair on a twenty
requirement SBC is 190 solves for a report nobody reads to the end.

### 2.5 `PATTERNS.find` in the paste parser, first matching label wins
**LEFT.** The order is deliberate and commented: anything with a named entity in it
is tried before the generic form of the same idea, so "Players from Serie A" is
matched before "Players". Two patterns matching the same label is a bug in the
pattern list, not in the reduction, and `parseRequirementText.test.ts` pins the
cases that depend on the order.

### 2.6 `takeRatingCombinations`, first 60 of many
**LEFT.** Recorded in the second audit at item 19. The enumerator is best first on
an exact cost to go bound, so the 61st combination is worse than the 60th *by that
bound*, not by luck. The cap is real and the reason it is safe is a property of the
enumerator.

### 2.7 `app/api/queue`, `definitions[0].prepared.pool` used for the whole queue
**LEFT, with an assertion added.** Every item's pool is built from the same
`state()` in the same request, so they are identical by construction. Using the
first is not a reduction so much as an unstated invariant, and the route now says
so in a comment rather than leaving it to be rediscovered.

---

## 3. One depth, cause or branch standing for the whole

### 3.1 The next-squad diagnosis, in repeat and queue mode
**FIXED HERE.** The instance the brief named, and it was only ever half fixed. The
grind planner probes every depth and reports "squads N to M were not probed"; the
repeat and queue *summaries* diagnose `achieved + 1` and say nothing about the rest,
which reads as "and the same goes for all of them".

Both now say "Squads N to M were NOT probed separately, so what blocks them is
unknown rather than the same thing", and only when there is more than one squad
left, so it is not noise on an item that is one short.

This matters most in queue mode, where a CONTENTION at squad 4 says nothing at all
about whether squad 7 would have been supply blocked anyway.

### 3.2 `RequirementBlock.describe()`, leading with `depths[0]`
**COMPLETE.** It leads with the first depth but the spans behind it,
`requirement_binds_through`, `supply_depths` and `probing_was_capped`, are all
reported. Fixed in the first audit and still holding.

### 3.3 `Impossibility`, one diagnosis at `achievable + 1`
**LEFT.** The same reduction as 3.1, and deliberately so here: `diagnose_impossibility`
is asked "why can this not be built", singular, and the caller that wants the depth
picture calls the planner. Its `describe()` names the squad number, so it never
claims to speak for the others.

### 3.4 `biggest_unlock`, one purchase step of several
**COMPLETE.** It is explicitly the best value step and the others are printed under
"Also possible, but not costable" or ranked below it.

### 3.5 `_supply_diagnosis`, one shortfall set
**COMPLETE.** Fixed in the first audit: the model returns the cheapest SET of
additions and the wording says "All N of these are needed together, not instead of
each other".

---

## What this changes about how to look

The five original instances were all found by hitting them. This sweep found three
more by asking the question of the code instead, and one of the three, 1.2, was
inside a file the previous audit had already fixed. **Fixing a caller is not fixing
the reducer**, and the reducer is where the next instance will be.
