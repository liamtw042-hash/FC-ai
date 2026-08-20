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
ratings mattered.

Pass `known_achievable` from the real solver and a challenge whose ceiling exceeds
what can actually be built is flagged. When that happens:

  1. The requirement diagnosis is RUN for that challenge and attached, so the
     output says "squad 4 is blocked by totwCount min 1" rather than a bare
     warning. A warning without a reason is exactly where someone buys anyway.
  2. Its purchase recommendation is SUPPRESSED, not caveated. A quoted coin
     figure next to a warning gets read as a coin figure. The challenge is pinned
     to what it can really build, so no purchase is ever quoted against it.
  3. If nothing in the queue is unflagged, there is no shopping list at all. The
     plan says the queue is requirement blocked and hands over the diagnoses.

If the diagnosis comes back unexplained, the plan says so rather than leaving room
to read it as "the purchase might work anyway".
"""

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from .repeat_solve import (
    ShortfallDiagnosis,
    SupplyShortfall,
    _diagnose,
    _Search,
    _supply_diagnosis,
)
from .schema import ChemistryConfig, PoolCard, Requirement
from .squad_size import SQUAD_SIZE


class PlannerChallenge:
    """One queued challenge, as the supply model sees it."""

    def __init__(
        self,
        name: str,
        requested: int,
        multisets: list[dict[int, int]] | None = None,
        priority: int = 1,
        formation_slots: list[str] | None = None,
        requirements: list[Requirement] | None = None,
        chemistry: ChemistryConfig | None = None,
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
        # Only needed to explain a flag. Without them the plan can say a challenge
        # is held back by something other than supply, but not what.
        self.formation_slots = formation_slots
        self.requirements = requirements or []
        self.chemistry = chemistry

    @property
    def can_be_diagnosed(self) -> bool:
        return self.formation_slots is not None


class Purchase:
    def __init__(
        self, rating: int, quantity: int, unit_cost: int | None, basis: str = "unknown"
    ) -> None:
        self.rating = rating
        self.quantity = quantity
        self.unit_cost = unit_cost
        self.basis = basis

    @property
    def is_priced(self) -> bool:
        return self.unit_cost is not None

    @property
    def coin_cost(self) -> int | None:
        return None if self.unit_cost is None else self.quantity * self.unit_cost

    def describe(self) -> str:
        if self.unit_cost is None:
            return f"{self.quantity} rated {self.rating} at an unknown price"
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
    def unpriced(self) -> list[Purchase]:
        return [p for p in self.purchases if not p.is_priced]

    @property
    def is_costable(self) -> bool:
        return not self.unpriced

    @property
    def coin_cost(self) -> int | None:
        """None when any purchase in the step has no price.

        A partial total would be read as the total, which is the same failure the
        purchase suppression on a flagged challenge exists to prevent.
        """
        if not self.is_costable:
            return None
        return sum(p.coin_cost or 0 for p in self.purchases)

    @property
    def coins_per_squad(self) -> float | None:
        cost = self.coin_cost
        if cost is None or not self.extra_squads:
            return None
        return cost / self.extra_squads

    def describe(self) -> str:
        if not self.purchases:
            return f"{self.extra_squads} more squad(s) for nothing"
        what = ", ".join(p.describe() for p in self.purchases)
        gained = ", ".join(f"{name} +{n}" for name, n in sorted(self.unlocks.items()) if n)

        if not self.is_costable:
            which = ", ".join(str(p.rating) for p in self.unpriced)
            return (
                f"buy {what} to unlock {self.extra_squads} more squad(s) ({gained}). "
                f"COST NOT QUOTED: rating(s) {which} have no price. Add one to the price "
                f"table before treating this as a shopping list"
            )
        return (
            f"buy {what} for {self.coin_cost} coins to unlock {self.extra_squads} more "
            f"squad(s) ({gained}), {round(self.coins_per_squad)} coins per squad"
        )


class DepthBlock:
    """What blocks one specific squad depth."""

    def __init__(self, depth: int, mode: str, explanation: str) -> None:
        self.depth = depth
        self.mode = mode
        self.explanation = explanation

    @property
    def is_requirement(self) -> bool:
        return self.mode in ("requirement", "requirement_pair")


class RequirementBlock:
    """A challenge the club can feed but the solver cannot build.

    BLOCKING IS PER SQUAD, NOT PER CHALLENGE.

    A requirement that stops squad 3 does not necessarily stop squad 5. If it
    binds only at 3 and 4, then cards really would unlock 5 and 6 once the
    requirement is dealt with, and flagging the whole challenge hides that.

    So each depth from the first unbuildable squad up to what was asked for is
    diagnosed separately. Where a requirement binds, no purchase is quoted. Where
    supply binds deeper in, the need IS reported, with the requirement named as a
    precondition, so nobody buys the cards and still gets nothing.
    """

    def __init__(
        self,
        name: str,
        achieved: int,
        supply_ceiling: int,
        depths: list[DepthBlock],
        conditional_supply: list[SupplyShortfall],
        probed_to: int,
        requested: int,
        diagnosis: ShortfallDiagnosis | None = None,
    ) -> None:
        self.name = name
        self.achieved = achieved
        self.supply_ceiling = supply_ceiling
        self.requested = requested
        self.depths = depths
        # What would be needed at the deeper squads where supply is the cause.
        # Only meaningful once the requirement above has been cleared.
        self.conditional_supply = conditional_supply
        self.probed_to = probed_to
        self.diagnosis = diagnosis

    @property
    def requirement_depths(self) -> list[int]:
        return [d.depth for d in self.depths if d.is_requirement]

    @property
    def supply_depths(self) -> list[int]:
        return [d.depth for d in self.depths if d.mode == "supply"]

    @property
    def requirement_binds_through(self) -> int | None:
        """The deepest squad a requirement blocks, counting from the first one."""
        contiguous = None
        expected = self.achieved + 1
        for depth in self.depths:
            if depth.depth != expected or not depth.is_requirement:
                break
            contiguous = depth.depth
            expected += 1
        return contiguous

    @property
    def probing_was_capped(self) -> bool:
        """True when depths beyond probed_to were never looked at."""
        return self.probed_to < self.requested

    @property
    def binds_all_the_way(self) -> bool:
        """No depth probed had supply as its cause, so no purchase helps at all.

        Only as far as probed_to. Beyond that the answer is UNKNOWN rather than
        absent, and describe() says so rather than letting silence read as "no".
        """
        return not self.supply_depths

    def describe(self) -> str:
        head = (
            f"{self.name}: the club can feed {self.supply_ceiling} squads but only "
            f"{self.achieved} can be built"
        )
        if not self.depths:
            return (
                f"{head}, and no formation or requirements were supplied for this "
                f"challenge, so the plan cannot say what is blocking it"
            )

        first = self.depths[0]
        if first.mode == "unexplained":
            lead = (
                f"Squad {first.depth} is blocked by something the diagnosis could not "
                f"name: {first.explanation}. Buying cards is not the answer, and neither "
                f"is loosening any single requirement"
            )
        else:
            lead = f"Squad {first.depth} is blocked by {first.explanation}"

        unknown = (
            f". Squads {self.probed_to + 1} to {self.requested} were not probed, so what "
            f"blocks them is UNKNOWN rather than nothing"
            if self.probing_was_capped
            else ""
        )

        if self.binds_all_the_way:
            return f"{head}. Buying cards would not help. {lead}{unknown}"

        deeper = self.supply_depths
        span = (
            f"squad {deeper[0]}"
            if len(deeper) == 1
            else f"squads {deeper[0]} to {deeper[-1]}"
        )
        needs = "; ".join(s.describe(deeper[-1]) for s in self.conditional_supply)
        return (
            f"{head}. {lead}. Beyond that, {span} would also need cards: {needs}. "
            f"Clearing the requirement above is a PRECONDITION. Buying those cards on "
            f"their own unlocks nothing{unknown}"
        )


class GrindPlan:
    def __init__(
        self,
        baseline: dict[str, int],
        steps: list[GrindStep],
        supply_limited: list[str],
        blocks: list[RequirementBlock],
        supply_ceiling: dict[str, int] | None = None,
    ) -> None:
        self.baseline = baseline
        self.steps = steps
        # Challenges whose ceiling is below what was asked, so cards would help.
        self.supply_limited = supply_limited
        # Challenges where the club holds the cards but the solver still cannot
        # build them. Each carries its diagnosis.
        self.blocks = blocks
        self.supply_ceiling = supply_ceiling or dict(baseline)

    @property
    def baseline_total(self) -> int:
        return sum(self.baseline.values())

    @property
    def requirement_limited(self) -> list[str]:
        return [block.name for block in self.blocks]

    @property
    def queue_is_requirement_blocked(self) -> bool:
        """Every challenge in the queue is held back by something buying cannot fix."""
        return bool(self.blocks) and len(self.blocks) == len(self.baseline)

    def summary(self) -> str:
        lines: list[str] = []
        for block in self.blocks:
            lines.append(block.describe())

        if self.queue_is_requirement_blocked:
            lines.insert(
                0,
                "This queue is requirement blocked, not supply blocked. No purchase "
                "would unlock anything, so there is no shopping list.",
            )
            return "\n".join(lines)

        uncostable = [s for s in self.steps if s.extra_squads > 0 and not s.is_costable]
        best = self.biggest_unlock
        if best is None:
            if uncostable:
                missing = sorted(
                    {p.rating for step in uncostable for p in step.unpriced}
                )
                lines.append(
                    "No purchase can be ranked by value: every step needs cards at "
                    f"rating(s) {', '.join(str(r) for r in missing)}, which have no price. "
                    "Add them to the price table and this becomes a shopping list."
                )
                for step in uncostable:
                    lines.append(f"  {step.describe()}")
            else:
                lines.append("Nothing left to unlock by buying: the queue is fully fed.")
        else:
            lines.append(f"Best value purchase: {best.describe()}")
            for step in uncostable:
                lines.append(f"Also possible, but not costable: {step.describe()}")
        return "\n".join(lines)

    @property
    def biggest_unlock(self) -> GrindStep | None:
        """Best value purchase, not the largest one.

        Ranked by coins per squad, because "most additional squads" without a
        price attached just recommends the most expensive thing on the list.
        """
        # Only steps that can actually be costed are ranked. Ranking an uncosted
        # step by value would mean inventing the value it is ranked on.
        affordable = [s for s in self.steps if s.extra_squads > 0 and s.is_costable]
        if not affordable:
            return None
        return min(affordable, key=lambda s: (s.coins_per_squad or 0, s.coin_cost or 0))


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


def _diagnose_depths(
    pool: list[PoolCard],
    challenge: PlannerChallenge,
    achieved: int,
    budget: float,
    max_depth_probes: int | None,
    rating_prices: dict[int, int] | None = None,
) -> tuple[list[DepthBlock], list[SupplyShortfall], int]:
    """Diagnose each squad depth separately, not just the first unbuildable one.

    A requirement that blocks squad 3 may not block squad 5. Probing only the
    first one and flagging the whole challenge hides a purchase that would really
    work once the requirement is dealt with.
    """
    if not challenge.can_be_diagnosed:
        return [], [], achieved

    search = _Search(
        pool, challenge.formation_slots, challenge.chemistry, challenge.multisets, budget, 8
    )
    requirements = list(challenge.requirements)
    # Default: probe every squad that was actually asked for. A fixed cap of four
    # meant a run of ten stopped at squad six and said nothing about the rest,
    # which is exactly the depth range this analysis exists to cover.
    probe_to = (
        challenge.requested
        if max_depth_probes is None
        else min(challenge.requested, achieved + max_depth_probes)
    )

    depths: list[DepthBlock] = []
    for depth in range(achieved + 1, probe_to + 1):
        diagnosis = _diagnose(search, depth, requirements, budget)
        depths.append(DepthBlock(depth, diagnosis.mode, diagnosis.explanation))

    supply_depths = [d.depth for d in depths if d.mode == "supply"]
    conditional: list[SupplyShortfall] = []
    if supply_depths:
        conditional = _supply_diagnosis(
            pool, challenge.multisets, supply_depths[-1], rating_prices
        )
    return depths, conditional, probe_to


def plan_grind(
    pool: list[PoolCard],
    challenges: list[PlannerChallenge],
    *,
    max_extra_steps: int = 3,
    known_achievable: dict[str, int] | None = None,
    rating_prices: dict[int, int] | None = None,
    time_budget_seconds: float = 5.0,
    max_depth_probes: int | None = None,
) -> GrindPlan:
    """What the club can feed now, and the cheapest way to feed more."""
    if not challenges:
        return GrindPlan(baseline={}, steps=[], supply_limited=[], blocks=[])

    held, cheapest = _held_and_prices(pool)
    ratings = sorted(
        {r for c in challenges if c.multisets for combo in c.multisets for r in combo}
        | set(held)
    )
    # Same resolution as the supply diagnosis, and the same refusal to invent a
    # price: table, then the club, then genuinely unpriced.
    supplied = rating_prices or {}
    unit: dict[int, int | None] = {}
    basis: dict[int, str] = {}
    for r in ratings:
        if r in supplied:
            unit[r], basis[r] = supplied[r], "table"
        elif r in cheapest:
            unit[r], basis[r] = cheapest[r], "pool"
        else:
            unit[r], basis[r] = None, "unknown"
    priced_values = [v for v in unit.values() if v is not None]
    sentinel = (max(priced_values) * 100 + 1) if priced_values else 1
    weight = {r: (unit[r] if unit[r] is not None else sentinel) for r in ratings}

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
        return GrindPlan(baseline={}, steps=[], supply_limited=[], blocks=[])
    ceiling = {c.name: solver.Value(squads[c.name]) for c in challenges}

    # A challenge the club can feed but the solver cannot build is FLAGGED, and a
    # flagged challenge is pinned to what it can really build so that no purchase
    # is ever quoted against it. Caveating the number instead would leave a coin
    # figure on the page, and a coin figure next to a warning reads as a coin figure.
    blocks: list[RequirementBlock] = []
    pinned: dict[str, int] = {}
    if known_achievable is not None:
        for challenge in challenges:
            achieved = known_achievable.get(challenge.name)
            if achieved is None or achieved >= ceiling[challenge.name]:
                continue
            pinned[challenge.name] = achieved
            depths, conditional, probed_to = _diagnose_depths(
                pool, challenge, achieved, time_budget_seconds, max_depth_probes,
                rating_prices,
            )
            blocks.append(
                RequirementBlock(
                    name=challenge.name,
                    achieved=achieved,
                    supply_ceiling=ceiling[challenge.name],
                    depths=depths,
                    conditional_supply=conditional,
                    probed_to=probed_to,
                    requested=challenge.requested,
                )
            )

    baseline = {
        c.name: pinned.get(c.name, ceiling[c.name]) for c in challenges
    }
    baseline_total = sum(baseline.values())

    if len(blocks) == len(challenges) and blocks:
        # Nothing in the queue is unflagged, so there is no shopping list to give.
        return GrindPlan(
            baseline=baseline,
            steps=[],
            supply_limited=[],
            blocks=blocks,
            supply_ceiling=ceiling,
        )

    total_requested = sum(c.requested for c in challenges)
    steps: list[GrindStep] = []
    for extra in range(1, max_extra_steps + 1):
        target = baseline_total + extra
        if target > total_requested:
            break
        model, squads, add, _ = _model(
            pool, challenges, ratings, unit, held, allow_purchases=True
        )
        # Flagged challenges cannot grow whatever is bought, so they are held at
        # what they can really build and every purchase quoted below is for a
        # challenge the cards would actually unlock.
        for name, achieved in pinned.items():
            model.Add(squads[name] == achieved)
        model.Add(sum(squads[c.name] for c in challenges) >= target)
        model.Minimize(sum(add[r] * weight[r] for r in ratings))
        step_solver = solve(model, False)
        if step_solver is None:
            break
        purchases = [
            Purchase(
                rating=r,
                quantity=step_solver.Value(add[r]),
                unit_cost=unit[r],
                basis=basis[r],
            )
            for r in ratings
            if step_solver.Value(add[r]) > 0
        ]
        # Priced first, cheapest among them, unpriced last so nothing that cannot
        # be costed heads a list that reads as a recommendation.
        purchases.sort(key=lambda p: (0 if p.is_priced else 1, p.coin_cost or 0))
        unlocks = {
            c.name: step_solver.Value(squads[c.name]) - baseline[c.name] for c in challenges
        }
        steps.append(GrindStep(extra_squads=extra, purchases=purchases, unlocks=unlocks))

    supply_limited = [
        c.name
        for c in challenges
        if c.name not in pinned and baseline[c.name] < c.requested
    ]

    return GrindPlan(
        baseline=baseline,
        steps=steps,
        supply_limited=supply_limited,
        blocks=blocks,
        supply_ceiling=ceiling,
    )
