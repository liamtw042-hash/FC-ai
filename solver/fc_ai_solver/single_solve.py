"""Single challenge solve. Brief 5, sub problem solver.

Picks real cards to fill an exact rating multiset, places them into formation
slots, satisfies the requirements, and minimises cost.

Chemistry is modelled too, but not one of its numbers lives in this package: the
ladders and contribution weights arrive as data from the TypeScript rules engine.
See chemistry_model.py.

Card usage is an INTEGER bounded by quantity, never a boolean. A boolean silently
caps every stack at one, and duplicate fodder is most of what an SBC eats.
"""

from __future__ import annotations

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .challenge_model import ChallengeImpossible, UnsupportedRequirement, add_challenge
from .schema import PlacedCard, SolveRequest, SolveResponse
from .squad_size import SQUAD_SIZE, require_squad_size


def _why_not(request: SolveRequest) -> str:
    """The checkpoint 12 answer, or the old shrug when diagnosis is turned off.

    Imported inside the function on purpose: the diagnosis module builds on the
    repeat mode machinery, and a module level import here would make the single
    solve depend on it just to say why it failed.
    """
    if not request.diagnose_on_failure:
        return "no squad in the available pool satisfies these requirements"
    from .impossibility import diagnose_impossibility

    multisets = [request.rating_counts] if request.rating_counts else None
    try:
        report = diagnose_impossibility(
            request.pool,
            request.formation_slots,
            requirements=request.requirements,
            chemistry=request.chemistry,
            multisets=multisets,
            universal_conflicts=request.universal_conflicts,
            time_budget_seconds=request.diagnosis_budget_seconds,
            workers=request.workers,
        )
    except Exception as error:  # noqa: BLE001
        # A diagnosis that fails must not turn a clean "infeasible" into a crash.
        return (
            f"no squad in the available pool satisfies these requirements, and the "
            f"diagnosis could not run: {error}"
        )
    if report.solvable:
        # The diagnosis relaxes pins and exclusions the real solve enforces, so
        # this is possible and saying which is better than contradicting ourselves.
        return (
            "no squad satisfies these requirements as posed. The requirements and the "
            "club are compatible on their own, so the limit is in the pins, the "
            "exclusions or the exact rating multiset asked for"
        )
    return report.describe()


def solve_single(request: SolveRequest) -> SolveResponse:
    pool = request.pool
    slots = request.formation_slots
    require_squad_size(slots, label="this challenge")

    model = cp_model.CpModel()
    n = len(pool)

    # usage[c] is how many copies of stack c are consumed, bounded by quantity.
    usage = [model.NewIntVar(0, card.quantity, f"use_{i}") for i, card in enumerate(pool)]
    # place[c][s] is 1 when a copy of stack c fills slot s.
    place = [[model.NewBoolVar(f"place_{i}_{s}") for s in range(SQUAD_SIZE)] for i in range(n)]

    for s in range(SQUAD_SIZE):
        model.AddExactlyOne(place[i][s] for i in range(n))
    for i in range(n):
        model.Add(sum(place[i][s] for s in range(SQUAD_SIZE)) == usage[i])

    model.Add(sum(usage) == SQUAD_SIZE)

    by_card_id = {card.id: index for index, card in enumerate(pool)}
    for pin in request.pins:
        index = by_card_id.get(pin.card_id)
        if index is None:
            return SolveResponse(
                status="infeasible",
                reason=f"pinned card {pin.card_id} is not in the available pool",
            )
        if not 0 <= pin.slot_index < SQUAD_SIZE:
            raise ValueError(f"pinned slot {pin.slot_index} is outside the squad")
        model.Add(place[index][pin.slot_index] == 1)

    # The exact rating multiset handed down by the TypeScript enumerator. This is
    # how the non linear rating formula stays out of the model entirely.
    if request.rating_counts is not None:
        by_rating: dict[int, list[int]] = defaultdict(list)
        for index, card in enumerate(pool):
            by_rating[card.rating].append(index)
        for rating, count in request.rating_counts.items():
            model.Add(sum(usage[i] for i in by_rating.get(rating, [])) == count)
        allowed = set(request.rating_counts)
        for index, card in enumerate(pool):
            if card.rating not in allowed:
                model.Add(usage[index] == 0)

    # Diversity: a new squad may reuse at most SQUAD_SIZE - min_difference cards
    # from any previously found one. Expressed on usage, so a stack of three that
    # appeared once still only counts the copies actually shared.
    for previous_index, previous in enumerate(request.exclude_similar_to):
        counts: dict[str, int] = {}
        for card_id in previous:
            counts[card_id] = counts.get(card_id, 0) + 1
        shared = []
        for card_id, times in counts.items():
            index = by_card_id.get(card_id)
            if index is None:
                continue
            overlap = model.NewIntVar(0, times, f"shared_{previous_index}_{index}")
            model.AddMinEquality(overlap, [usage[index], times])
            shared.append(overlap)
        if shared:
            model.Add(sum(shared) <= SQUAD_SIZE - request.min_difference)

    try:
        slot_chemistry, squad_chemistry = add_challenge(
            model, pool, slots, usage, place, request.requirements, request.chemistry,
            max_copies_per_squad=request.max_copies_per_squad,
        )
    except ChallengeImpossible as error:
        return SolveResponse(status="infeasible", reason=str(error))

    model.Minimize(sum(usage[i] * pool[i].cost for i in range(n)))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.time_budget_seconds
    solver.parameters.num_search_workers = request.workers
    started = time.perf_counter()
    status = solver.Solve(model)
    elapsed = time.perf_counter() - started

    if status == cp_model.INFEASIBLE:
        return SolveResponse(
            status="infeasible",
            wall_time_seconds=elapsed,
            reason=_why_not(request),
        )
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResponse(
            status="unknown",
            wall_time_seconds=elapsed,
            reason="the time budget ran out before any squad was found",
        )

    placements: list[PlacedCard] = []
    for s in range(SQUAD_SIZE):
        for i in range(n):
            if solver.Value(place[i][s]):
                placements.append(
                    PlacedCard(
                        card_id=pool[i].id,
                        slot_index=s,
                        slot_position=slots[s],
                        in_position=slots[s] in pool[i].positions,
                        chemistry=solver.Value(slot_chemistry[s]) if slot_chemistry else None,
                    )
                )
                break

    used_counts = [solver.Value(usage[i]) for i in range(n)]
    return SolveResponse(
        status="optimal" if status == cp_model.OPTIMAL else "feasible",
        placements=placements,
        total_cost=sum(used_counts[i] * pool[i].cost for i in range(n)),
        coins_spent=sum(used_counts[i] * pool[i].coins_spent for i in range(n)),
        value_burned=sum(used_counts[i] * pool[i].value_burned for i in range(n)),
        squad_chemistry=solver.Value(squad_chemistry) if squad_chemistry is not None else 0,
        proven_optimal=status == cp_model.OPTIMAL,
        wall_time_seconds=elapsed,
    )


__all__ = ["ChallengeImpossible", "UnsupportedRequirement", "solve_single"]
