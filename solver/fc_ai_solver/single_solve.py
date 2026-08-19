"""Single challenge solve. Brief 5, sub problem solver.

Picks real cards to fill an exact rating multiset, places them into formation
slots, satisfies the non chemistry requirements, and minimises cost.

Chemistry is modelled here too, but not one of its numbers lives in this package:
the ladders and contribution weights arrive as data from the TypeScript rules
engine. See chemistry_model.py.

Card usage is an INTEGER bounded by quantity, never a boolean. A boolean silently
caps every stack at one, and duplicate fodder is most of what an SBC eats.
"""

from __future__ import annotations

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .chemistry_model import MissingChemistryRules, add_chemistry
from .schema import PlacedCard, PoolCard, Requirement, SolveRequest, SolveResponse

SQUAD_SIZE = 11


def _quality_of(rating: int) -> str:
    if rating <= 64:
        return "bronze"
    if rating <= 74:
        return "silver"
    return "gold"


def _group_by(pool: list[PoolCard], key) -> dict[str, list[int]]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, card in enumerate(pool):
        value = key(card)
        # A null entity is an absent entity, never a shared blank. Icons have no
        # club and no league and must not all pile up under one empty key.
        if value is None:
            continue
        groups[value].append(index)
    return groups


class UnsupportedRequirement(ValueError):
    """Raised rather than silently ignoring a requirement we cannot express.

    Quietly dropping a constraint would return a squad the game rejects, which is
    the one outcome worth failing loudly to avoid.
    """


def solve_single(request: SolveRequest) -> SolveResponse:
    pool = request.pool
    slots = request.formation_slots
    if len(slots) != SQUAD_SIZE:
        raise ValueError(f"a squad needs {SQUAD_SIZE} slots, got {len(slots)}")

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

    clubs = _group_by(pool, lambda c: c.club)
    leagues = _group_by(pool, lambda c: c.league)
    nations = _group_by(pool, lambda c: c.nation)

    def count_of(indices: list[int]):
        return sum(usage[i] for i in indices) if indices else 0

    def apply_op(expression, op: str, value: int) -> None:
        if op == "min":
            model.Add(expression >= value)
        elif op == "max":
            model.Add(expression <= value)
        elif op == "exact":
            model.Add(expression == value)
        else:
            raise UnsupportedRequirement(f"unknown operator {op!r}")

    def entity_counts(groups: dict[str, list[int]]):
        """One integer per entity, plus a used flag, for distinct and same rules."""
        counts = {}
        used = {}
        for name, indices in groups.items():
            total = model.NewIntVar(0, SQUAD_SIZE, f"count_{name}")
            model.Add(total == count_of(indices))
            flag = model.NewBoolVar(f"used_{name}")
            model.Add(total >= 1).OnlyEnforceIf(flag)
            model.Add(total == 0).OnlyEnforceIf(flag.Not())
            counts[name] = total
            used[name] = flag
        return counts, used

    club_counts, club_used = entity_counts(clubs)
    league_counts, league_used = entity_counts(leagues)
    nation_counts, nation_used = entity_counts(nations)

    def by_kind(kind: str):
        return {
            "club": (clubs, club_counts, club_used),
            "league": (leagues, league_counts, league_used),
            "nation": (nations, nation_counts, nation_used),
        }[kind]

    def add_same_count(kind: str, op: str, value: int) -> None:
        """min asks whether SOME entity reaches the count. max asks whether EVERY
        entity stays under it. Collapsing the two is a real bug source."""
        _, counts, _ = by_kind(kind)
        if op == "max":
            for total in counts.values():
                model.Add(total <= value)
            return
        if op != "min":
            raise UnsupportedRequirement(f"sameCount does not support {op!r}")
        if not counts:
            model.AddBoolOr([model.NewBoolVar("impossible_same")])  # unsatisfiable
            return
        picks = []
        for name, total in counts.items():
            pick = model.NewBoolVar(f"same_{kind}_{name}")
            model.Add(total >= value).OnlyEnforceIf(pick)
            picks.append(pick)
        model.AddAtLeastOne(picks)

    def property_count(predicate) -> object:
        return sum(usage[i] for i, card in enumerate(pool) if predicate(card))

    needs_chemistry = any(
        r.type in ("teamChemistry", "perPlayerChemistry") for r in request.requirements
    )
    slot_chemistry = None
    squad_chemistry = None
    if needs_chemistry or request.chemistry is not None:
        slot_chemistry, squad_chemistry = add_chemistry(
            model, pool, slots, place, request.chemistry
        )

    for requirement in request.requirements:
        kind = requirement.type
        op = requirement.op or "min"
        value = requirement.value

        if kind == "squadSize":
            if value != SQUAD_SIZE:
                raise UnsupportedRequirement(f"squad size {value} is not supported")
        elif kind in ("teamRating", "formation"):
            # teamRating is handled by rating_counts, upstream. Formation is
            # chosen by the caller before the request is built.
            continue
        elif kind == "teamChemistry":
            assert squad_chemistry is not None
            model.Add(squad_chemistry >= (value or 0))
        elif kind == "perPlayerChemistry":
            # Distinct from teamChemistry: a squad can hit the total and still
            # fail a per player floor. count omitted means all eleven.
            assert slot_chemistry is not None
            needed = requirement.count if requirement.count is not None else SQUAD_SIZE
            bar = value or 0
            meets = []
            for s, chem in enumerate(slot_chemistry):
                flag = model.NewBoolVar(f"chem_floor_{s}")
                model.Add(chem >= bar).OnlyEnforceIf(flag)
                model.Add(chem <= bar - 1).OnlyEnforceIf(flag.Not())
                meets.append(flag)
            model.Add(sum(meets) >= needed)
        elif kind == "playersFromLeague":
            apply_op(count_of(leagues.get(requirement.league or "", [])), op, value or 0)
        elif kind == "playersFromNation":
            apply_op(count_of(nations.get(requirement.nation or "", [])), op, value or 0)
        elif kind == "playersFromClub":
            apply_op(count_of(clubs.get(requirement.club or "", [])), op, value or 0)
        elif kind in ("sameLeagueCount", "sameNationCount", "sameClubCount"):
            add_same_count(
                {"sameLeagueCount": "league", "sameNationCount": "nation", "sameClubCount": "club"}[kind],
                op,
                value or 0,
            )
        elif kind in ("distinctLeagues", "distinctNations", "distinctClubs"):
            used = {"distinctLeagues": league_used, "distinctNations": nation_used, "distinctClubs": club_used}[kind]
            apply_op(sum(used.values()) if used else 0, op, value or 0)
        elif kind == "rareCount":
            apply_op(property_count(lambda c: c.is_rare), op, value or 0)
        elif kind == "totwCount":
            apply_op(property_count(lambda c: c.is_totw), "min", value or 0)
        elif kind == "cardTypeCount":
            wanted = requirement.card_type
            apply_op(property_count(lambda c, w=wanted: c.card_type == w), op, value or 0)
        elif kind == "promoCount":
            wanted = requirement.promo_name
            apply_op(property_count(lambda c, w=wanted: c.promo_name == w), "min", value or 0)
        elif kind == "qualityCount":
            wanted = requirement.quality
            apply_op(property_count(lambda c, w=wanted: _quality_of(c.rating) == w), op, value or 0)
        elif kind == "minPlayerRating":
            bar = value or 0
            needed = requirement.count if requirement.count is not None else SQUAD_SIZE
            apply_op(property_count(lambda c, b=bar: c.rating >= b), "min", needed)
        elif kind == "maxPlayerRating":
            for index, card in enumerate(pool):
                if card.rating > (value or 0):
                    model.Add(usage[index] == 0)
        elif kind == "specificPlayer":
            wanted = requirement.def_id
            matching = [i for i, card in enumerate(pool) if card.id == wanted]
            if not matching:
                return SolveResponse(
                    status="infeasible",
                    reason=f"the required card {wanted} is not in the available pool",
                )
            model.Add(sum(usage[i] for i in matching) >= 1)
        elif kind == "specificPosition":
            wanted = requirement.position
            slot_indices = [s for s, slot in enumerate(slots) if slot == wanted]
            if len(slot_indices) < (value or 0):
                return SolveResponse(
                    status="infeasible",
                    reason=(
                        f"the formation has {len(slot_indices)} {wanted} slot(s), "
                        f"fewer than the {value} required"
                    ),
                )
        elif kind == "excludeEvolved":
            for index, card in enumerate(pool):
                if card.is_evolved:
                    model.Add(usage[index] == 0)
        elif kind in ("managerNation", "managerLeague"):
            continue
        else:
            raise UnsupportedRequirement(f"requirement {kind!r} is not expressible in this model")

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
            reason="no squad in the available pool satisfies these requirements",
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
                        chemistry=solver.Value(slot_chemistry[s]) if slot_chemistry else 0,
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
