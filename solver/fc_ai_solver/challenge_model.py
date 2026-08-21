"""The constraints for ONE challenge, shared by the single and repeat solvers.

Extracted so there is exactly one implementation. A repeat or queue solve is
several of these in one model against one pool, and a second copy of the
requirement logic would drift from the first the first time either was corrected.

Every variable name is namespaced by `tag`, because a repeat solve puts eleven
squads' worth of these in the same CP-SAT model.
"""

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from .chemistry_model import add_chemistry
from .schema import ChemistryConfig, PoolCard, Requirement
from .squad_size import SQUAD_SIZE


class UnsupportedRequirement(ValueError):
    """Raised rather than silently ignoring a requirement we cannot express.

    Quietly dropping a constraint would return a squad the game rejects, which is
    the one outcome worth failing loudly to avoid.
    """


class ChallengeImpossible(ValueError):
    """The challenge cannot be satisfied by this pool, for a reason we can name."""


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


def add_copy_limit(
    model: cp_model.CpModel,
    pool: list[PoolCard],
    usage: list[cp_model.IntVar],
    max_copies_per_squad: int | None,
) -> None:
    """At most `max_copies_per_squad` cards sharing a `player_key`, in ONE squad.

    Lives here rather than inside `add_challenge` because `solve_variable_count`
    builds its own model without requirements, and a squad rule that only some
    entry points apply is worse than one nobody applies: it makes the answer
    depend on which function you happened to call.

    BOTH HALVES COME FROM THE CALLER. This service does not decide what makes two
    cards the same thing, and does not know that the limit is one. It knows only
    that keys without a limit are something left unsaid, and raises rather than
    picking a number.

    ACROSS squads is deliberately untouched. A stack of four 84s feeding four
    different squads is the normal way an SBC grind works.
    """
    keyed = [index for index, card in enumerate(pool) if card.player_key is not None]
    if keyed and max_copies_per_squad is None:
        raise UnsupportedRequirement(
            "this pool carries player_key values, which only mean something alongside "
            "a per squad copy limit, and none was supplied. Send max_copies_per_squad, "
            "or send a pool with no keys."
        )
    if max_copies_per_squad is None:
        return
    if max_copies_per_squad < 1:
        raise UnsupportedRequirement(
            f"max_copies_per_squad must be at least 1, got {max_copies_per_squad}"
        )
    groups: dict[str, list[int]] = {}
    for index in keyed:
        groups.setdefault(pool[index].player_key or "", []).append(index)
    for indices in groups.values():
        # Skipped where it cannot bind: one card of quantity 1 can never exceed a
        # limit of 1, and a model carrying six hundred vacuous constraints is
        # slower for nothing.
        reachable = sum(pool[i].quantity for i in indices)
        if reachable > max_copies_per_squad:
            model.Add(sum(usage[i] for i in indices) <= max_copies_per_squad)


def add_challenge(
    model: cp_model.CpModel,
    pool: list[PoolCard],
    slots: list[str],
    usage: list[cp_model.IntVar],
    place: list[list[cp_model.IntVar]],
    requirements: list[Requirement],
    chemistry: ChemistryConfig | None,
    tag: str = "s0",
    active: cp_model.IntVar | None = None,
    max_copies_per_squad: int | None = None,
):
    """Adds every requirement for one challenge. Returns (slot_chem, squad_chem).

    `active` is for a squad that MAY not be built, which is what queue mode needs.
    An unbuilt squad has every usage at zero, so an unconditional "min 4 from the
    Premier League" would fail and force the squad to be built, making a queue the
    club cannot fully feed infeasible rather than partially solved. Every
    requirement constraint is therefore gated on `active`. Without it the behaviour
    is unchanged, which is what the single and repeat solvers want.

    `max_copies_per_squad` limits how many times cards sharing a `player_key` may
    appear in ONE squad. Both halves come from the caller: this service does not
    decide what makes two cards the same thing, and does not know that the limit
    is one. It only knows that a caller who supplies keys and no limit has left
    something unsaid, and raises rather than picking a number.

    ACROSS squads is deliberately untouched. A stack of four 84s feeding four
    different squads is the normal way an SBC grind works.
    """

    def enforce(constraint):
        if active is not None:
            constraint.OnlyEnforceIf(active)
        return constraint

    add_copy_limit(model, pool, usage, max_copies_per_squad)
    clubs = _group_by(pool, lambda c: c.club)
    leagues = _group_by(pool, lambda c: c.league)
    nations = _group_by(pool, lambda c: c.nation)

    def count_of(indices: list[int]):
        return sum(usage[i] for i in indices) if indices else 0

    def apply_op(expression, op: str, value: int) -> None:
        if op == "min":
            enforce(model.Add(expression >= value))
        elif op == "max":
            enforce(model.Add(expression <= value))
        elif op == "exact":
            enforce(model.Add(expression == value))
        else:
            raise UnsupportedRequirement(f"unknown operator {op!r}")

    def entity_counts(groups: dict[str, list[int]]):
        """One integer per entity, plus a used flag, for distinct and same rules."""
        counts = {}
        used = {}
        for name, indices in groups.items():
            total = model.NewIntVar(0, SQUAD_SIZE, f"count_{tag}_{name}")
            model.Add(total == count_of(indices))
            flag = model.NewBoolVar(f"used_{tag}_{name}")
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
                enforce(model.Add(total <= value))
            return
        if op != "min":
            raise UnsupportedRequirement(f"sameCount does not support {op!r}")
        if not counts:
            model.AddBoolOr([model.NewBoolVar(f"impossible_same_{tag}")])  # unsatisfiable
            return
        picks = []
        for name, total in counts.items():
            pick = model.NewBoolVar(f"same_{tag}_{kind}_{name}")
            model.Add(total >= value).OnlyEnforceIf(pick)
            picks.append(pick)
        if active is None:
            model.AddAtLeastOne(picks)
        else:
            # Satisfied automatically when the squad is not built.
            model.AddBoolOr([*picks, active.Not()])

    def property_count(predicate) -> object:
        return sum(usage[i] for i, card in enumerate(pool) if predicate(card))

    needs_chemistry = any(
        r.type in ("teamChemistry", "perPlayerChemistry") for r in requirements
    )
    slot_chemistry = None
    squad_chemistry = None
    if needs_chemistry or chemistry is not None:
        slot_chemistry, squad_chemistry = add_chemistry(model, pool, slots, place, chemistry, tag)

    # Collected rather than raised on the first one. A challenge with three
    # unexpressible requirements used to report one, and the next appeared only
    # after that one was dealt with.
    unsupported: list[str] = []

    for requirement in requirements:
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
            enforce(model.Add(squad_chemistry >= (value or 0)))
        elif kind == "perPlayerChemistry":
            # Distinct from teamChemistry: a squad can hit the total and still
            # fail a per player floor. count omitted means all eleven.
            assert slot_chemistry is not None
            needed = requirement.count if requirement.count is not None else SQUAD_SIZE
            bar = value or 0
            meets = []
            for s, chem in enumerate(slot_chemistry):
                flag = model.NewBoolVar(f"chem_floor_{tag}_{s}")
                model.Add(chem >= bar).OnlyEnforceIf(flag)
                model.Add(chem <= bar - 1).OnlyEnforceIf(flag.Not())
                meets.append(flag)
            enforce(model.Add(sum(meets) >= needed))
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
                    enforce(model.Add(usage[index] == 0))
        elif kind == "specificPlayer":
            wanted = requirement.def_id
            matching = [i for i, card in enumerate(pool) if card.id == wanted]
            if not matching:
                raise ChallengeImpossible(
                    f"the required card {wanted} is not in the available pool"
                )
            enforce(model.Add(sum(usage[i] for i in matching) >= 1))
        elif kind == "specificPosition":
            wanted = requirement.position
            slot_indices = [s for s, slot in enumerate(slots) if slot == wanted]
            if len(slot_indices) < (value or 0):
                raise ChallengeImpossible(
                    f"the formation has {len(slot_indices)} {wanted} slot(s), "
                    f"fewer than the {value} required"
                )
        elif kind == "excludeEvolved":
            for index, card in enumerate(pool):
                if card.is_evolved:
                    enforce(model.Add(usage[index] == 0))
        elif kind in ("managerNation", "managerLeague"):
            continue
        else:
            unsupported.append(kind)

    if unsupported:
        names = ", ".join(sorted(set(unsupported)))
        raise UnsupportedRequirement(
            f"these requirements are not expressible in this model: {names}"
        )

    return slot_chemistry, squad_chemistry
