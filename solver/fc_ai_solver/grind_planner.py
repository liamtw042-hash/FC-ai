"""The grind planner. Brief 6.3.

BUILT ON THE SUPPLY MODEL, NOT ALONGSIDE IT.

The shortfall diagnosis already answers "what is the club short of" by conjuring
the missing cards across the allowed rating multisets and minimising what the
conjuring costs. That is the same question 6.3 calls the biggest unlock, and the
conjure-and-minimise form answers it better than the spec asks for: it finds the
cheapest MIX across shapes rather than the worst case of any one shape. Three
cards rated 86 and twelve rated 85 can close the same gap, and only a model that
prices both can say which to buy.

So this is that model with the queue in it rather than one challenge. There is no
second heuristic, and there should not be one: a planner that disagreed with the
diagnosis would be worse than no planner.

WHAT IT DOES NOT KNOW, and this matters when reading the output.

It is a SUPPLY model. It counts cards by rating and nothing else. It does not know
about chemistry, positions, leagues, nations or any other requirement, so the
counts it produces are CEILINGS: what the club could feed if nothing but card
ratings mattered. Pass `known_achievable` from the real solver and it will say
which challenges are held back by something other than supply, where buying cards
will not help.
"""

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from .schema import PoolCard
from .squad_size import SQUAD_SIZE


class PlannerChallenge:
    """One queued challenge, as the supply model sees it."""

    def __init__(
        self,
        name: str,
        requested: int,
        multisets: list[dict[int, int]] | None = None,
        priority: int = 1,
    ) -> None:
        if requested < 1:
            raise ValueError(f"{name}: requested must be at least 1")
        if priority < 1:
            raise ValueError(f"{name}: priority must be at least 1")
        self.name = name
        self.requested = requested
        # None means the challenge has no rating requirement, so it consumes
        # eleven cards of any rating.
        self.multisets = multisets
        self.priority = priority


class Purchase:
    def __init__(self, rating: int, quantity: int, unit_cost: int) -> None:
        self.rating = rating
        self.quantity = quantity
        self.unit_cost = unit_cost

    @property
    def coin_cost(self) -> int:
        return self.quantity * self.unit_cost

    def describe(self) -> str:
        return f"{self.quantity} rated {self.rating} at {self.unit_cost} each"


class GrindStep:
    def __init__(
        self,
        extra_squads: int,
        purchases: list[Purchase],
        unlocks: dict[str, int],
    ) -> None:
        self.extra_squads = extra_squads
        self.purchases = purchases
        self.unlocks = unlocks

    @property
    def coin_cost(self) -> int:
        return sum(p.coin_cost for p in self.purchases)

    @property
    def coins_per_squad(self) -> float:
        return self.coin_cost / self.extra_squads if self.extra_squads else float("inf")

    def describe(self) -> str:
        if not self.purchases:
            return f"{self.extra_squads} more squad(s) for nothing"
        what = ", ".join(p.describe() for p in self.purchases)
        gained = ", ".join(f"{name} +{n}" for name, n in sorted(self.unlocks.items()) if n)
        return (
            f"buy {what} for {self.coin_cost} coins to unlock {self.extra_squads} more "
            f"squad(s) ({gained}), {round(self.coins_per_squad)} coins per squad"
        )


class GrindPlan:
    def __init__(
        self,
        baseline: dict[str, int],
        steps: list[GrindStep],
        supply_limited: list[str],
        requirement_limited: list[str],
    ) -> None:
        self.baseline = baseline
        self.steps = steps
        # Challenges whose ceiling is below what was asked, so cards would help.
        self.supply_limited = supply_limited
        # Challenges where the club holds the cards but the solver still cannot
        # build them, so something other than supply is binding and buying will
        # not help.
        self.requirement_limited = requirement_limited

    @property
    def baseline_total(self) -> int:
        return sum(self.baseline.values())

    @property
    def biggest_unlock(self) -> GrindStep | None:
        """Best value purchase, not the largest one.

        Ranked by coins per squad, because "most additional squads" without a
        price attached just recommends the most expensive thing on the list.
        """
        affordable = [s for s in self.steps if s.extra_squads > 0]
        if not affordable:
            return None
        return min(affordable, key=lambda s: (s.coins_per_squad, s.coin_cost))


def _held_and_prices(pool: list[PoolCard]) -> tuple[dict[int, int], dict[int, int]]:
    held: dict[int, int] = defaultdict(int)
    cheapest: dict[int, int] = {}
    for card in pool:
        held[card.rating] += card.quantity
        if card.rating not in cheapest or card.cost < cheapest[card.rating]:
            cheapest[card.rating] = card.cost
    return held, cheapest


def _model(
    pool: list[PoolCard],
    challenges: list[PlannerChallenge],
    ratings: list[int],
    unit: dict[int, int],
    held: dict[int, int],
    allow_purchases: bool,
):
    model = cp_model.CpModel()
    total_held = sum(held.values())

    squads: dict[str, cp_model.IntVar] = {}
    picks: dict[str, list[cp_model.IntVar]] = {}
    for challenge in challenges:
        built = model.NewIntVar(0, challenge.requested, f"built_{challenge.name}")
        squads[challenge.name] = built
        if challenge.multisets:
            per_shape = [
                model.NewIntVar(0, challenge.requested, f"shape_{challenge.name}_{k}")
                for k in range(len(challenge.multisets))
            ]
            model.Add(sum(per_shape) == built)
            picks[challenge.name] = per_shape

    ceiling = sum(c.requested for c in challenges) * SQUAD_SIZE
    add = {
        r: model.NewIntVar(0, ceiling if allow_purchases else 0, f"add_{r}") for r in ratings
    }

    used_by_rating: dict[int, cp_model.IntVar] = {}
    for rating in ratings:
        terms = []
        for challenge in challenges:
            if not challenge.multisets:
                continue
            for k, combo in enumerate(challenge.multisets):
                if combo.get(rating):
                    terms.append(picks[challenge.name][k] * combo[rating])
        usage = model.NewIntVar(0, ceiling, f"used_{rating}")
        model.Add(usage == (sum(terms) if terms else 0))
        used_by_rating[rating] = usage
        model.Add(usage <= held.get(rating, 0) + add[rating])

    # Challenges with no rating requirement still eat eleven cards each, and every
    # challenge competes for the same finite club, so the totals are constrained
    # together as well as per rating.
    generic = sum(
        squads[c.name] * SQUAD_SIZE for c in challenges if not c.multisets
    )
    model.Add(
        sum(used_by_rating.values()) + generic <= total_held + sum(add[r] for r in ratings)
    )
    return model, squads, add, unit


def plan_grind(
    pool: list[PoolCard],
    challenges: list[PlannerChallenge],
    *,
    max_extra_steps: int = 3,
    known_achievable: dict[str, int] | None = None,
    time_budget_seconds: float = 5.0,
) -> GrindPlan:
    """What the club can feed now, and the cheapest way to feed more."""
    if not challenges:
        return GrindPlan(baseline={}, steps=[], supply_limited=[], requirement_limited=[])

    held, cheapest = _held_and_prices(pool)
    ratings = sorted(
        {r for c in challenges if c.multisets for combo in c.multisets for r in combo}
        | set(held)
    )
    fallback = max(cheapest.values()) if cheapest else 1
    unit = {r: cheapest.get(r, fallback) for r in ratings}

    def solve(model, objective_is_max: bool, *, extra: tuple | None = None):
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_budget_seconds
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        return solver

    # Baseline: nothing bought, as many squads as the club can feed. Priority
    # weights decide which challenges win the scarce cards.
    model, squads, _, _ = _model(pool, challenges, ratings, unit, held, allow_purchases=False)
    model.Maximize(sum(squads[c.name] * c.priority for c in challenges))
    solver = solve(model, True)
    if solver is None:
        return GrindPlan(baseline={}, steps=[], supply_limited=[], requirement_limited=[])
    baseline = {c.name: solver.Value(squads[c.name]) for c in challenges}
    baseline_total = sum(baseline.values())

    total_requested = sum(c.requested for c in challenges)
    steps: list[GrindStep] = []
    for extra in range(1, max_extra_steps + 1):
        target = baseline_total + extra
        if target > total_requested:
            break
        model, squads, add, _ = _model(
            pool, challenges, ratings, unit, held, allow_purchases=True
        )
        model.Add(sum(squads[c.name] for c in challenges) >= target)
        model.Minimize(sum(add[r] * unit[r] for r in ratings))
        step_solver = solve(model, False)
        if step_solver is None:
            break
        purchases = [
            Purchase(rating=r, quantity=step_solver.Value(add[r]), unit_cost=unit[r])
            for r in ratings
            if step_solver.Value(add[r]) > 0
        ]
        purchases.sort(key=lambda p: p.coin_cost)
        unlocks = {
            c.name: step_solver.Value(squads[c.name]) - baseline[c.name] for c in challenges
        }
        steps.append(GrindStep(extra_squads=extra, purchases=purchases, unlocks=unlocks))

    supply_limited = [c.name for c in challenges if baseline[c.name] < c.requested]
    requirement_limited: list[str] = []
    if known_achievable is not None:
        # The supply ceiling says the cards are there. If the real solver still
        # cannot build them, buying more cards will not help and the planner must
        # say so rather than recommending a purchase that changes nothing.
        requirement_limited = [
            name
            for name, achieved in known_achievable.items()
            if name in baseline and achieved < baseline[name]
        ]

    return GrindPlan(
        baseline=baseline,
        steps=steps,
        supply_limited=supply_limited,
        requirement_limited=requirement_limited,
    )
