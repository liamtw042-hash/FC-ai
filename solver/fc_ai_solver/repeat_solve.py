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

from .schema import PlacedCard, PoolCard

SQUAD_SIZE = 11


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


def solve_repeat(
    pool: list[PoolCard],
    formation_slots: list[str],
    *,
    max_squads: int,
    min_squads: int = 1,
    time_budget_seconds: float = 60.0,
    workers: int = 8,
) -> RepeatSolution:
    """Build between min_squads and max_squads squads, minimising total cost.

    Solved JOINTLY, not one at a time. Greedy burns the good fodder on squad one
    and then fails on squad four.
    """
    if len(formation_slots) != SQUAD_SIZE:
        raise ValueError(f"a squad needs {SQUAD_SIZE} slots, got {len(formation_slots)}")
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
