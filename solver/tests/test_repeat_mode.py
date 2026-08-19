"""Repeat mode. Brief 6.1. The headline case is ten 85 rated squads.

The point of solving JOINTLY rather than one at a time: greedy burns the good
fodder on squad one and then fails on squad four. And when fewer than N are
achievable, saying "6 of 10" is only half an answer. The other half is which
requirement blocks squad 7.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import PoolCard, Requirement, solve_repeat

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = list(set(FORMATION))

# Real multisets from the TypeScript enumerator for a squad rating of exactly 85.
MULTISETS_85 = [
    {86: 4, 85: 1, 83: 6},
    {86: 3, 85: 4, 82: 4},
    {86: 5, 83: 3, 82: 3},
]


def fodder(count: int, rating: int, cost: int, prefix: str, **kwargs) -> list[PoolCard]:
    return [
        PoolCard(
            id=f"{prefix}{i}",
            rating=rating,
            positions=ANY_POSITION,
            nation=f"N{prefix}{i}",
            league=f"L{prefix}{i}",
            club=f"C{prefix}{i}",
            card_type=kwargs.pop("card_type", "rare"),
            quantity=1,
            cost=cost,
            **kwargs,
        )
        for i in range(count)
    ]


def big_club() -> list[PoolCard]:
    """Comfortably more than enough for a handful of 85 rated squads."""
    return (
        fodder(40, 86, 4000, "h")
        + fodder(20, 85, 2600, "m")
        + fodder(60, 83, 1200, "l")
        + fodder(40, 82, 900, "x")
    )


def short_club() -> list[PoolCard]:
    """Short at the top. Every allowed multiset needs at least three 86s, and
    there are only twenty five, so ten squads cannot be reached."""
    return (
        fodder(25, 86, 4000, "h")
        + fodder(20, 85, 2600, "m")
        + fodder(60, 83, 1200, "l")
        + fodder(40, 82, 900, "x")
    )


class TestTenEightyFiveRatedSquads:
    def test_it_builds_all_ten_when_the_club_can_carry_them(self):
        pool = (
            fodder(60, 86, 4000, "h")
            + fodder(40, 85, 2600, "m")
            + fodder(80, 83, 1200, "l")
            + fodder(60, 82, 900, "x")
        )
        result = solve_repeat(
            pool, FORMATION, requested=10, allowed_rating_multisets=MULTISETS_85
        )
        assert result.achieved == 10
        assert result.complete
        assert result.binding_requirement is None
        assert result.shortfall_reason is None
        assert len(result.squads) == 10

    def test_every_squad_uses_one_of_the_allowed_multisets(self):
        pool = big_club()
        result = solve_repeat(
            pool, FORMATION, requested=4, allowed_rating_multisets=MULTISETS_85
        )
        by_id = {card.id: card for card in pool}
        for squad in result.squads:
            counts: dict[int, int] = {}
            for placement in squad:
                rating = by_id[placement.card_id].rating
                counts[rating] = counts.get(rating, 0) + 1
            assert counts in MULTISETS_85

    def test_no_card_is_used_twice_across_the_whole_run(self):
        pool = big_club()
        result = solve_repeat(
            pool, FORMATION, requested=5, allowed_rating_multisets=MULTISETS_85
        )
        used = [p.card_id for squad in result.squads for p in squad]
        assert len(used) == len(set(used))

    def test_it_reports_how_many_are_achievable_when_the_club_runs_short(self):
        # Only twenty five cards rated 86, and every allowed multiset needs at
        # least three of them, so ten squads is out of reach.
        pool = short_club()
        result = solve_repeat(
            pool, FORMATION, requested=10, allowed_rating_multisets=MULTISETS_85
        )
        assert 1 <= result.achieved < 10
        assert not result.complete
        assert f"{result.achieved} of 10 squads are achievable" in result.shortfall_reason
        # No single requirement is at fault here, and saying so is more useful
        # than naming an innocent rule.
        assert result.binding_requirement is None
        assert "the size of the available pool" in result.shortfall_reason


class TestNamingTheBindingRequirement:
    def test_it_says_which_requirement_blocks_squad_m_plus_one(self):
        # Plenty of fodder, but only six TOTW cards, and every squad needs one.
        pool = (
            fodder(60, 86, 4000, "h")
            + fodder(40, 85, 2600, "m")
            + fodder(80, 83, 1200, "l")
            + fodder(60, 82, 900, "x")
            + fodder(6, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
        )
        requirements = [Requirement(type="totwCount", op="min", value=1)]
        result = solve_repeat(
            pool,
            FORMATION,
            requested=10,
            requirements=requirements,
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.achieved == 6
        assert result.binding_requirement == "totwCount min 1"
        assert "Squad 7 is blocked by totwCount min 1." in result.shortfall_reason

    def test_and_removing_that_requirement_really_does_unblock_it(self):
        # The diagnosis is only worth anything if it is true, so it is checked.
        pool = (
            fodder(60, 86, 4000, "h")
            + fodder(40, 85, 2600, "m")
            + fodder(80, 83, 1200, "l")
            + fodder(60, 82, 900, "x")
            + fodder(6, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
        )
        without = solve_repeat(
            pool, FORMATION, requested=7, allowed_rating_multisets=MULTISETS_85
        )
        assert without.achieved == 7

    def test_it_names_the_binding_requirement_out_of_several(self):
        pool = (
            fodder(60, 86, 4000, "h")
            + fodder(40, 85, 2600, "m")
            + fodder(80, 83, 1200, "l")
            + fodder(60, 82, 900, "x")
            + fodder(4, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
        )
        requirements = [
            Requirement(type="squadSize", value=11),
            Requirement(type="totwCount", op="min", value=1),
            Requirement(type="minPlayerRating", value=82),
        ]
        result = solve_repeat(
            pool,
            FORMATION,
            requested=6,
            requirements=requirements,
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.achieved == 4
        assert result.binding_requirement == "totwCount min 1"


class TestJointRatherThanGreedy:
    def test_the_run_is_cheaper_than_solving_one_squad_at_a_time_would_allow(self):
        # Two squads, and the pool has exactly enough. A greedy first squad would
        # take the cheapest eleven it could and leave an infeasible remainder.
        pool = fodder(8, 86, 4000, "h") + fodder(2, 85, 2600, "m") + fodder(12, 83, 1200, "l")
        result = solve_repeat(
            pool, FORMATION, requested=2, allowed_rating_multisets=[{86: 4, 85: 1, 83: 6}]
        )
        assert result.achieved == 2
        assert result.total_cost == 2 * (4 * 4000 + 2600 + 6 * 1200)


class TestGuards:
    def test_requested_must_be_at_least_one(self):
        with pytest.raises(ValueError, match="at least 1"):
            solve_repeat(fodder(11, 84, 100, "f"), FORMATION, requested=0)

    def test_a_pool_too_small_for_even_one_squad_says_so(self):
        result = solve_repeat(fodder(5, 84, 100, "f"), FORMATION, requested=3)
        assert result.achieved == 0
        assert "not even one squad" in result.shortfall_reason
