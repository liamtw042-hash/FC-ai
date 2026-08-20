"""Repeat mode. Brief 6.1. The headline case is ten 85 rated squads.

The point of solving JOINTLY rather than one at a time: greedy burns the good
fodder on squad one and then fails on squad four. And when fewer than N are
achievable, saying "6 of 10" is only half an answer. The other half is which
requirement blocks squad 7.
"""

from __future__ import annotations

import pytest

# Repeat mode builds one CP-SAT model per candidate count, so these are the slow
# tests in the suite. `pytest -m "not slow"` skips them while iterating.
pytestmark = pytest.mark.slow

from fc_ai_solver import PoolCard, Requirement, solve_repeat
from fc_ai_solver.repeat_solve import _diagnose

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
        # Seven, and the exact number is pinned rather than left as "fewer than
        # ten", because an unpinned number is one nobody checks.
        assert result.achieved == 7
        assert not result.complete
        assert "7 of 10 squads are achievable" in result.shortfall_reason
        # No requirement is at fault, and the report says so with numbers rather
        # than naming an innocent rule. See TestSupplyIsADiagnosisModeOfItsOwn.
        assert result.binding_requirement is None
        assert result.diagnosis.mode == "supply"
        assert "the club running out of cards, not any requirement" in result.shortfall_reason


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


class TestAPairOfRequirementsWithNeitherSufficientAlone:
    """The realistic shortfall on a long run.

    Single requirement removal only finds single blockers. Here two requirements
    each cap the run at five, so removing either one still leaves the other
    capping it at five, and only removing both gets squad six through. Reporting
    "no blocker found" on this would be worse than useless, because this is the
    case worth explaining.
    """

    @staticmethod
    def pool_with_two_scarce_types() -> list[PoolCard]:
        return (
            fodder(28, 86, 4000, "h")
            + fodder(16, 85, 2600, "m")
            + fodder(40, 83, 1200, "l")
            + fodder(24, 82, 900, "x")
            # Five TOTW and five FUTTIES, disjoint, each rated 83 so they slot in.
            + fodder(5, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
            + fodder(5, 83, 1500, "promo", card_type="promo", promo_name="FUTTIES", is_rare=True)
        )

    REQUIREMENTS = [
        Requirement(type="totwCount", op="min", value=1),
        Requirement(type="promoCount", promo_name="FUTTIES", op="min", value=1),
    ]

    def test_neither_requirement_alone_explains_the_shortfall(self):
        pool = self.pool_with_two_scarce_types()
        # Five TOTW cards cap the run at five on their own.
        totw_only = solve_repeat(
            pool, FORMATION, requested=6,
            requirements=[self.REQUIREMENTS[0]],
            allowed_rating_multisets=MULTISETS_85,
        )
        assert totw_only.achieved == 5
        # And five FUTTIES cap it at five on their own too.
        promo_only = solve_repeat(
            pool, FORMATION, requested=6,
            requirements=[self.REQUIREMENTS[1]],
            allowed_rating_multisets=MULTISETS_85,
        )
        assert promo_only.achieved == 5
        # With neither, six is comfortable.
        neither = solve_repeat(
            pool, FORMATION, requested=6, allowed_rating_multisets=MULTISETS_85
        )
        assert neither.achieved == 6

    def test_the_diagnosis_names_the_pair(self):
        pool = self.pool_with_two_scarce_types()
        result = solve_repeat(
            pool, FORMATION, requested=6,
            requirements=self.REQUIREMENTS,
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.achieved == 5
        # No SINGLE blocker exists, so the single-blocker accessor stays empty
        # rather than picking one of the pair and being half right.
        assert result.binding_requirement is None
        assert result.diagnosis is not None
        assert result.diagnosis.subset_size == 2
        assert sorted(result.diagnosis.blocking) == sorted(
            ["totwCount min 1", "promoCount promo=FUTTIES min 1"]
        )
        assert "Neither alone is enough" in result.diagnosis.explanation
        assert "which is why removing one at a time finds nothing" in result.diagnosis.explanation

    def test_and_removing_both_really_does_unblock_it(self):
        # A diagnosis nobody checks is worth nothing, so the claim is verified.
        pool = self.pool_with_two_scarce_types()
        both_removed = solve_repeat(
            pool, FORMATION, requested=6, allowed_rating_multisets=MULTISETS_85
        )
        assert both_removed.achieved == 6


class TestWhenNoSmallSubsetExplainsIt:
    def test_it_says_so_and_reports_what_was_closest_rather_than_going_quiet(self):
        # Three requirements, each individually satisfiable, whose combination
        # with a thin pool leaves no two-requirement explanation.
        pool = (
            fodder(12, 86, 4000, "h")
            + fodder(12, 85, 2600, "m")
            + fodder(24, 83, 1200, "l")
            + fodder(24, 82, 900, "x")
            + fodder(3, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
        )
        requirements = [
            Requirement(type="totwCount", op="min", value=1),
            Requirement(type="distinctNations", op="min", value=11),
            Requirement(type="minPlayerRating", value=82),
        ]
        result = solve_repeat(
            pool, FORMATION, requested=6,
            requirements=requirements,
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.diagnosis is not None
        # Whichever mode it lands in, silence is the failure being avoided: the
        # answer always says which kind of problem this is and gives something to
        # act on.
        assert result.diagnosis.mode in ("requirement", "requirement_pair", "supply", "unexplained")
        if result.diagnosis.mode in ("requirement", "requirement_pair"):
            assert result.diagnosis.subset_size in (1, 2)
        elif result.diagnosis.mode == "supply":
            # This thin pool is short of cards, so supply is the honest answer and
            # no requirement is named for it.
            assert result.diagnosis.blocking == []
            assert result.diagnosis.supply, "supply mode reports what to buy"
            assert "not any requirement" in result.diagnosis.explanation
        else:
            assert "no single requirement and no pair explains it" in result.diagnosis.explanation
            assert "the club is not short of cards" in result.diagnosis.explanation
            assert result.diagnosis.contributions, "every requirement is reported on"


class TestSupplyIsADiagnosisModeOfItsOwn:
    """The gap subset search cannot cover.

    Removing requirements one at a time, or two at a time, can only ever explain a
    shortfall that has a requirement in it. A run can die purely on the club being
    short of cards, and falling through to "closest to binding" there would name a
    requirement that is not the cause. That is worse than silence, because it
    sends the reader shopping for the wrong cards.
    """

    def test_the_seven_of_ten_case_reaches_supply_and_names_no_requirement(self):
        result = solve_repeat(
            short_club(), FORMATION, requested=10, allowed_rating_multisets=MULTISETS_85
        )
        assert result.achieved == 7
        assert result.diagnosis is not None
        assert result.diagnosis.mode == "supply"

        # The thing that must not happen: naming a requirement for a supply problem.
        assert result.binding_requirement is None
        assert result.diagnosis.blocking == []
        assert result.diagnosis.contributions == []

        # And it reads as a shopping list rather than a rule.
        assert "the club running out of cards, not any requirement" in result.shortfall_reason
        assert "8 squads need 28 cards rated 86, you have 25, add 3" in result.shortfall_reason

    def test_the_shortfall_is_reported_as_numbers_that_can_be_acted_on(self):
        result = solve_repeat(
            short_club(), FORMATION, requested=10, allowed_rating_multisets=MULTISETS_85
        )
        (shortfall,) = result.diagnosis.supply
        assert shortfall.rating == 86
        assert shortfall.needed == 28
        assert shortfall.held == 25
        assert shortfall.missing == 3
        assert shortfall.cost_to_close == 3 * 4000

    def test_a_requirement_problem_still_reports_as_a_requirement_problem(self):
        # The mode is what tells a requirement problem from a supply one at a
        # glance, so it has to be right on both sides.
        pool = (
            fodder(60, 86, 4000, "h")
            + fodder(40, 85, 2600, "m")
            + fodder(80, 83, 1200, "l")
            + fodder(60, 82, 900, "x")
            + fodder(6, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
        )
        result = solve_repeat(
            pool, FORMATION, requested=10,
            requirements=[Requirement(type="totwCount", op="min", value=1)],
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.diagnosis.mode == "requirement"
        assert result.diagnosis.supply == []

    def test_a_pair_problem_reports_as_a_pair(self):
        pool = TestAPairOfRequirementsWithNeitherSufficientAlone.pool_with_two_scarce_types()
        result = solve_repeat(
            pool, FORMATION, requested=6,
            requirements=TestAPairOfRequirementsWithNeitherSufficientAlone.REQUIREMENTS,
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.diagnosis.mode == "requirement_pair"
        assert result.diagnosis.supply == []


class TestNoSingleCauseIsReportedAsIfItWereTheWhole:
    """Audit outcome: the singles loop used to return the FIRST requirement whose
    removal unblocked, so two independently sufficient blockers reported as one.

    Driven through _diagnose with a stub search rather than a real pool. Building
    a club where two requirements are each independently sufficient to fix is
    fiddly and the fiddliness would be testing the fixture, not the logic. The
    first attempt at a real pool produced a PAIR, correctly, which is a different
    path and already covered.
    """

    class _StubSearch:
        """Feasible exactly when at least one of the two blockers is absent."""

        def __init__(self, blockers):
            self.blockers = blockers
            self.pool = []
            self.multisets = None

        def feasible(self, count, requirements, budget=None):
            present = {r.type for r in requirements}
            return not all(b in present for b in self.blockers)

    def test_every_independently_sufficient_requirement_is_named_not_the_first(self):
        requirements = [
            Requirement(type="totwCount", op="min", value=1),
            Requirement(type="promoCount", promo_name="FUTTIES", op="min", value=1),
            Requirement(type="minPlayerRating", value=82),
        ]
        search = self._StubSearch({"totwCount", "promoCount"})
        diagnosis = _diagnose(search, 3, requirements, 1.0)

        assert diagnosis.mode == "requirement"
        assert sorted(diagnosis.blocking) == sorted(
            ["totwCount min 1", "promoCount promo=FUTTIES min 1"]
        )
        assert "removing ANY one unblocks squad 3" in diagnosis.explanation
        # The innocent third requirement is not named.
        assert "minPlayerRating" not in diagnosis.explanation

    def test_a_lone_blocker_still_reads_as_a_lone_blocker(self):
        requirements = [
            Requirement(type="totwCount", op="min", value=1),
            Requirement(type="minPlayerRating", value=82),
        ]
        # Only removing totwCount helps.
        search = self._StubSearch({"totwCount"})
        diagnosis = _diagnose(search, 3, requirements, 1.0)
        assert diagnosis.blocking == ["totwCount min 1"]
        assert diagnosis.explanation.startswith("totwCount min 1")
        assert "removing ANY one" not in diagnosis.explanation
        # It now carries what the club can do against it, which is checkpoint 12's
        # half of the answer. The stub search only models presence and absence, so
        # what it reports here is that removing it is what helps.
        assert len(diagnosis.limits) == 1
        assert diagnosis.limits[0].name == "totwCount min 1"

    def test_and_a_real_pool_where_neither_alone_suffices_still_reports_a_pair(self):
        # The construction that produced a pair rather than two singles, kept
        # because it is the boundary between the two paths.
        pool = (
            fodder(60, 86, 4000, "h") + fodder(40, 85, 2600, "m")
            + fodder(80, 83, 1200, "l") + fodder(60, 82, 900, "x")
            + fodder(2, 83, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
            + fodder(2, 83, 1500, "promo", card_type="promo", promo_name="FUTTIES", is_rare=True)
        )
        result = solve_repeat(
            pool, FORMATION, requested=4,
            requirements=[
                Requirement(type="totwCount", op="min", value=1),
                Requirement(type="promoCount", promo_name="FUTTIES", op="min", value=1),
            ],
            allowed_rating_multisets=MULTISETS_85,
        )
        assert result.achieved == 2
        assert result.diagnosis.mode == "requirement_pair"
        assert result.binding_requirement is None
