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
        avoided_unpriced: list[int] | None = None,
    ) -> None:
        self.extra_squads = extra_squads
        self.purchases = purchases
        self.unlocks = unlocks
        # Ratings this step could have bought but was steered away from because
        # they have no price. A caveat only counts where the number is, so it goes
        # in describe() rather than only in a design note.
        self.avoided_unpriced = avoided_unpriced or []

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

        caveat = ""
        if self.avoided_unpriced:
            which = ", ".join(str(r) for r in self.avoided_unpriced)
            caveat = (
                f". NOT NECESSARILY THE CHEAPEST: this mix avoids rating(s) {which}, "
                f"which have no price, so a mix using them might cost less and nothing "
                f"here can tell. Price them to find out"
            )
        return (
            f"buy {what} for {self.coin_cost} coins to unlock {self.extra_squads} more "
            f"squad(s) ({gained}), {round(self.coins_per_squad)} coins per squad{caveat}"
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
        baseline_failed: bool = False,
        baseline_timed_out: bool = False,
        steps_truncated: bool = False,
        steps_probed: int = 0,
        steps_requested: int = 0,
    ) -> None:
        self.baseline = baseline
        self.steps = steps
        # Challenges whose ceiling is below what was asked, so cards would help.
        self.supply_limited = supply_limited
        # Challenges where the club holds the cards but the solver still cannot
        # build them. Each carries its diagnosis.
        self.blocks = blocks
        self.supply_ceiling = supply_ceiling or dict(baseline)
        # The planner could not solve its OWN baseline model inside its budget, so
        # it knows nothing. Without this an empty plan rendered as "nothing left to
        # unlock: the queue is fully fed", which is a flatly false statement
        # produced by a timeout.
        self.baseline_failed = baseline_failed
        # True when the baseline ran out of time, False when it was PROVED
        # impossible. Only meaningful alongside baseline_failed.
        self.baseline_timed_out = baseline_timed_out
        # The purchase step search stopped early. It looks `steps_requested` squads
        # ahead and got `steps_probed`, and silence about the difference reads as
        # "there is nothing further", which is a claim it never checked.
        self.steps_truncated = steps_truncated
        self.steps_probed = steps_probed
        self.steps_requested = steps_requested

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
        if self.baseline_failed:
            if self.baseline_timed_out:
                return (
                    "NO PLAN. The planner could not solve its own baseline model inside "
                    "its time budget, so it does not know what the club can feed and has "
                    "nothing to say about buying. This is not the same as there being "
                    "nothing to buy. Raise the planner's time budget."
                )
            return (
                "NO PLAN, and not for want of time: the baseline model is INFEASIBLE, so "
                "this queue cannot be fed at all in its current shape. That is a fact "
                "about the club and the challenges, not about the budget, and raising the "
                "budget will not change it."
            )

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
            elif self.steps_truncated:
                lines.append(
                    f"No purchase found in the {self.steps_probed} step(s) that were "
                    f"probed, and the search stopped short of the {self.steps_requested} "
                    f"asked for because it ran out of time. UNKNOWN beyond that, not nothing."
                )
            else:
                lines.append("Nothing left to unlock by buying: the queue is fully fed.")
        else:
            lines.append(f"Best value purchase: {best.describe()}")
            for step in uncostable:
                lines.append(f"Also possible, but not costable: {step.describe()}")
            if self.steps_truncated:
                lines.append(
                    f"Only {self.steps_probed} of {self.steps_requested} step(s) were "
                    f"probed before the time budget ran out, so a better one further out "
                    f"is UNKNOWN rather than ruled out."
                )
        return "\n".join(lines)

    @property
    def avoided_unpriced(self) -> list[int]:
        """Every rating the plan was steered away from for want of a price."""
        return sorted({r for step in self.steps for r in step.avoided_unpriced})

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
        # market_price ONLY. See the note in repeat_solve._supply_diagnosis: the
        # `cost` field is a weighted solver figure, not coins.
        if card.market_price is None:
            continue
        if card.rating not in cheapest or card.market_price < cheapest[card.rating]:
            cheapest[card.rating] = card.market_price
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
        pool, challenge.formation_slots, challenge.chemistry, challenge.multisets, budget, 8,
        rating_prices=rating_prices,
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
        # Only the first depth's explanation is printed. The rest contribute
        # their mode to the requirement and supply spans, so they do not pay for
        # the club limit bisection.
        diagnosis = _diagnose(
            search, depth, requirements, budget, with_limits=depth == achieved + 1
        )
        depths.append(DepthBlock(depth, diagnosis.mode, diagnosis.explanation))

    supply_depths = [d.depth for d in depths if d.mode == "supply"]
    conditional: list[SupplyShortfall] = []
    if supply_depths:
        conditional = _supply_diagnosis(
            pool, challenge.multisets, supply_depths[-1], rating_prices
        )
    return depths, conditional, probe_to


def _ceiling_with_others_held(
    pool: list[PoolCard],
    challenges: list[PlannerChallenge],
    ratings: list[int],
    unit: dict[int, int],
    held: dict[int, int],
    target: PlannerChallenge,
    known_achievable: dict[str, int],
    solve,
) -> int | None:
    """The most `target` could build with every other challenge held where it is.

    Not "the most it could build if it had the club to itself", which is a
    different and much less useful number in a queue.
    """
    model, squads, _, _ = _model(pool, challenges, ratings, unit, held, allow_purchases=False)
    for challenge in challenges:
        if challenge.name == target.name:
            continue
        fixed = known_achievable.get(challenge.name)
        if fixed is not None:
            model.Add(squads[challenge.name] == fixed)
    model.Maximize(squads[target.name])
    solver = solve(model, True)
    if solver is None:
        return None
    return solver.Value(squads[target.name])


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

    # Why a solve failed, for the last call to `solve`. INFEASIBLE and UNKNOWN
    # both came back as None, so "could not solve inside its time budget" was
    # printed for a model that was proved impossible in a millisecond. One of the
    # two is the planner's ignorance and the other is a fact about the club, and
    # they need different sentences.
    last_status: dict[str, int] = {}

    def solve(model, objective_is_max: bool, *, extra: tuple | None = None):
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_budget_seconds
        status = solver.Solve(model)
        last_status["status"] = status
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        return solver

    def timed_out() -> bool:
        return last_status.get("status") == cp_model.UNKNOWN

    # Baseline: nothing bought, as many squads as the club can feed. Priority
    # weights decide which challenges win the scarce cards.
    model, squads, _, _ = _model(pool, challenges, ratings, unit, held, allow_purchases=False)
    model.Maximize(sum(squads[c.name] * c.priority for c in challenges))
    solver = solve(model, True)
    if solver is None:
        # Its own baseline model did not solve. Reported as ignorance, not as
        # "nothing to buy", and WHICH kind of failure it was is carried through.
        return GrindPlan(
            baseline={}, steps=[], supply_limited=[], blocks=[], baseline_failed=True,
            baseline_timed_out=timed_out(),
        )
    ceiling = {c.name: solver.Value(squads[c.name]) for c in challenges}

    # A challenge the club can feed but the solver cannot build is FLAGGED, and a
    # flagged challenge is pinned to what it can really build so that no purchase
    # is ever quoted against it. Caveating the number instead would leave a coin
    # figure on the page, and a coin figure next to a warning reads as a coin figure.
    #
    # THE COMPARISON HAS TO BE APPLES TO APPLES. `ceiling` above comes from ONE
    # optimal solution of a degenerate objective: when two challenges carry the
    # same priority and the club can only feed one of them, which one gets the
    # squad is an arbitrary tie break, and the queue solver is free to break it
    # the other way. Comparing this challenge's count in the planner's solution
    # against its count in the queue's solution then flags a challenge that is
    # not blocked by anything, and reports "the club can feed 1 squads but only 0
    # can be built. Buying cards would not help" about a challenge that more
    # fodder would unlock immediately.
    #
    # So when the real counts are known, each challenge is re-ceilinged with every
    # OTHER challenge held at what it actually achieved. That asks the only
    # question a flag should turn on: with the rest of the queue as it stands,
    # could THIS one have done better? If not, it lost the race rather than
    # hitting a wall, which is contention and is reported per item, not here.
    effective = dict(ceiling)
    if known_achievable is not None:
        for challenge in challenges:
            achieved = known_achievable.get(challenge.name)
            if achieved is None:
                continue
            alone = _ceiling_with_others_held(
                pool, challenges, ratings, unit, held, challenge, known_achievable, solve
            )
            best = ceiling[challenge.name] if alone is None else alone
            effective[challenge.name] = max(achieved, best)

    blocks: list[RequirementBlock] = []
    pinned: dict[str, int] = {}
    if known_achievable is not None:
        for challenge in challenges:
            achieved = known_achievable.get(challenge.name)
            if achieved is None or achieved >= effective[challenge.name]:
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
                    supply_ceiling=effective[challenge.name],
                    depths=depths,
                    conditional_supply=conditional,
                    probed_to=probed_to,
                    requested=challenge.requested,
                )
            )

    baseline = {
        c.name: pinned.get(c.name, effective[c.name]) for c in challenges
    }
    baseline_total = sum(baseline.values())

    if len(blocks) == len(challenges) and blocks:
        # Nothing in the queue is unflagged, so there is no shopping list to give.
        return GrindPlan(
            baseline=baseline,
            steps=[],
            supply_limited=[],
            blocks=blocks,
            supply_ceiling=effective,
        )

    total_requested = sum(c.requested for c in challenges)
    steps: list[GrindStep] = []
    truncated = False
    # How many steps it MEANT to look, which is the smaller of the step cap and
    # what the queue actually asked for. Silence about the difference between this
    # and what it got reads as "there is nothing further".
    steps_requested = max(0, min(max_extra_steps, total_requested - baseline_total))
    steps_probed = 0
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
            # A step that timed out leaves the ones past it unlooked at. A step
            # that is INFEASIBLE means no purchase reaches that many squads, and
            # neither will any deeper one, so there is nothing further to say and
            # nothing was skipped.
            truncated = timed_out() and target <= total_requested
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
        bought = {p.rating for p in purchases}
        avoided = sorted(
            r for r in ratings if basis[r] == "unknown" and r not in bought
        )
        steps_probed = extra
        steps.append(
            GrindStep(
                extra_squads=extra,
                purchases=purchases,
                unlocks=unlocks,
                avoided_unpriced=avoided,
            )
        )

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
        steps_truncated=truncated,
        steps_probed=steps_probed,
        steps_requested=steps_requested,
    )
