# Singular-reporting audit

Every diagnosis and explanation path in the codebase, checked for the pattern that
came up four times in review: a single cause, depth, requirement or supply reported
as if it were the whole picture.

Verdicts are `complete`, `incomplete` (with what and whether it is fixed), or
`incomplete, not worth fixing` (with why). Everything is listed, including the
paths that turned out to be fine.

Audited at 440 Python tests, 237 TypeScript tests.

---

## Diagnosis paths, `solver/fc_ai_solver/repeat_solve.py`

### 1. `_diagnose` singles loop
**Was: incomplete. FIXED.** It returned the FIRST requirement whose removal
unblocked the target squad. Two requirements can each be independently sufficient
to fix, and naming one sends the reader to clear it and come back to the same wall.
Now collects every single that unblocks and says "removing ANY one unblocks squad
N". `binding_requirement` stays null when there is more than one, because there is
not one. Driven through `_diagnose` with a stub search, because a real pool where
two requirements are each independently sufficient is fiddly to build and the
fiddliness would test the fixture rather than the logic.

### 2. `_diagnose` pairs loop
**Incomplete, partly fixed, partly not worth fixing.** Still returns the FIRST pair
rather than all pairs. Unlike the singles case this is defensible: a pair is already
a statement that neither member alone suffices, and enumerating every such pair on a
20 requirement SBC is 190 solves for a report nobody reads to the end. Left as is.

Triples and larger are never searched. The fall-through message says "no single
requirement and no pair explains it", which is accurate about what was tried but
does not say triples were skipped. **Not worth fixing**: the cost is cubic and by
that point the honest answer is the closest-to-binding report, which is what
happens.

Pairs are skipped entirely above 8 requirements, and the message says so.
**Complete.**

### 3. `_supply_or_unexplained`, supply branch: the "cheapest gap" tail
**Was: incomplete and actively misleading. FIXED.** All shortfalls were listed, then
one was named "Cheapest gap to close", which reads as a menu. It is not a menu: the
model returns the cheapest SET of additions that together reach the count, so every
one of them is required. Now reads "All 3 of these are needed together, not instead
of each other, for N coins in total".

### 4. `_supply_diagnosis`, no-multiset branch
**Was: incomplete. FIXED.** Returned `rating=0` as a magic value meaning "cards in
general", which rendered as "22 cards rated 0". `rating` is now `int | None` and the
wording is "22 cards" when there is no rating requirement.

### 5. `_supply_diagnosis`, price for a rating the club holds none of
**Was: incomplete. Verdict reversed on review, and FIXED.**

The first pass called this "not worth fixing" on the grounds that no number is
worse than an estimate for a shopping list. That was arguable rather than obvious,
and the argument runs the other way: a wrong number gets acted on, a missing one
gets asked about. The old fallback priced a missing rating at the dearest card in
the club, which can be out by a large factor. A club topping out at 84 asked for
90s would quote an 84's price for a card worth many times that.

There is now no fallback estimate. Price resolution is: a supplied rating table
first, then the cheapest card of that rating in the club, then genuinely unpriced,
carrying `unit_cost = None` and `basis = "unknown"`. Everything downstream refuses
to quote a coin figure for a step containing one, names the rating that needs a
price, and excludes the step from the best-value ranking, because ranking it would
mean inventing the value it is ranked on. That is the same treatment a flagged
challenge gets, for the same reason.

One deliberate bias, stated rather than hidden: in the optimisation an unpriced
rating carries a weight above every priced one, so the model avoids buying what it
cannot cost when a priced alternative exists. The chosen mix may therefore not be
the true cheapest when an unpriced rating is involved.

### 6. `_supply_diagnosis`, solver failure
**Was: incomplete and silent. FIXED.** Returned `[]` on a non-optimal status, which
the caller reads as "the club has enough" and then goes on to blame a requirement.
The model is tiny and always feasible, so a failure is a bug. Now raises with a
message saying exactly that empty would have been misread.

### 7. `_relaxed` and the closest-to-binding fallback
**Incomplete, not worth fixing.** Loosens ONE requirement at a time, by up to 3, and
reports each independently. A pair loosening might unblock where no single one does.
This is already the "nothing explained it" path, it is labelled "closest to binding"
rather than "the cause", and every requirement is reported on including the ones no
loosening helps. Adding pairwise loosening multiplies the probe count for a report
that is explicitly a hint. **Recorded.**

Requirements with no numeric value (`excludeEvolved`, `specificPlayer`, `formation`)
appear in `contributions` with `None`, so they are not silently dropped. **Complete.**

### 8. `ShortfallDiagnosis.mode` and `RepeatOutcome.binding_requirement`
**Complete.** The mode distinguishes requirement, requirement_pair, supply and
unexplained. `binding_requirement` deliberately returns null unless there is exactly
one, rather than picking a representative.

---

## Planner paths, `solver/fc_ai_solver/grind_planner.py`

### 9. `max_depth_probes`
**Was: incomplete. FIXED.** Defaulted to 4, so a run of ten probed to squad 6 and
stopped, which is precisely the depth range the per-depth analysis exists to cover.
Now defaults to `None`, meaning probe every squad actually requested. When a caller
does cap it, `probing_was_capped` is true and `describe()` says "Squads 5 to 8 were
not probed, so what blocks them is UNKNOWN rather than nothing", because silence
past a cap reads as "nothing blocks those".

### 10. `RequirementBlock.requirement_binds_through`
**Complete, and the reasoning is worth recording.** It takes the contiguous prefix of
requirement-mode depths. That is exact rather than approximate, because the modes are
monotone: once supply binds at depth d, removing requirements cannot help at d+1
either, since the supply model is strictly tighter there. A non-contiguous
`[requirement, supply, requirement]` cannot occur.

### 11. `RequirementBlock.conditional_supply`
**Incomplete in a small way. Recorded, not changed.** Computed at the DEEPEST supply
depth only, so the reported card need covers the whole range. Someone who only wants
squad 5 sees the number for squad 6. It is stated as "squads 5 to 6 would also need
cards", so the range is explicit and the number is an upper bound for the range
rather than a wrong number for one squad. Reporting per-depth would multiply the
supply solves for marginal gain.

### 12. `RequirementBlock.binds_all_the_way`
**Complete now that 9 is fixed.** It means "no probed depth had supply as its cause",
and the description says how far probing went whenever that is short of what was
asked.

### 13. `GrindPlan.biggest_unlock`
**Incomplete by design, and the design is defensible.** Returns ONE step, ranked by
coins per squad with absolute cost as the tie break. Two things make this acceptable
rather than a repeat of the pattern: the full `steps` frontier is on the object, so
nothing is hidden, and `summary()` labels its line "Best value purchase" rather than
"the purchase". A reader who wants the cheapest absolute step rather than the best
value one has it available. **Recorded.** If `summary()` ever becomes the only
surface, it should print the frontier.

### 14. `GrindStep.purchases` and `GrindStep.unlocks`
**Complete.** Purchases are rendered as a conjunction ("buy A, B for N coins"), which
matches the model: they are needed together. `unlocks` covers every challenge in the
queue, including the zeros.

### 15. `GrindPlan.supply_limited` and `queue_is_requirement_blocked`
**Complete.** Lists, not representatives.

---

## Rules engine paths, TypeScript

### 16. `runFixture` in `src/rules/groundTruth.ts`
**Was: incomplete. FIXED.** Both the rating and the chemistry check were gated on
`failures.length === 0`, so a fixture wrong about its rating never had its chemistry
checked, and the second failure only appeared after the first was fixed. Both now run
whenever the fixture is structurally sound. Structural problems still suppress both,
which is correct: a fixture with the wrong number of players cannot be scored at all.

### 17. `validateSquad`
**Complete.** Every requirement is evaluated and returned with achieved next to
required. No short circuit on the first failure.

### 18. `detectConflicts`
**Complete for what it claims, incomplete for what it cannot claim.** It returns ALL
conflicts it finds rather than the first, and each carries the requirements that
caused it. It is not an exhaustive infeasibility check and does not claim to be: a
requirement set can be jointly impossible in a way none of its patterns catch, and
the solver then reports infeasible. **Recorded**, since "no conflicts" must not be
read as "satisfiable".

### 19. `relaxationOffer` in `src/rules/exclusions.ts`
**Incomplete. Recorded, not changed.** Reports a single count of cards that relaxing
would return, collapsing `countsByReason`. It does not say which relaxation returns
what, so "relaxing would return 40 cards" could be 39 locked and 1 favourite.
The breakdown IS on the report object, so no information is lost, only the sentence
is coarse. Worth improving when the UI consumes it; not worth a solver change now.

### 20. `formatStartupWarning`
**Complete.** Lists every unverified rule value, tiered, with queued readings
separated so nothing is double counted.

### 21. `assertUniformSquadSize`
**Complete.** Names every offender.

---

## Solver model paths

### 22. `add_challenge` unsupported requirements
**Was: incomplete. FIXED.** Raised on the FIRST unexpressible requirement, so a
challenge with three reported one, and the next appeared only after that one was
dealt with. Now collects all and raises once naming them together.

### 23. `_Search.largest_feasible`
**Complete.** Returns one count because the question has one answer, and the search
is exact rather than heuristic.

### 24. `require_squad_size` / `NegativeCostError`
**Complete.** Both name every offending item, up to a printed cap of five for the
cost error, which is stated in the message.
