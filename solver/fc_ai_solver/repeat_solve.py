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
        binding_requirement: str | None,
        shortfall_reason: str | None,
    ) -> None:
        self.requested = requested
        self.achieved = achieved
        self.squads = squads
        self.total_cost = total_cost
        self.proven_optimal = proven_optimal
        self.wall_time_seconds = wall_time_seconds
        self.binding_requirement = binding_requirement
        self.shortfall_reason = shortfall_reason

    @property
    def complete(self) -> bool:
        return self.achieved == self.requested


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
            picks = [model.NewBoolVar(f"combo_{j}_{k}") for k in range(len(allowed_rating_multisets))]
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

        add_challenge(model, pool, formation_slots, usage, place, requirements, chemistry, tag=f"s{j}")
        all_usage.append(usage)
        all_place.append(place)

    # No card is used twice ANYWHERE in the run.
    for i, card in enumerate(pool):
        model.Add(sum(all_usage[j][i] for j in range(squads)) <= card.quantity)

    model.Minimize(
        sum(all_usage[j][i] * pool[i].cost for j in range(squads) for i in range(n))
    )
    return model, all_usage, all_place


def _try(
    pool, formation_slots, squads, requirements, chemistry, multisets, budget, workers
):
    if squads == 0:
        return cp_model.OPTIMAL, None, None, None, 0.0
    model, all_usage, all_place = _build_exact(
        pool, formation_slots, squads, requirements, chemistry, multisets
    )
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = budget
    solver.parameters.num_search_workers = workers
    started = time.perf_counter()
    status = solver.Solve(model)
    return status, solver, all_usage, all_place, time.perf_counter() - started


def solve_repeat(
    pool: list[PoolCard],
    formation_slots: list[str],
    *,
    requested: int,
    requirements: list[Requirement] | None = None,
    chemistry: ChemistryConfig | None = None,
    allowed_rating_multisets: list[dict[int, int]] | None = None,
    time_budget_seconds: float = 60.0,
    workers: int = 8,
) -> RepeatOutcome:
    """One repeatable SBC, N times, solved JOINTLY. Brief 6.1.

    Greedy one at a time burns the good fodder on squad one and then fails on
    squad four, so every count is solved as a single model over the whole pool.

    When fewer than N are achievable, the shortfall is diagnosed: the requirement
    that blocks squad M+1 is identified by removing requirements one at a time and
    seeing which one lets M+1 through.
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
    elapsed_total = 0.0
    best: tuple[int, object, list, list] | None = None

    # Descending, so the first feasible count is the largest achievable.
    for count in range(requested, 0, -1):
        status, solver, all_usage, all_place, elapsed = _try(
            pool, formation_slots, count, requirements, chemistry,
            allowed_rating_multisets, time_budget_seconds, workers,
        )
        elapsed_total += elapsed
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            best = (count, solver, all_usage, all_place)
            proven = status == cp_model.OPTIMAL
            break
    else:
        return RepeatOutcome(
            requested=requested, achieved=0, squads=[], total_cost=0,
            proven_optimal=False, wall_time_seconds=elapsed_total,
            binding_requirement=_diagnose(
                pool, formation_slots, 1, requirements, chemistry,
                allowed_rating_multisets, time_budget_seconds, workers,
            ),
            shortfall_reason="not even one squad can be built from this pool",
        )

    count, solver, all_usage, all_place = best
    squads: list[list[PlacedCard]] = []
    total = 0
    for j in range(count):
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

    binding = None
    shortfall = None
    if count < requested:
        binding = _diagnose(
            pool, formation_slots, count + 1, requirements, chemistry,
            allowed_rating_multisets, time_budget_seconds, workers,
        )
        shortfall = (
            f"{count} of {requested} squads are achievable. Squad {count + 1} is blocked by "
            + (f"{binding}." if binding else "the size of the available pool, not by any single requirement.")
        )

    return RepeatOutcome(
        requested=requested, achieved=count, squads=squads, total_cost=total,
        proven_optimal=proven, wall_time_seconds=elapsed_total,
        binding_requirement=binding, shortfall_reason=shortfall,
    )


def _diagnose(
    pool, formation_slots, target_count, requirements, chemistry, multisets, budget, workers
) -> str | None:
    """Which single requirement blocks squad `target_count`.

    Removes one requirement at a time and re-solves. The one whose removal makes
    the count feasible is the binding constraint. If no single removal helps, the
    pool itself is the limit and saying so is more useful than naming a rule.
    """
    for index, requirement in enumerate(requirements):
        reduced = requirements[:index] + requirements[index + 1 :]
        status, *_ = _try(
            pool, formation_slots, target_count, reduced, chemistry, multisets,
            min(budget, 10.0), workers,
        )
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return _describe(requirement)
    return None
