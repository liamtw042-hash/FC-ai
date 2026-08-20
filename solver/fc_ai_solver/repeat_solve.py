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


def lexicographic_scale(max_squads: int) -> int:
    """The multiplier that makes cost dominate the squad count tie break.

    The count term is the number of squads built, which is bounded above by
    max_squads. Scaling cost by max_squads + 1 therefore makes one coin of real
    cost strictly larger than the entire count term, so the tie break can only
    ever decide between solutions of equal cost.

    This holds ONLY because costs are whole coins. A fractional coin makes the
    smallest cost difference arbitrarily small and the tie break starts deciding
    things it has no business deciding. Both boundaries refuse non integer costs:
    costModel.ts on the way out, pydantic on the way in.
    """
    return max_squads + 1


def lexicographic_objective(total_cost: int, squads_built: int, max_squads: int) -> int:
    """The value the model minimises, as a plain function, so it can be tested."""
    return total_cost * lexicographic_scale(max_squads) + squads_built


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

    scale = lexicographic_scale(max_squads)
    # Lexicographic: cost first, then FEWER SQUADS.
    #
    # Without the second term the objective is merely indifferent when the fodder
    # is free, so the solver may build three squads for a cost of zero and be
    # exactly as right as building one. That surfaced as a flaky test rather than
    # a wrong answer, which is the worst way for it to surface.
    #
    # Scaling the cost by max_squads + 1 makes a single coin of real cost outweigh
    # the entire count term, so the tie break can never override a genuine price
    # difference. It only decides ties. See lexicographic_scale.
    model.Minimize(
        sum(
            place[j][i][s] * pool[i].cost * scale
            for j in range(max_squads)
            for i in range(n)
            for s in range(SQUAD_SIZE)
        )
        + sum(built)
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


class SupplyShortfall:
    """How many cards of a rating are missing, and what closing the gap costs.

    rating is None when the challenge has no rating requirement, so the shortfall
    is in cards generally. It used to be 0, which rendered as "cards rated 0".

    WHY THERE IS NO ESTIMATED PRICE.

    A rating the club holds none of used to be priced at the dearest card in the
    club. That is an estimate rendered as a plain number, and it can be out by a
    large factor: a club topping out at 84 asked for 90s would quote an 84's price
    for a card worth many times that. A wrong number gets acted on. A missing one
    gets asked about. So an unpriced rating carries unit_cost None and basis
    "unknown", and everything downstream refuses to quote a coin figure for a step
    containing one, the same way a flagged challenge has its purchase suppressed.
    """

    def __init__(
        self,
        rating: int | None,
        needed: int,
        held: int,
        unit_cost: int | None,
        basis: str = "unknown",
    ) -> None:
        self.rating = rating
        self.needed = needed
        self.held = held
        self.unit_cost = unit_cost
        # "table" from the supplied price table, "pool" from the cheapest card of
        # that rating in the club, "unknown" when neither exists.
        self.basis = basis

    @property
    def is_priced(self) -> bool:
        return self.unit_cost is not None

    @property
    def missing(self) -> int:
        return max(0, self.needed - self.held)

    @property
    def cost_to_close(self) -> int | None:
        return None if self.unit_cost is None else self.missing * self.unit_cost

    def describe(self, count: int) -> str:
        what = "cards" if self.rating is None else f"cards rated {self.rating}"
        return (
            f"{count} squads need {self.needed} {what}, you have {self.held}, "
            f"add {self.missing}"
        )


class ClubLimit:
    """One requirement, what it asked for, and the best this club can really do.

    NAMING THE REQUIREMENT IS HALF AN ANSWER. "min 5 players from Serie A blocks
    this" leaves the reader to work out whether they are one card short or five,
    and whether buying is the fix or the SBC is simply out of reach. So the value
    is bisected against the real pool with every other requirement still in force:
    the answer is the tightest value this club could actually meet.

    `reachable` is False when no value works, not even a vacuous one. That means
    the requirement is named because it participates, not because it is the whole
    story, and the explanation says so instead of quoting a misleading number.
    """

    def __init__(
        self,
        requirement: Requirement,
        name: str,
        asked: int | None,
        best: int | None,
        reachable: bool,
    ) -> None:
        self.requirement = requirement
        self.name = name
        self.asked = asked
        # The tightest value the club can meet. For a `min` that is the largest
        # value still satisfiable; for a `max`, the smallest.
        self.best = best
        self.reachable = reachable

    @property
    def gap(self) -> int | None:
        if self.asked is None or self.best is None:
            return None
        return abs(self.asked - self.best)

    def describe(self) -> str:
        if self.asked is None:
            return f"{self.name}: no numeric value, so there is no gap to quote"
        if not self.reachable:
            return (
                f"{self.name}: removing it outright does not unblock this either, so it "
                f"is part of the answer rather than all of it"
            )
        if self.best is None:
            return (
                f"{self.name}: removing it unblocks this, but no loosening of its value "
                f"within range does"
            )
        if self.gap == 0:
            return (
                f"{self.name}: your club meets this as written, so it is named for what "
                f"it does in combination, not on its own"
            )
        direction = "at most" if self.requirement.op == "max" else "at best"
        return (
            f"{self.name}: your club can manage {direction} {self.best}, "
            f"{self.gap} short of the {self.asked} asked for"
        )


class ShortfallDiagnosis:
    """Why squad M+1 could not be built.

    THE MODES, IN ORDER, AND THE MODE IS PART OF THE ANSWER.

      requirement       one requirement blocks it, found by removing it
      requirement_pair  two together block it, and neither alone does
      requirement_set   three or more together, found by deletion filter, and
                        minimal: no proper subset of them is infeasible
      supply            no requirement is at fault. The club is short of cards
      contention        queue only. Buildable alone, outbid here
      unexplained       none of the above. Says so rather than guessing

    Single removal only ever finds single blockers, and the realistic case on a
    long run is a combination. But subset search over REQUIREMENTS cannot explain
    a shortfall that has no requirement in it at all: a run can die purely on the
    club running out of cards at some rating, and falling through to "closest to
    binding" would then name a requirement that is not the cause. That is worse
    than silence, because it sends the reader shopping for the wrong cards.

    So supply is checked after subsets fail and before anything is blamed.
    """

    def __init__(
        self,
        mode: str,
        blocking: list[str],
        contributions: list[tuple[str, int | None]],
        explanation: str,
        supply: list[SupplyShortfall] | None = None,
        limits: list[ClubLimit] | None = None,
        probes_timed_out: int = 0,
    ) -> None:
        self.mode = mode
        # The smallest subset whose removal unblocks the next squad. One or two
        # entries, or empty when no small subset explains it.
        self.blocking = blocking
        # Requirement to the smallest relaxation of its value that would unblock,
        # or None when no relaxation within the probe range helps.
        self.contributions = contributions
        self.explanation = explanation
        # Ratings the club is short of, cheapest gap to close first.
        self.supply = supply or []
        # For each named requirement, the best this club can actually do against
        # it. "min 5 from Serie A" with three Serie A cards in the club is a
        # different conversation from one with four.
        self.limits = limits or []
        # How many probes behind this answer ran out of time instead of
        # answering. Above zero, this is what was FOUND, not what is there.
        self.probes_timed_out = probes_timed_out

    @property
    def subset_size(self) -> int | None:
        return len(self.blocking) if self.blocking else None

    @property
    def is_requirement_mode(self) -> bool:
        return self.mode in ("requirement", "requirement_pair", "requirement_set")

    @property
    def complete(self) -> bool:
        """False when a probe timed out, so this is a lower bound on the truth."""
        return self.probes_timed_out == 0


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

    def __init__(
        self, pool, slots, chemistry, multisets, budget, workers, *,
        price_pool=None, rating_prices=None,
    ):
        self.pool = pool
        # What the market charges, when `pool` is only what is left of the club.
        self.price_pool = price_pool if price_pool is not None else pool
        # The price by rating table, when the caller has one. Best source there is.
        self.rating_prices = rating_prices
        self.slots = slots
        self.chemistry = chemistry
        self.multisets = multisets
        self.budget = budget
        self.workers = workers
        self.solves = 0
        self.elapsed = 0.0
        # Probes that ran out of time. NOT the same as probes that came back
        # infeasible, and the difference is the whole point: `feasible` has to
        # return a bool, so a timeout reads as "no". Every conclusion drawn from
        # a timed out probe is "we did not finish looking", and downstream says so.
        self.unknown = 0

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
        if status == cp_model.UNKNOWN:
            self.unknown += 1
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


def _supply_diagnosis(
    pool: list[PoolCard],
    multisets: list[dict[int, int]] | None,
    count: int,
    rating_prices: dict[int, int] | None = None,
    avoided_unpriced: list[int] | None = None,
    price_pool: list[PoolCard] | None = None,
) -> list[SupplyShortfall]:
    """Which ratings the club runs out of at this count, and by how many.

    Solved as a tiny relaxed model: pick how many squads take each allowed rating
    multiset, allowing cards to be conjured, and minimise the COST of conjuring
    them. Everything else is dropped, so what comes back is a statement about the
    club's contents and nothing else.

    Minimising cost rather than card count matters: three cards rated 86 and
    twelve rated 85 can both close the same gap, and which one to go and buy
    depends on what they cost, not on how many there are.
    """
    if avoided_unpriced is None:
        avoided_unpriced = []
    avoided_unpriced.clear()

    held: dict[int, int] = defaultdict(int)
    for card in pool:
        held[card.rating] += card.quantity
    # HOW MANY is a question about this pool. HOW MUCH EACH is a question about the
    # market, so prices come from the whole club when the pool being counted is a
    # residual. Otherwise a rating the queue has spent down to zero reads as having
    # no price at all, while the planner quotes it in the same output.
    # market_price ONLY, never `cost`. `cost` is the weighted figure the solver
    # minimises: it can be 50 for a card that lists at 4000, and a shortfall that
    # quoted it would read as a shopping list priced at a fiftieth of the truth.
    cheapest: dict[int, int] = {}
    for card in price_pool if price_pool is not None else pool:
        if card.market_price is None:
            continue
        if card.rating not in cheapest or card.market_price < cheapest[card.rating]:
            cheapest[card.rating] = card.market_price

    if not multisets:
        # No rating constraint, so the only supply question is whether there are
        # enough cards at all.
        total = sum(held.values())
        needed = count * SQUAD_SIZE
        if total >= needed:
            return []
        return [SupplyShortfall(rating=None, needed=needed, held=total, unit_cost=None)]

    ratings = sorted({r for combo in multisets for r in combo})
    # Price resolution, best source first, and NO fallback estimate. A rating with
    # neither a table price nor a card in the club is genuinely unpriced and says so.
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

    # Weight for the optimisation only. An unpriced rating is weighted above every
    # priced one, so the model avoids buying what it cannot cost WHEN there is a
    # priced alternative. That is a deliberate bias toward the option that can be
    # reported honestly, and it is why the chosen mix may not be the true cheapest
    # when an unpriced rating is involved. Said out loud downstream.
    priced = [value for value in unit.values() if value is not None]
    sentinel = (max(priced) * 100 + 1) if priced else 1
    weight = {r: (unit[r] if unit[r] is not None else sentinel) for r in ratings}

    model = cp_model.CpModel()
    take = [model.NewIntVar(0, count, f"take_{k}") for k in range(len(multisets))]
    model.Add(sum(take) == count)
    add = {r: model.NewIntVar(0, count * SQUAD_SIZE, f"add_{r}") for r in ratings}
    used = {}
    for r in ratings:
        total_used = sum(take[k] * multisets[k].get(r, 0) for k in range(len(multisets)))
        usage = model.NewIntVar(0, count * SQUAD_SIZE, f"used_{r}")
        model.Add(usage == total_used)
        used[r] = usage
        model.Add(usage <= held.get(r, 0) + add[r])
    model.Minimize(sum(add[r] * weight[r] for r in ratings))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Returning an empty list here would read as "the club has enough", and
        # the caller would go on to blame a requirement. This model is small and
        # always feasible, so a failure is a bug worth surfacing, not absorbing.
        raise RuntimeError(
            f"the supply model failed to solve for {count} squads (status "
            f"{solver.StatusName(status)}). Empty would have been read as "
            f"'the club has enough', which is not what this means."
        )

    shortfalls = [
        SupplyShortfall(
            rating=r,
            needed=solver.Value(used[r]),
            held=held.get(r, 0),
            unit_cost=unit[r],
            basis=basis[r],
        )
        for r in ratings
        if solver.Value(add[r]) > 0
    ]
    # Priced gaps first, cheapest among them, with the unpriced ones last so they
    # never head a list that reads as a recommendation.
    shortfalls.sort(
        key=lambda s: (
            0 if s.is_priced else 1,
            s.cost_to_close if s.cost_to_close is not None else 0,
            s.missing,
        )
    )
    # Ratings the model could have bought but avoided BECAUSE they have no price.
    # The weighting deliberately pushes it away from them, so a mix using them
    # might be cheaper and nothing here can tell. Recorded so the caller can say so
    # next to the numbers rather than only in a design note.
    bought = {s.rating for s in shortfalls}
    avoided_unpriced.extend(
        sorted(r for r in ratings if basis[r] == "unknown" and r not in bought)
    )
    return shortfalls


def _supply_or_unexplained(
    search: _Search,
    target_count: int,
    requirements: list[Requirement],
    probe_budget: float,
    pairs_searched: bool,
    requirements_ruled_out: bool = False,
) -> ShortfallDiagnosis:
    """Supply first, because a requirement named for a supply problem misleads."""
    avoided: list[int] = []
    shortfalls = _supply_diagnosis(
        search.pool, search.multisets, target_count,
        rating_prices=search.rating_prices,
        avoided_unpriced=avoided,
        price_pool=search.price_pool,
    )
    if shortfalls:
        lines = "; ".join(s.describe(target_count) for s in shortfalls)
        tail = ""
        unpriced = [s for s in shortfalls if not s.is_priced]
        if unpriced:
            which = ", ".join(str(s.rating) for s in unpriced)
            tail = (
                f". These are all needed together, not instead of each other. The total "
                f"cost is NOT quoted because rating(s) {which} have no price: supply one "
                f"before treating this as a shopping list"
            )
        elif avoided:
            which = ", ".join(str(r) for r in avoided)
            total = sum(s.cost_to_close or 0 for s in shortfalls)
            plural = "s" if len(shortfalls) > 1 else ""
            tail = (
                f". {'All of these are needed together, ' if len(shortfalls) > 1 else ''}"
                f"{total} coins in total. This mix AVOIDS rating{plural} {which}, which have "
                f"no price, so a mix using them might be cheaper and nothing here can tell"
            )
        elif len(shortfalls) > 1:
            # These are not alternatives. The model returns the cheapest SET of
            # additions that together reach the count, so every one of them is
            # required. "Cheapest gap" used to head this list and read as a menu.
            total = sum(s.cost_to_close or 0 for s in shortfalls)
            tail = (
                f". All {len(shortfalls)} of these are needed together, not instead of "
                f"each other, for {total} coins in total"
            )
        return ShortfallDiagnosis(
            mode="supply",
            blocking=[],
            contributions=[],
            explanation=f"the club running out of cards, not any requirement: {lines}{tail}",
            supply=shortfalls,
        )

    if not requirements or requirements_ruled_out:
        ruled_out = (
            " Removing EVERY requirement does not unblock it either, so the requirements "
            "are ruled out rather than merely unproven."
            if requirements_ruled_out and requirements
            else ""
        )
        return ShortfallDiagnosis(
            mode="unexplained",
            blocking=[],
            contributions=[],
            explanation=(
                "the pool, though it holds enough cards at every rating. Something "
                f"about how they combine is the limit.{ruled_out}"
            ),
        )

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
    skipped = "" if pairs_searched else ", and there were too many requirements to search pairs"
    if movable:
        closest = ", ".join(
            f"{name} (loosen by {by})" for name, by in sorted(movable, key=lambda x: x[1])
        )
        explanation = (
            f"no single requirement and no pair explains it{skipped}, and the club is not "
            f"short of cards. Closest to binding: {closest}"
        )
    else:
        explanation = (
            f"no single requirement and no pair explains it{skipped}, the club is not short "
            f"of cards, and no requirement loosened by up to 3 unblocks it either"
        )
    return ShortfallDiagnosis(
        mode="unexplained", blocking=[], contributions=contributions, explanation=explanation
    )


def _club_limit(
    search: _Search,
    target_count: int,
    requirements: list[Requirement],
    requirement: Requirement,
    probe_budget: float,
) -> ClubLimit:
    """The tightest value of `requirement` this club can meet, everything else held.

    Bisection, not a fixed probe range. The old code loosened by 1, 2 and 3 and
    gave up, which answers "is it close" but never "how far". On a club three
    Serie A cards deep asked for eight, "loosening by up to 3 does not help" is
    true and useless; "your club can manage 3, five short of the 8 asked for" is
    the same fact with the number the reader needs in it.

    The span is found by DOUBLING first, the same idiom as `largest_feasible`,
    rather than from a formula. A formula needs to know what the value means: a
    `max 3` on a league count loosens toward eleven, a `max 84` on a player rating
    loosens toward ninety nine, and the difference is a game rule this service is
    not allowed to hold. Doubling until it works needs to know nothing.
    """
    name = _describe(requirement)
    others = [r for r in requirements if r is not requirement]
    if requirement.value is None:
        return ClubLimit(requirement, name, None, None, False)

    # If removing it outright does not unblock, no loosening of it can, and this
    # requirement is part of the answer rather than all of it. One solve settles it.
    if not search.feasible(target_count, others, probe_budget):
        return ClubLimit(requirement, name, requirement.value, None, False)

    def satisfiable(by: int) -> bool:
        loosened = _relaxed(requirement, by)
        if loosened is None:
            # Loosened past vacuous, which is the same as not being there.
            return True
        return search.feasible(target_count, [loosened, *others], probe_budget)

    if satisfiable(0):
        # The requirement is met as written, so it is named for taking part in a
        # combination rather than for its own value.
        return ClubLimit(requirement, name, requirement.value, requirement.value, True)

    # A ceiling from the data, not from what the value is taken to mean: no value
    # past the highest rating in the club or the squad size can still bind.
    highest = max((card.rating for card in search.pool), default=0)
    ceiling = max(SQUAD_SIZE, highest, requirement.value) + 1

    low, high = 0, 1
    while high <= ceiling and not satisfiable(high):
        low, high = high, high * 2
    if high > ceiling:
        # Removing it works but no loosening within range does. Rare, and worth
        # saying plainly rather than quoting a number that is not there.
        return ClubLimit(requirement, name, requirement.value, None, True)

    while low + 1 < high:
        middle = (low + high) // 2
        if satisfiable(middle):
            high = middle
        else:
            low = middle
    best = (
        requirement.value + high if requirement.op == "max" else requirement.value - high
    )
    return ClubLimit(requirement, name, requirement.value, best, True)


def _minimal_blocking_set(
    search: _Search,
    target_count: int,
    requirements: list[Requirement],
    probe_budget: float,
) -> list[Requirement] | None:
    """The smallest set of requirements that is still infeasible on its own.

    A DELETION FILTER, which is the generalisation the singles and pairs ladder
    was missing. Singles find one blocker, pairs find two, and a real SBC with
    three requirements that only conflict together fell off the end of both and
    got reported as unexplained. The filter walks the list once, dropping any
    requirement the problem stays infeasible without, and what survives is a
    minimal infeasible subset: every member matters, no proper subset is
    infeasible. |R| feasibility checks, cheaper than the pair search it follows.

    NOTE THE DIFFERENCE IN KIND. Singles and pairs report a set whose REMOVAL
    unblocks the squad. This returns a set that is INFEASIBLE ON ITS OWN. Removing
    one member of it makes that subset feasible, but the whole challenge can still
    fail on a second conflict, so the wording downstream says exactly that and no
    more.

    Returns None when the requirements are not the cause at all, which the filter
    detects for free: if the problem is still infeasible with EVERY requirement
    removed, no subset of them explains anything.
    """
    if not search.feasible(target_count, [], probe_budget):
        return None

    kept = list(requirements)
    for candidate in list(requirements):
        trial = [r for r in kept if r is not candidate]
        if not search.feasible(target_count, trial, probe_budget):
            kept = trial
    return kept or None


def _diagnose(
    search: _Search,
    target_count: int,
    requirements: list[Requirement],
    probe_budget: float,
    *,
    with_limits: bool = True,
) -> ShortfallDiagnosis:
    """Why squad `target_count` cannot be built.

    Singles, pairs, minimal set, supply, honesty. Every mode that names a
    requirement also carries what the club can really do against it, because a
    named requirement without a number is half an answer.
    """
    # Every conclusion below is drawn from probes that can run out of time, and a
    # probe that runs out of time returns False just like one that proved
    # infeasibility. So the count is snapshotted here and every answer is stamped
    # with how many of the probes behind it never finished. "No single requirement
    # explains it" and "no single requirement explains it, and four probes ran out
    # of time" are different claims, and only one of them was checked.
    started_unknown = search.unknown

    def stamp(diagnosis: ShortfallDiagnosis) -> ShortfallDiagnosis:
        timed_out = search.unknown - started_unknown
        if timed_out == 0:
            return diagnosis
        diagnosis.probes_timed_out = timed_out
        diagnosis.explanation += (
            f". NOT A COMPLETE ANSWER: {timed_out} of the probes behind it ran out of "
            f"time rather than finishing, so this is what was found and not what is "
            f"there. Raise the diagnosis budget to be sure"
        )
        return diagnosis

    if not requirements:
        return stamp(_supply_or_unexplained(search, target_count, [], probe_budget, True))

    def limits_for(named: list[Requirement]) -> list[ClubLimit]:
        # Each limit is a doubling then a bisection, so a handful of solves per
        # requirement. Worth it where the answer is read; wasted at a depth that
        # only contributes its mode to a span. The planner probes ten depths and
        # prints one, so it asks for limits at the one it prints.
        if not with_limits:
            return []
        return [_club_limit(search, target_count, requirements, r, probe_budget) for r in named]

    # Singles. EVERY one that unblocks on its own, not the first found: two
    # requirements can each be independently sufficient to fix, and reporting one
    # sends the reader to clear it and come back to the same wall.
    singles = [
        requirement
        for index, requirement in enumerate(requirements)
        if search.feasible(
            target_count, requirements[:index] + requirements[index + 1 :], probe_budget
        )
    ]
    if singles:
        names = [_describe(r) for r in singles]
        explanation = (
            names[0]
            if len(names) == 1
            else (
                ", ".join(names[:-1])
                + f" or {names[-1]}. Each of these blocks it on its own, so removing ANY "
                f"one unblocks squad {target_count}"
            )
        )
        limits = limits_for(singles)
        detail = ". ".join(limit.describe() for limit in limits)
        return stamp(ShortfallDiagnosis(
            mode="requirement",
            blocking=names,
            contributions=[],
            explanation=f"{explanation}. {detail}" if detail else explanation,
            limits=limits,
        ))

    # Pairs. Bounded, because the number of pairs grows quadratically and a real
    # SBC with twenty requirements would spend the whole budget here.
    MAX_FOR_PAIRS = 8
    pairs_searched = len(requirements) <= MAX_FOR_PAIRS
    if pairs_searched:
        for first, second in combinations(range(len(requirements)), 2):
            reduced = [r for k, r in enumerate(requirements) if k not in (first, second)]
            if search.feasible(target_count, reduced, probe_budget):
                pair = [requirements[first], requirements[second]]
                names = [_describe(pair[0]), _describe(pair[1])]
                limits = limits_for(pair)
                detail = ". ".join(limit.describe() for limit in limits)
                return stamp(ShortfallDiagnosis(
                    mode="requirement_pair",
                    blocking=names,
                    contributions=[],
                    explanation=(
                        f"{names[0]} and {names[1]} together. Neither alone is enough, "
                        f"which is why removing one at a time finds nothing. {detail}"
                    ),
                    limits=limits,
                ))

    # Three or more together. The deletion filter generalises the ladder above
    # rather than sitting beside it: it returns a MINIMAL infeasible subset, so a
    # three way conflict that singles and pairs both walk past is named exactly,
    # and a shortfall with no requirement in it at all comes back as None and
    # falls through to supply, which is where it belongs.
    minimal = _minimal_blocking_set(search, target_count, requirements, probe_budget)
    if minimal is not None:
        names = [_describe(r) for r in minimal]
        limits = limits_for(minimal)
        detail = ". ".join(limit.describe() for limit in limits)
        # Size decides the mode, because the filter also covers the one and two
        # requirement cases when the pair search was skipped for being too wide.
        mode = {1: "requirement", 2: "requirement_pair"}.get(len(names), "requirement_set")
        if len(names) == 1:
            head = names[0]
        elif len(names) == 2:
            head = (
                f"{names[0]} and {names[1]} together. Neither alone is enough, which is "
                f"why removing one at a time finds nothing"
            )
        else:
            # PRECISION MATTERS HERE. The singles and pairs above report a set
            # whose REMOVAL unblocks the squad. What the deletion filter returns
            # is a different thing: a set that is infeasible ON ITS OWN and
            # minimally so. Dropping any one member breaks THIS conflict, but the
            # challenge can still fail on another one, and saying "dropping any of
            # these unblocks it" would be a claim the filter has not checked.
            head = (
                f"these {len(names)} requirements CONFLICT WITH EACH OTHER against your "
                f"club: {', '.join(names)}. No proper subset of them is impossible, so "
                f"every one of them takes part. That is why removing them one and two at "
                f"a time found nothing. Dropping any single one settles THIS conflict, "
                f"though the challenge may still fail on another"
            )
        return stamp(ShortfallDiagnosis(
            mode=mode,
            blocking=names,
            contributions=[],
            explanation=f"{head}. {detail}" if detail else head,
            limits=limits,
        ))

    # The filter came back None, which means the problem is still infeasible with
    # every requirement removed. The requirements are RULED OUT, not merely
    # unproven, and saying so is stronger than listing what is closest to binding.
    return stamp(
        _supply_or_unexplained(
            search, target_count, requirements, probe_budget, pairs_searched,
            requirements_ruled_out=True,
        )
    )


def solve_repeat(
    pool: list[PoolCard],
    formation_slots: list[str],
    *,
    requested: int,
    requirements: list[Requirement] | None = None,
    chemistry: ChemistryConfig | None = None,
    allowed_rating_multisets: list[dict[int, int]] | None = None,
    rating_prices: dict[int, int] | None = None,
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
        pool, formation_slots, chemistry, allowed_rating_multisets, time_budget_seconds, workers,
        rating_prices=rating_prices,
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
