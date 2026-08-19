"""Chemistry as CP-SAT constraints. Checkpoint 9.

READ THIS BEFORE EDITING.

Not one number in this file is a game rule. Every threshold and every contribution
weight arrives in the request from the TypeScript rules engine, which is the only
implementation under ground truth verification. There is no default anywhere: an
absent config or an unknown card type raises, because a guess here would silently
mis-score every squad containing that card and the tests would still be green.

That rule is permanent. Do not write a game rule down a second time here, not even
to save a round trip.

The shape of the model:

  in position usage   a card contributes to nobody's thresholds from a slot it
                      cannot play. This is the second half of the positioning gate
                      and the half that gets forgotten.
  entity counts       weighted sums of in position usage, per club, nation, league
  points              step functions over those counts, via reified booleans
  per card chemistry  points summed and capped, or the cap outright for Icons,
                      Heroes and Captains
  per slot chemistry  whichever card lands there, zero if out of position
"""

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from .schema import ChemistryConfig, PoolCard


class MissingChemistryRules(ValueError):
    """The request asked for chemistry without supplying the rules to compute it."""


def _points_from_ladder(
    model: cp_model.CpModel,
    count,
    ladder: list[tuple[int, int]],
    name: str,
    max_points: int,
):
    """A step function over count, built from reified booleans.

    Written for an arbitrary ladder rather than the three we happen to use, so a
    corrected threshold is a data change and never a code change.
    """
    ascending = sorted(ladder, key=lambda step: step[0])
    points = model.NewIntVar(0, max_points, f"points_{name}")
    terms = []
    previous_points = 0
    for needed, awarded in ascending:
        reached = model.NewBoolVar(f"{name}_ge_{needed}")
        model.Add(count >= needed).OnlyEnforceIf(reached)
        model.Add(count <= needed - 1).OnlyEnforceIf(reached.Not())
        terms.append((awarded - previous_points) * reached)
        previous_points = awarded
    model.Add(points == (sum(terms) if terms else 0))
    return points


def add_chemistry(
    model: cp_model.CpModel,
    pool: list[PoolCard],
    slots: list[str],
    place: list[list[cp_model.IntVar]],
    config: ChemistryConfig | None,
    tag: str = "s0",
):
    """Returns (per slot chemistry vars, squad chemistry var).

    `tag` namespaces every variable, because a repeat solve puts several squads'
    worth of these in one model.
    """
    if config is None:
        raise MissingChemistryRules(
            "this solve needs chemistry but no chemistry rules were supplied. "
            "The service holds no defaults on purpose: see chemistry_model.py."
        )

    missing = sorted({card.card_type for card in pool if card.card_type not in config.contributions})
    if missing:
        raise MissingChemistryRules(
            "no chemistry contribution supplied for card type(s): "
            + ", ".join(missing)
            + ". An unknown card type is an error, not a guess."
        )

    n = len(pool)
    squad_size = len(slots)
    cap = config.max_player_chemistry

    # The positioning gate, second half. Usage that earns nothing also COUNTS for
    # nothing, so the tally is over in position placements only.
    in_position_usage = []
    for i, card in enumerate(pool):
        playable = [s for s in range(squad_size) if slots[s] in card.positions]
        usage = model.NewIntVar(0, card.quantity, f"in_pos_use_{tag}_{i}")
        model.Add(usage == (sum(place[i][s] for s in playable) if playable else 0))
        in_position_usage.append(usage)

    by_club: dict[str, list[int]] = defaultdict(list)
    by_nation: dict[str, list[int]] = defaultdict(list)
    by_league: dict[str, list[int]] = defaultdict(list)
    for i, card in enumerate(pool):
        # A null entity is an absent entity, never a shared blank.
        if card.club is not None:
            by_club[card.club].append(i)
        by_nation[card.nation].append(i)
        if card.league is not None:
            by_league[card.league].append(i)

    def contribution(i: int):
        return config.contributions[pool[i].card_type]

    # Icons contribute to EVERY league, so their weight is held apart and added
    # to each league's count rather than to one of them.
    all_league_terms = [
        in_position_usage[i] * contribution(i).league
        for i in range(n)
        if contribution(i).applies_league_to_all and contribution(i).league
    ]
    all_league = sum(all_league_terms) if all_league_terms else 0

    def counted(indices: list[int], weight_of) -> object:
        terms = [in_position_usage[i] * weight_of(i) for i in indices if weight_of(i)]
        return sum(terms) if terms else 0

    club_points = {}
    for club, indices in by_club.items():
        count = model.NewIntVar(0, squad_size * 4, f"club_count_{tag}_{club}")
        model.Add(count == counted(indices, lambda i: contribution(i).club))
        club_points[club] = _points_from_ladder(
            model, count, config.club_thresholds, f"club_{tag}_{club}", cap
        )

    nation_points = {}
    for nation, indices in by_nation.items():
        count = model.NewIntVar(0, squad_size * 4, f"nation_count_{tag}_{nation}")
        model.Add(count == counted(indices, lambda i: contribution(i).nation))
        nation_points[nation] = _points_from_ladder(
            model, count, config.nation_thresholds, f"nation_{tag}_{nation}", cap
        )

    league_points = {}
    for league, indices in by_league.items():
        count = model.NewIntVar(0, squad_size * 4, f"league_count_{tag}_{league}")
        own = counted(indices, lambda i: 0 if contribution(i).applies_league_to_all else contribution(i).league)
        model.Add(count == own + all_league)
        league_points[league] = _points_from_ladder(
            model, count, config.league_thresholds, f"league_{tag}_{league}", cap
        )

    # Per card chemistry, as if that card were in position somewhere.
    card_chemistry = []
    for i, card in enumerate(pool):
        weights = contribution(i)
        if weights.always_max_chem:
            # Icons, Heroes and Captains. Still gated on position below.
            card_chemistry.append(cap)
            continue

        parts = []
        if card.club is not None:
            parts.append(club_points[card.club])
        parts.append(nation_points[card.nation])
        if card.league is not None:
            parts.append(league_points[card.league])

        bonus = 0
        if config.manager is not None:
            # +1 for a shared nation OR league, capped at +1 even when both match.
            matches = card.nation == config.manager.nation or (
                card.league is not None and card.league == config.manager.league
            )
            bonus = 1 if matches else 0

        raw = model.NewIntVar(0, cap * 4 + 1, f"raw_chem_{tag}_{i}")
        model.Add(raw == (sum(parts) if parts else 0) + bonus)
        capped = model.NewIntVar(0, cap, f"chem_{tag}_{i}")
        model.AddMinEquality(capped, [raw, cap])
        card_chemistry.append(capped)

    slot_chemistry = []
    for s in range(squad_size):
        value = model.NewIntVar(0, cap, f"slot_chem_{tag}_{s}")
        for i, card in enumerate(pool):
            if slots[s] in card.positions:
                model.Add(value == card_chemistry[i]).OnlyEnforceIf(place[i][s])
            else:
                # The positioning gate, first half.
                model.Add(value == 0).OnlyEnforceIf(place[i][s])
        slot_chemistry.append(value)

    total = model.NewIntVar(0, config.max_squad_chemistry, f"squad_chemistry_{tag}")
    model.Add(total == sum(slot_chemistry))
    return slot_chemistry, total
