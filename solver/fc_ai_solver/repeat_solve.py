"""Several squads against one shared pool. The foundation of brief 6.

WHY THIS EXISTS BEFORE CHECKPOINT 11.

The cost model gives preferred cards a negative weighting, so a squad's weighted
cost can fall below zero. Inside one squad that is harmless, because the squad is
always eleven cards and a constant shift cannot reorder anything. Here it is not
harmless: the NUMBER of squads is part of what is being chosen, and a squad that
costs less than nothing makes an eighth squad look like a gain.

The TypeScript cost model shifts every card by a constant offset so the value it
sends here can never be negative. This module assumes that and checks it, rather
than trusting it, because the failure is silent: the solver would return more
squads than are worth doing and every one of them would look optimal.
"""

from __future__ import annotations

import time
from collections import defaultdict
from itertools import combinations

from ortools.sat.python import cp_model

from .challenge_model import add_challenge
from .schema import ChemistryConfig, PlacedCard, PoolCard, Requirement
from .squad_size import SQUAD_SIZE, require_squad_size


class NegativeCostError(ValueError):
    """A card was priced below zero, which would let extra squads look free."""


class RepeatSolution:
    def __init__(
        self,
        squads: list[list[PlacedCard]],
        total_cost: int,
        proven_optimal: bool,
        wall_time_seconds: float,
        shortfall_reason: str | None = None,
    ) -> None:
        self.squads = squads
        self.total_cost = total_cost
        self.proven_optimal = proven_optimal
        self.wall_time_seconds = wall_time_seconds
        self.shortfall_reason = shortfall_reason

    @property
    def squads_built(self) -> int:
        return len(self.squads)


def solve_variable_count(
    pool: list[PoolCard],
    formation_slots: list[str],
    *,
    max_squads: int,
    min_squads: int = 1,
    time_budget_seconds: float = 60.0,
    workers: int = 8,
) -> RepeatSolution:
    """Build between min_squads and max_squads squads, minimising total cost.

    The COUNT is chosen by the objective here, which is the case the non negative
    cost matters for: given non negative costs the cheapest answer is the smallest
    allowed count, and a squad can never pay for itself.

    Repeat mode wants the opposite question, "as many as I asked for", and lives in
    solve_repeat below.
    """
    require_squad_size(formation_slots, label="this challenge")
    if min_squads > max_squads:
        raise ValueError("min_squads cannot exceed max_squads")

    negative = [card.id for card in pool if card.cost < 0]
    if negative:
        raise NegativeCostError(
            "these cards carry a negative cost, which would make an extra squad look "
            "like a gain: " + ", ".join(sorted(negative)[:5])
        )

    model = cp_model.CpModel()
    n = len(pool)

    built = [model.NewBoolVar(f"built_{j}") for j in range(max_squads)]
    # Symmetry breaking. Squads are interchangeable, so insisting they fill up in
    # order stops the solver exploring max_squads! equivalent arrangements.
    for j in range(1, max_squads):
        model.Add(built[j] <= built[j - 1])

    place = [
        [[model.NewBoolVar(f"p_{j}_{i}_{s}") for s in range(SQUAD_SIZE)] for i in range(n)]
        for j in range(max_squads)
    ]

    for j in range(max_squads):
        for s in range(SQUAD_SIZE):
            # Exactly one card per slot when the squad is built, none when it is not.
            model.Add(sum(place[j][i][s] for i in range(n)) == built[j])

    # No card is used twice ANYWHERE, across every squad in the run.
    for i, card in enumerate(pool):
        model.Add(
            sum(place[j][i][s] for j in range(max_squads) for s in range(SQUAD_SIZE))
            <= card.quantity
        )

    model.Add(sum(built) >= min_squads)

    model.Minimize(
        sum(
            place[j][i][s] * pool[i].cost
            for j in range(max_squads)
            for i in range(n)
            for s in range(SQUAD_SIZE)
        )
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_budget_seconds
    solver.parameters.num_search_workers = workers
    started = time.perf_counter()
    status = solver.Solve(model)
    elapsed = time.perf_counter() - started

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return RepeatSolution(
            squads=[],
            total_cost=0,
            proven_optimal=False,
            wall_time_seconds=elapsed,
            shortfall_reason=(
                f"the pool cannot field {min_squads} squad(s) in this formation"
                if status == cp_model.INFEASIBLE
                else "the time budget ran out before any squad was found"
            ),
        )

    squads: list[list[PlacedCard]] = []
    total = 0
    for j in range(max_squads):
        if not solver.Value(built[j]):
            continue
        placements: list[PlacedCard] = []
        for s in range(SQUAD_SIZE):
            for i in range(n):
                if solver.Value(place[j][i][s]):
                    placements.append(
                        PlacedCard(
                            card_id=pool[i].id,
                            slot_index=s,
                            slot_position=formation_slots[s],
                            in_position=formation_slots[s] in pool[i].positions,
                        )
                    )
                    total += pool[i].cost
                    break
        squads.append(placements)

    return RepeatSolution(
        squads=squads,
        total_cost=total,
        proven_optimal=status == cp_model.OPTIMAL,
        wall_time_seconds=elapsed,
        shortfall_reason=None,
    )


# ---------------------------------------------------------------------------
# Repeat mode. Brief 6.1.
# ---------------------------------------------------------------------------


class ShortfallDiagnosis:
    """Why squad M+1 could not be built.

    Single requirement removal only ever finds single blockers. The realistic case
    on a run of ten is a COMBINATION: no one removal gets the next squad through,
    but two together do. Reporting "no blocker found" there is worse than useless,
    because it is exactly the case worth explaining.

    So: singles, then pairs, and if neither explains it, say so plainly and report
    how far each requirement is from binding rather than going quiet.
    """

    def __init__(
        self,
        blocking: list[str],
        contributions: list[tuple[str, int | None]],
        explanation: str,
    ) -> None:
        # The smallest subset whose removal unblocks the next squad. One or two
        # entries, or empty when no small subset explains it.
        self.blocking = blocking
        # Requirement to the smallest relaxation of its value that would unblock,
        # or None when no relaxation within the probe range helps.
        self.contributions = contributions
        self.explanation = explanation

    @property
    def subset_size(self) -> int | None:
        return len(self.blocking) if self.blocking else None


class RepeatOutcome:
    """N squads of one repeatable SBC, solved jointly against a shared pool."""

    def __init__(
        self,
        requested: int,
        achieved: int,
        squads: list[list[PlacedCard]],
        total_cost: int,
        proven_optimal: bool,
        wall_time_seconds: float,
        diagnosis: ShortfallDiagnosis | None,
        shortfall_reason: str | None,
        solves_run: int = 0,
    ) -> None:
        self.requested = requested
        self.achieved = achieved
        self.squads = squads
        self.total_cost = total_cost
        self.proven_optimal = proven_optimal
        self.wall_time_seconds = wall_time_seconds
        self.diagnosis = diagnosis
        self.shortfall_reason = shortfall_reason
        self.solves_run = solves_run

    @property
    def complete(self) -> bool:
        return self.achieved == self.requested

    @property
    def binding_requirement(self) -> str | None:
        """The single blocker, when there is exactly one. None otherwise."""
        if self.diagnosis is None or len(self.diagnosis.blocking) != 1:
            return None
        return self.diagnosis.blocking[0]


def _describe(requirement: Requirement) -> str:
    bits = [requirement.type]
    for label, value in (
        ("league", requirement.league),
        ("nation", requirement.nation),
        ("club", requirement.club),
        ("cardType", requirement.card_type),
        ("promo", requirement.promo_name),
        ("quality", requirement.quality),
        ("position", requirement.position),
    ):
        if value is not None:
            bits.append(f"{label}={value}")
    if requirement.op is not None and requirement.value is not None:
        bits.append(f"{requirement.op} {requirement.value}")
    elif requirement.value is not None:
        bits.append(str(requirement.value))
    if requirement.count is not None:
        bits.append(f"count={requirement.count}")
    return " ".join(bits)


def _relaxed(requirement: Requirement, by: int) -> Requirement | None:
    """The same requirement, loosened by `by` in its own units.

    Returns None when the requirement has no numeric value to loosen, or when
    loosening it any further would make it vacuous.
    """
    if requirement.value is None:
        return None
    if requirement.op == "max":
        return requirement.model_copy(update={"value": requirement.value + by})
    # min and exact both loosen downward. An exact becomes a minimum, because
    # "exactly 5, or fewer" is the honest reading of relaxing it.
    loosened = requirement.value - by
    if loosened < 0:
        return None
    update = {"value": loosened}
    if requirement.op == "exact":
        update["op"] = "min"
    return requirement.model_copy(update=update)


def _build_exact(
    pool: list[PoolCard],
    formation_slots: list[str],
    squads: int,
    requirements: list[Requirement],
    chemistry: ChemistryConfig | None,
    allowed_rating_multisets: list[dict[int, int]] | None,
):
    """A model that builds exactly `squads` complete squads from one pool."""
    model = cp_model.CpModel()
    n = len(pool)

    all_usage = []
    all_place = []
    for j in range(squads):
        usage = [model.NewIntVar(0, card.quantity, f"use_{j}_{i}") for i, card in enumerate(pool)]
        place = [
            [model.NewBoolVar(f"p_{j}_{i}_{s}") for s in range(SQUAD_SIZE)] for i in range(n)
        ]
        for s in range(SQUAD_SIZE):
            model.AddExactlyOne(place[i][s] for i in range(n))
        for i in range(n):
            model.Add(sum(place[i][s] for s in range(SQUAD_SIZE)) == usage[i])
        model.Add(sum(usage) == SQUAD_SIZE)

        if allowed_rating_multisets:
            by_rating: dict[int, list[int]] = defaultdict(list)
            for index, card in enumerate(pool):
                by_rating[card.rating].append(index)
            picks = [
                model.NewBoolVar(f"combo_{j}_{k}") for k in range(len(allowed_rating_multisets))
            ]
            model.AddExactlyOne(picks)
            ratings_seen = {r for combo in allowed_rating_multisets for r in combo}
            for rating in ratings_seen:
                model.Add(
                    sum(usage[i] for i in by_rating.get(rating, []))
                    == sum(
                        picks[k] * combo.get(rating, 0)
                        for k, combo in enumerate(allowed_rating_multisets)
                    )
                )
            for index, card in enumerate(pool):
                if card.rating not in ratings_seen:
                    model.Add(usage[index] == 0)

        add_challenge(
            model, pool, formation_slots, usage, place, requirements, chemistry, tag=f"s{j}"
        )
        all_usage.append(usage)
        all_place.append(place)

    # No card is used twice ANYWHERE in the run.
    for i, card in enumerate(pool):
        model.Add(sum(all_usage[j][i] for j in range(squads)) <= card.quantity)

    model.Minimize(sum(all_usage[j][i] * pool[i].cost for j in range(squads) for i in range(n)))
    return model, all_usage, all_place


class _Search:
    """Runs the exact count models and keeps a note of how much work that took."""

    def __init__(self, pool, slots, chemistry, multisets, budget, workers):
        self.pool = pool
        self.slots = slots
        self.chemistry = chemistry
        self.multisets = multisets
        self.budget = budget
        self.workers = workers
        self.solves = 0
        self.elapsed = 0.0

    def run(self, count: int, requirements: list[Requirement], budget: float | None = None):
        if count <= 0:
            return cp_model.OPTIMAL, None, None, None
        model, all_usage, all_place = _build_exact(
            self.pool, self.slots, count, requirements, self.chemistry, self.multisets
        )
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = budget if budget is not None else self.budget
        solver.parameters.num_search_workers = self.workers
        started = time.perf_counter()
        status = solver.Solve(model)
        self.elapsed += time.perf_counter() - started
        self.solves += 1
        return status, solver, all_usage, all_place

    def feasible(self, count: int, requirements: list[Requirement], budget: float | None = None) -> bool:
        status, *_ = self.run(count, requirements, budget)
        return status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    def largest_feasible(self, cap: int, requirements: list[Requirement], budget: float | None = None):
        """The largest achievable count, searched from BELOW.

        Feasibility is monotone in the count: N + 1 squads feasible implies N is,
        because dropping one squad is always allowed. So an infeasible N proves
        every larger count infeasible too.

        Searching downward from the requested number builds the biggest models
        first, and those are exactly the infeasible ones, which are the expensive
        ones to prove. Upward doubling then bisecting probes high at most twice and
        does work proportional to what is achievable rather than to what was asked
        for.
        """
        if cap <= 0:
            return 0, None
        best = 0
        best_solve = None

        # Bracket: 1, 2, 4, 8, ... until one fails or the cap is passed.
        probe = 1
        while probe <= cap:
            status, solver, usage, place = self.run(probe, requirements, budget)
            if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                break
            best, best_solve = probe, (solver, usage, place, status)
            if probe == cap:
                return best, best_solve
            probe *= 2

        # Bisect between the last success and the first failure. When the doubling
        # ran off the end of the cap rather than failing, cap + 1 stands in as the
        # infeasible bound, since anything above the cap is out of scope anyway.
        # Falling through without this leaves counts between the last power of two
        # and the cap unchecked, which silently under reports what is achievable.
        low, high = best, min(probe, cap + 1)  # low feasible, high infeasible
        while high - low > 1:
            middle = (low + high) // 2
            status, solver, usage, place = self.run(middle, requirements, budget)
            if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                low, best_solve = middle, (solver, usage, place, status)
            else:
                high = middle
        return low, best_solve


def _diagnose(
    search: _Search, target_count: int, requirements: list[Requirement], probe_budget: float
) -> ShortfallDiagnosis:
    """Which requirements block squad `target_count`. Singles, then pairs, then honesty."""
    if not requirements:
        return ShortfallDiagnosis(
            blocking=[],
            contributions=[],
            explanation="the size of the available pool, not any requirement",
        )

    # Singles.
    for index, requirement in enumerate(requirements):
        reduced = requirements[:index] + requirements[index + 1 :]
        if search.feasible(target_count, reduced, probe_budget):
            return ShortfallDiagnosis(
                blocking=[_describe(requirement)],
                contributions=[],
                explanation=_describe(requirement),
            )

    # Pairs. Bounded, because the number of pairs grows quadratically and a real
    # SBC with twenty requirements would spend the whole budget here.
    MAX_FOR_PAIRS = 8
    pairs_searched = len(requirements) <= MAX_FOR_PAIRS
    if pairs_searched:
        for first, second in combinations(range(len(requirements)), 2):
            reduced = [r for k, r in enumerate(requirements) if k not in (first, second)]
            if search.feasible(target_count, reduced, probe_budget):
                names = [_describe(requirements[first]), _describe(requirements[second])]
                return ShortfallDiagnosis(
                    blocking=names,
                    contributions=[],
                    explanation=(
                        f"{names[0]} and {names[1]} together. Neither alone is enough, "
                        f"which is why removing one at a time finds nothing."
                    ),
                )

    # Neither. Say so, and report how far each requirement is from binding rather
    # than going quiet on the case that most needs explaining.
    contributions: list[tuple[str, int | None]] = []
    for requirement in requirements:
        smallest: int | None = None
        for by in (1, 2, 3):
            loosened = _relaxed(requirement, by)
            if loosened is None:
                break
            swapped = [loosened if r is requirement else r for r in requirements]
            if search.feasible(target_count, swapped, probe_budget):
                smallest = by
                break
        contributions.append((_describe(requirement), smallest))

    movable = [(name, by) for name, by in contributions if by is not None]
    if movable:
        closest = ", ".join(f"{name} (loosen by {by})" for name, by in sorted(movable, key=lambda x: x[1]))
        explanation = (
            f"no single requirement and no pair explains it"
            f"{'' if pairs_searched else ', and there were too many requirements to search pairs'}. "
            f"Closest to binding: {closest}"
        )
    else:
        explanation = (
            f"no single requirement and no pair explains it"
            f"{'' if pairs_searched else ', and there were too many requirements to search pairs'}, "
            f"and no requirement loosened by up to 3 unblocks it either. The pool is the limit"
        )
    return ShortfallDiagnosis(blocking=[], contributions=contributions, explanation=explanation)


def solve_repeat(
    pool: list[PoolCard],
    formation_slots: list[str],
    *,
    requested: int,
    requirements: list[Requirement] | None = None,
    chemistry: ChemistryConfig | None = None,
    allowed_rating_multisets: list[dict[int, int]] | None = None,
    time_budget_seconds: float = 60.0,
    diagnosis_budget_seconds: float = 10.0,
    workers: int = 8,
) -> RepeatOutcome:
    """One repeatable SBC, N times, solved JOINTLY. Brief 6.1.

    Greedy one at a time burns the good fodder on squad one and then fails on
    squad four, so every count is solved as a single model over the whole pool.
    """
    require_squad_size(formation_slots, label="this challenge")
    if requested < 1:
        raise ValueError("requested must be at least 1")

    negative = [card.id for card in pool if card.cost < 0]
    if negative:
        raise NegativeCostError(
            "these cards carry a negative cost, which would make an extra squad look "
            "like a gain: " + ", ".join(sorted(negative)[:5])
        )

    requirements = list(requirements or [])
    search = _Search(
        pool, formation_slots, chemistry, allowed_rating_multisets, time_budget_seconds, workers
    )
    achieved, best_solve = search.largest_feasible(requested, requirements)

    if achieved == 0 or best_solve is None:
        return RepeatOutcome(
            requested=requested, achieved=0, squads=[], total_cost=0, proven_optimal=False,
            wall_time_seconds=search.elapsed,
            diagnosis=_diagnose(search, 1, requirements, diagnosis_budget_seconds),
            shortfall_reason="not even one squad can be built from this pool",
            solves_run=search.solves,
        )

    solver, all_usage, all_place, status = best_solve
    squads: list[list[PlacedCard]] = []
    total = 0
    for j in range(achieved):
        placements: list[PlacedCard] = []
        for s in range(SQUAD_SIZE):
            for i in range(len(pool)):
                if solver.Value(all_place[j][i][s]):
                    placements.append(
                        PlacedCard(
                            card_id=pool[i].id, slot_index=s,
                            slot_position=formation_slots[s],
                            in_position=formation_slots[s] in pool[i].positions,
                        )
                    )
                    total += pool[i].cost
                    break
        squads.append(placements)

    diagnosis = None
    shortfall = None
    if achieved < requested:
        diagnosis = _diagnose(search, achieved + 1, requirements, diagnosis_budget_seconds)
        shortfall = (
            f"{achieved} of {requested} squads are achievable. "
            f"Squad {achieved + 1} is blocked by {diagnosis.explanation}."
        )

    return RepeatOutcome(
        requested=requested, achieved=achieved, squads=squads, total_cost=total,
        proven_optimal=status == cp_model.OPTIMAL, wall_time_seconds=search.elapsed,
        diagnosis=diagnosis, shortfall_reason=shortfall, solves_run=search.solves,
    )
