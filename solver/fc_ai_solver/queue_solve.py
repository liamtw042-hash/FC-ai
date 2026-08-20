"""Set mode, queue mode and solution diversity. Brief 6.2, 6.3 and 6.4.

ONE MODEL, ONE POOL. A set is several challenges that must ALL complete; a queue
is any mix of one offs, sets and repeats. Both are solved jointly against the same
club, because solving one at a time burns the good fodder on the first item and
then fails on the fourth.

Everything here composes add_challenge rather than restating requirement logic, and
queue mode reports its supply picture through the existing grind planner rather
than a second one.
"""

from __future__ import annotations

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .challenge_model import ChallengeImpossible, add_challenge
from .costs import tally
from .grind_planner import GrindPlan, PlannerChallenge, plan_grind
from .repeat_solve import NegativeCostError, ShortfallDiagnosis, _diagnose, _Search
from .schema import ChemistryConfig, PlacedCard, PoolCard, Requirement
from .squad_size import SQUAD_SIZE, require_uniform_squad_sizes

ONE_OFF = "one_off"
SET = "set"
REPEAT = "repeat"


class QueueItem:
    """One thing in the queue: a challenge, how many of it, and how much it matters."""

    def __init__(
        self,
        name: str,
        formation_slots: list[str],
        requirements: list[Requirement] | None = None,
        chemistry: ChemistryConfig | None = None,
        multisets: list[dict[int, int]] | None = None,
        kind: str = ONE_OFF,
        count: int = 1,
        priority: int = 1,
        set_name: str | None = None,
    ) -> None:
        if count < 1:
            raise ValueError(f"{name}: count must be at least 1")
        if priority < 1:
            raise ValueError(f"{name}: priority must be at least 1")
        if kind not in (ONE_OFF, SET, REPEAT):
            raise ValueError(f"{name}: unknown queue item kind {kind!r}")
        self.name = name
        self.formation_slots = formation_slots
        self.requirements = requirements or []
        self.chemistry = chemistry
        self.multisets = multisets
        self.kind = kind
        # A one off and a set member are one squad each. A repeat is count squads.
        self.count = 1 if kind in (ONE_OFF, SET) else count
        self.priority = priority
        # Set members share a name so the set can be reported as a unit.
        self.set_name = set_name


class ItemOutcome:
    def __init__(
        self,
        item: QueueItem,
        achieved: int,
        squads: list[list[PlacedCard]],
        cost: int,
        diagnosis: ShortfallDiagnosis | None,
    ) -> None:
        self.item = item
        self.achieved = achieved
        self.squads = squads
        self.cost = cost
        self.diagnosis = diagnosis

    @property
    def name(self) -> str:
        return self.item.name

    @property
    def complete(self) -> bool:
        return self.achieved == self.item.count

    def describe(self) -> str:
        head = f"{self.name}: {self.achieved} of {self.item.count}"
        if self.complete:
            return f"{head}, {self.cost} cost"
        reason = self.diagnosis.explanation if self.diagnosis else "no diagnosis available"
        line = f"{head}. Squad {self.achieved + 1} blocked by {reason}"
        # ONE DEPTH IS NOT THE CHALLENGE. The diagnosis is about the NEXT squad
        # and nothing else. A requirement that blocks squad 4 need not block squad
        # 7, and a contention at squad 4 says nothing about whether squad 7 would
        # have been supply blocked anyway. Silence about the rest reads as "and
        # the same goes for all of them", which was never checked.
        remaining = self.item.count - self.achieved
        if remaining > 1:
            line += (
                f". Squads {self.achieved + 2} to {self.item.count} were NOT probed "
                f"separately, so what blocks them is unknown rather than the same thing"
            )
        return line


class QueueOutcome:
    def __init__(
        self,
        items: list[ItemOutcome],
        total_cost: int,
        coins_spent: int,
        value_burned: int,
        proven_optimal: bool,
        wall_time_seconds: float,
        plan: GrindPlan | None,
        failure: str | None = None,
    ) -> None:
        self.items = items
        self.total_cost = total_cost
        self.coins_spent = coins_spent
        self.value_burned = value_burned
        self.proven_optimal = proven_optimal
        self.wall_time_seconds = wall_time_seconds
        # The supply picture, from the existing planner. Never a second one.
        self.plan = plan
        # Set when the whole queue model came back with nothing. "Proved that not
        # one squad can be built" and "ran out of time before finding one" are
        # different facts, and an empty outcome that says neither reads as the
        # first. Nothing else in this file distinguishes them, so this does.
        self.failure = failure

    @property
    def squads_built(self) -> int:
        return sum(outcome.achieved for outcome in self.items)

    @property
    def complete(self) -> bool:
        return all(outcome.complete for outcome in self.items)

    def by_set(self) -> dict[str, list[ItemOutcome]]:
        grouped: dict[str, list[ItemOutcome]] = defaultdict(list)
        for outcome in self.items:
            if outcome.item.set_name is not None:
                grouped[outcome.item.set_name].append(outcome)
        return dict(grouped)

    def describe(self) -> str:
        if self.failure is not None:
            return self.failure
        lines = [
            f"{self.squads_built} squad(s) built, {self.coins_spent} coins spent, "
            f"{self.value_burned} value burned"
            + ("" if self.proven_optimal else ", NOT PROVEN OPTIMAL, best found in budget"),
        ]
        for outcome in self.items:
            lines.append(f"  {outcome.describe()}")

        for set_name, members in sorted(self.by_set().items()):
            done = [m for m in members if m.complete]
            if len(done) == len(members):
                total = sum(m.cost for m in members)
                lines.append(f"  set {set_name}: complete, {total} total cost")
            else:
                # Set level infeasibility is per challenge, not one failure for
                # the whole set: knowing which three of four work is actionable.
                failed = [m.name for m in members if not m.complete]
                ok = [m.name for m in done]
                lines.append(
                    f"  set {set_name}: INCOMPLETE. "
                    f"{', '.join(ok) if ok else 'nothing'} solvable, "
                    f"{', '.join(failed)} not"
                )
        if self.plan is not None:
            lines.append("")
            lines.append(self.plan.summary())
        return "\n".join(lines)


def _placements(solver, pool, place, slots, squad_index) -> tuple[list[PlacedCard], int]:
    placements: list[PlacedCard] = []
    cost = 0
    for s in range(SQUAD_SIZE):
        for i in range(len(pool)):
            if solver.Value(place[squad_index][i][s]):
                placements.append(
                    PlacedCard(
                        card_id=pool[i].id,
                        slot_index=s,
                        slot_position=slots[s],
                        in_position=slots[s] in pool[i].positions,
                    )
                )
                cost += pool[i].cost
                break
    return placements, cost


def solve_queue(
    pool: list[PoolCard],
    items: list[QueueItem],
    *,
    time_budget_seconds: float = 60.0,
    rating_prices: dict[int, int] | None = None,
    workers: int = 8,
    include_plan: bool = True,
) -> QueueOutcome:
    """Any mix of one offs, sets and repeats, one shared pool, nothing used twice.

    Objective is lexicographic: build as much as possible weighted by priority
    first, then spend as little as possible. Priority decides who gets the scarce
    fodder when the club cannot feed everything.
    """
    if not items:
        return QueueOutcome([], 0, 0, 0, True, 0.0, None)

    require_uniform_squad_sizes({item.name: item.formation_slots for item in items})

    negative = [card.id for card in pool if card.cost < 0]
    if negative:
        raise NegativeCostError(
            "these cards carry a negative cost, which would make an extra squad look "
            "like a gain: " + ", ".join(sorted(negative)[:5])
        )

    model = cp_model.CpModel()
    n = len(pool)

    # One squad slot per requested squad across the whole queue.
    slots_of: list[QueueItem] = []
    for item in items:
        slots_of.extend([item] * item.count)

    built = [model.NewBoolVar(f"built_{j}") for j in range(len(slots_of))]
    all_usage: list[list[cp_model.IntVar]] = []
    all_place: list[list[list[cp_model.IntVar]]] = []

    # Symmetry breaking within a repeat: identical squads fill in order.
    start = 0
    for item in items:
        for offset in range(1, item.count):
            model.Add(built[start + offset] <= built[start + offset - 1])
        start += item.count

    for j, item in enumerate(slots_of):
        usage = [model.NewIntVar(0, card.quantity, f"u_{j}_{i}") for i, card in enumerate(pool)]
        place = [
            [model.NewBoolVar(f"p_{j}_{i}_{s}") for s in range(SQUAD_SIZE)] for i in range(n)
        ]
        for s in range(SQUAD_SIZE):
            model.Add(sum(place[i][s] for i in range(n)) == built[j])
        for i in range(n):
            model.Add(sum(place[i][s] for s in range(SQUAD_SIZE)) == usage[i])
        model.Add(sum(usage) == SQUAD_SIZE * built[j])

        if item.multisets:
            by_rating: dict[int, list[int]] = defaultdict(list)
            for index, card in enumerate(pool):
                by_rating[card.rating].append(index)
            picks = [model.NewBoolVar(f"c_{j}_{k}") for k in range(len(item.multisets))]
            model.Add(sum(picks) == built[j])
            seen = {r for combo in item.multisets for r in combo}
            for rating in seen:
                model.Add(
                    sum(usage[i] for i in by_rating.get(rating, []))
                    == sum(picks[k] * combo.get(rating, 0) for k, combo in enumerate(item.multisets))
                )
            for index, card in enumerate(pool):
                if card.rating not in seen:
                    model.Add(usage[index] == 0)

        # Requirements apply only to a squad that is actually built. Gating them
        # on built[j] is what lets a queue the club cannot fully feed come back
        # partially solved rather than infeasible.
        add_challenge(
            model, pool, item.formation_slots, usage, place,
            item.requirements, item.chemistry, tag=f"q{j}", active=built[j],
        )
        all_usage.append(usage)
        all_place.append(place)

    for i, card in enumerate(pool):
        model.Add(sum(all_usage[j][i] for j in range(len(slots_of))) <= card.quantity)

    # Lexicographic: build weighted by priority first, then spend least.
    max_cost = sum(card.cost * card.quantity for card in pool) + 1
    model.Maximize(
        sum(built[j] * slots_of[j].priority for j in range(len(slots_of))) * max_cost
        - sum(all_usage[j][i] * pool[i].cost for j in range(len(slots_of)) for i in range(n))
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_budget_seconds
    solver.parameters.num_search_workers = workers
    started = time.perf_counter()
    status = solver.Solve(model)
    elapsed = time.perf_counter() - started

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        failure = (
            "NOTHING BUILT, and the model PROVED it: no squad in this queue can be "
            "built from this club as it stands."
            if status == cp_model.INFEASIBLE
            else (
                f"NOTHING FOUND in {elapsed:.1f}s, which is NOT the same as nothing "
                f"being possible. The search ran out of time before finding even one "
                f"squad. Raise time_budget_seconds, or shorten the queue."
            )
        )
        return QueueOutcome([], 0, 0, 0, False, elapsed, None, failure=failure)

    outcomes: list[ItemOutcome] = []
    total_cost = coins = burned = 0
    index = 0
    for item in items:
        squads: list[list[PlacedCard]] = []
        cost = 0
        for _ in range(item.count):
            if solver.Value(built[index]):
                placements, squad_cost = _placements(
                    solver, pool, all_place, item.formation_slots, index
                )
                squads.append(placements)
                cost += squad_cost
            index += 1
        total_cost += cost
        _, item_coins, item_burned = tally(pool, squads)
        coins += item_coins
        burned += item_burned

        diagnosis = None
        if len(squads) < item.count:
            diagnosis = _diagnose_in_queue(
                pool, items, all_usage, solver, slots_of, item, len(squads),
                min(time_budget_seconds, 10.0), workers, rating_prices,
            )
        outcomes.append(ItemOutcome(item, len(squads), squads, cost, diagnosis))

    plan = None
    if include_plan:
        plan = plan_grind(
            pool,
            [
                PlannerChallenge(
                    item.name, item.count, item.multisets, item.priority,
                    formation_slots=item.formation_slots,
                    requirements=item.requirements,
                    chemistry=item.chemistry,
                )
                for item in items
            ],
            known_achievable={o.name: o.achieved for o in outcomes},
            rating_prices=rating_prices,
        )

    return QueueOutcome(
        items=outcomes,
        total_cost=total_cost,
        coins_spent=coins,
        value_burned=burned,
        proven_optimal=status == cp_model.OPTIMAL,
        wall_time_seconds=elapsed,
        plan=plan,
    )


def _residual_pool(
    pool: list[PoolCard],
    items: list[QueueItem],
    all_usage,
    solver,
    slots_of: list[QueueItem],
    target: QueueItem,
) -> list[PoolCard]:
    """The club as it stands after every OTHER item in the queue has taken its cards."""
    taken = [0] * len(pool)
    for j, owner in enumerate(slots_of):
        if owner is target:
            continue
        for i in range(len(pool)):
            taken[i] += solver.Value(all_usage[j][i])
    residual = []
    for i, card in enumerate(pool):
        left = card.quantity - taken[i]
        if left > 0:
            residual.append(card.model_copy(update={"quantity": left}))
    return residual


def _diagnose_in_queue(
    pool: list[PoolCard],
    items: list[QueueItem],
    all_usage,
    solver,
    slots_of: list[QueueItem],
    target: QueueItem,
    achieved: int,
    budget: float,
    workers: int,
    rating_prices: dict[int, int] | None = None,
) -> ShortfallDiagnosis:
    """Why this item fell short IN THE QUEUE, which is a different question.

    CONTENTION IS A FIFTH KIND OF CAUSE, and diagnosing against the whole club
    misses it entirely. A queue item can be perfectly buildable on its own and
    still lose out because higher priority items took the cards first. The first
    version of this reported "the pool holds enough cards at every rating" while
    the planner, in the same breath, said buying three cards would unlock it. Both
    were right about different pools.

    Contention is exactly "buildable alone, not buildable here", so that is the
    question asked first. When the answer is yes, the cause is the queue and the
    detail comes from the RESIDUAL pool, what is left after everyone else has
    taken their share. When the answer is no, the cause is intrinsic to the item
    and the WHOLE club is the right pool to diagnose against: against the residual
    an impossible requirement reads as "the club is running out of cards", which
    is true of the leftovers and useless as advice.
    """
    alone = _Search(
        pool, target.formation_slots, target.chemistry, target.multisets, budget, workers,
        rating_prices=rating_prices,
    )
    if not alone.feasible(achieved + 1, list(target.requirements), budget):
        # Not the queue's fault. The strongest true statement is about the club.
        return _diagnose(alone, achieved + 1, list(target.requirements), budget)

    residual = _residual_pool(pool, items, all_usage, solver, slots_of, target)
    residual_search = _Search(
        residual, target.formation_slots, target.chemistry, target.multisets, budget, workers,
        price_pool=pool, rating_prices=rating_prices,
    )
    diagnosis = _diagnose(residual_search, achieved + 1, list(target.requirements), budget)
    rivals = sorted(
        {other.name for other in items if other is not target and other.priority >= target.priority}
    )
    who = ", ".join(rivals) if rivals else "other items in the queue"
    return ShortfallDiagnosis(
        mode="contention",
        blocking=[],
        contributions=[],
        explanation=(
            f"CONTENTION, not this challenge. On its own the club could build squad "
            f"{achieved + 1}, but {who} took the cards first. Raise this item's "
            f"priority, drop one of those, or buy more fodder. Against what is left: "
            f"{diagnosis.explanation}"
        ),
        supply=diagnosis.supply,
    )


def solve_set(
    pool: list[PoolCard],
    challenges: list[QueueItem],
    *,
    time_budget_seconds: float = 60.0,
    rating_prices: dict[int, int] | None = None,
    workers: int = 8,
) -> QueueOutcome:
    """An SBC set: every challenge must complete. Brief 6.2.

    Solved jointly. Set level infeasibility is reported per challenge rather than
    as one failure, because "challenges 1, 2 and 4 solvable, 3 fails on minimum 2
    TOTW" is actionable and "the set failed" is not.
    """
    set_name = challenges[0].set_name if challenges else None
    for challenge in challenges:
        challenge.kind = SET
        challenge.count = 1
        if challenge.set_name is None:
            challenge.set_name = set_name or "set"
    return solve_queue(
        pool, challenges, time_budget_seconds=time_budget_seconds,
        rating_prices=rating_prices, workers=workers,
    )
