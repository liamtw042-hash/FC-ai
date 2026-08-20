"""Impossibility diagnosis with binding constraint identification. Checkpoint 12.

The point of these is not that the solver says no. It is that the sentence it
gives back names WHICH constraint binds and HOW FAR the club is from it, and that
the five kinds of cause stay distinct from each other.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import (
    ClubLimit,
    PoolCard,
    Requirement,
    diagnose_impossibility,
)
from fc_ai_solver.repeat_solve import _club_limit, _minimal_blocking_set, _Search

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = list(set(FORMATION))


def cards(rating: int, count: int, prefix: str, cost: int = 1000, **kw) -> list[PoolCard]:
    nation = kw.pop("nation", None)
    league = kw.pop("league", None)
    return [
        PoolCard(
            id=f"{prefix}{i}", rating=rating, positions=ANY_POSITION,
            nation=nation or f"N{prefix}{i}", league=league or f"L{prefix}{i}",
            club=f"C{prefix}{i}", card_type=kw.pop("card_type", "rare"),
            quantity=1, cost=cost, coins_spent=cost, value_burned=0, **kw,
        )
        for i in range(count)
    ]


def plenty() -> list[PoolCard]:
    return cards(84, 30, "a") + cards(83, 30, "b") + cards(82, 30, "c")


def search_over(pool, multisets=None) -> _Search:
    return _Search(pool, FORMATION, None, multisets, 10.0, 8)


LEAGUES = ["Premier League", "Serie A", "La Liga", "Bundesliga", "Ligue 1"]
FIVE_LEAGUES = [
    card
    for index, league in enumerate(LEAGUES)
    for card in cards(84, 4, f"g{index}", league=league)
]
FOUR_FROM_EACH = [
    Requirement(type="playersFromLeague", league=league, op="min", value=4)
    for league in LEAGUES
]


class TestItSaysSolvableWhenItIs:
    def test_a_challenge_the_club_can_build(self):
        report = diagnose_impossibility(plenty(), FORMATION)
        assert report.solvable
        assert "Solvable" in report.describe()

    def test_it_takes_a_known_achievable_count_rather_than_re_deriving_it(self):
        report = diagnose_impossibility(plenty(), FORMATION, count=2, achievable=2)
        assert report.solvable


class TestUniversalConflictsComeFirst:
    """A contradiction between requirements is a fact about the SBC and true for
    everyone. Telling someone their club is short when nobody could build it
    sends them shopping for nothing."""

    def test_it_never_consults_the_club(self):
        report = diagnose_impossibility(
            [], FORMATION,
            requirements=[Requirement(type="totwCount", op="min", value=1)],
            universal_conflicts=["distinctLeagues exactly 1 cannot meet distinctNations min 5"],
        )
        assert report.is_universal
        assert report.diagnosis is None

    def test_it_says_so_in_those_words(self):
        report = diagnose_impossibility(
            plenty(), FORMATION,
            universal_conflicts=["teamRating min 90 with maxPlayerRating max 84"],
        )
        described = report.describe()
        assert "IMPOSSIBLE FOR EVERYONE" in described
        assert "nothing to buy" in described

    def test_the_service_does_not_derive_them(self):
        # Python holds no game rules, so a contradiction it was not told about is
        # diagnosed against the club like anything else, not detected as universal.
        report = diagnose_impossibility(
            plenty(), FORMATION,
            requirements=[
                Requirement(type="minPlayerRating", value=90),
                Requirement(type="maxPlayerRating", op="max", value=84),
            ],
        )
        assert not report.is_universal


class TestBindingConstraintIdentification:
    """Naming the requirement is half an answer. The other half is the number."""

    def test_it_reports_how_far_the_club_actually_is(self):
        # Six Serie A cards in the club, asked for nine.
        pool = cards(84, 6, "s", league="Serie A") + cards(83, 30, "b")
        report = diagnose_impossibility(
            pool, FORMATION,
            requirements=[
                Requirement(type="playersFromLeague", league="Serie A", op="min", value=9)
            ],
        )
        assert report.kind == "requirement"
        assert report.binding == ["playersFromLeague league=Serie A min 9"]
        limit = report.limits[0]
        assert limit.best == 6, report.describe()
        assert limit.gap == 3
        assert "can manage at best 6, 3 short of the 9" in report.describe()

    def test_a_max_op_loosens_the_other_way(self):
        # maxPlayerRating loosens UPWARD toward the ratings in the club, which a
        # formula over squad size would get backwards.
        pool = cards(84, 30, "a")
        report = diagnose_impossibility(
            pool, FORMATION,
            requirements=[
                Requirement(type="maxPlayerRating", op="max", value=80),
            ],
        )
        assert report.kind == "requirement"
        assert report.limits[0].best == 84
        assert "at most 84" in report.describe()

    def test_a_requirement_with_no_numeric_value_says_so_rather_than_a_number(self):
        limit = ClubLimit(
            Requirement(type="specificPlayer", def_id="x"), "specificPlayer", None, None, False
        )
        assert "no gap to quote" in limit.describe()
        assert limit.gap is None

    def test_the_bisection_does_not_probe_a_requirement_removal_cannot_fix(self):
        # Removing it outright leaves the challenge infeasible, so no value of it
        # is the answer and quoting one would be a lie.
        pool = cards(84, 6, "a")  # six cards, eleven slots
        limit = _club_limit(
            search_over(pool), 1,
            [Requirement(type="playersFromLeague", league="La Liga", op="min", value=3)],
            Requirement(type="playersFromLeague", league="La Liga", op="min", value=3),
            5.0,
        )
        assert not limit.reachable
        assert "part of the answer rather than all of it" in limit.describe()


class TestTheMinimalBlockingSet:
    """Singles find one, pairs find two, and a three way conflict fell off the end
    of both and got reported as unexplained."""

    def test_three_requirements_that_only_conflict_together_are_named_together(self):
        # Five leagues, four cards in each, and a minimum of four from every one.
        # Any TWO of the five fit in eleven slots. Any THREE need twelve and do
        # not. So no single removal helps, no pair helps, and the smallest set
        # that is impossible on its own has three members in it.
        report = diagnose_impossibility(FIVE_LEAGUES, FORMATION, requirements=FOUR_FROM_EACH)
        assert report.kind == "requirement_set", report.describe()
        assert len(report.binding) == 3
        assert "CONFLICT WITH EACH OTHER" in report.describe()
        assert "No proper subset of them is impossible" in report.describe()
        # And it does NOT claim that dropping one fixes the challenge, only this
        # conflict. Two other conflicts of three are still sitting in the list.
        assert "may still fail on another" in report.describe()

    def test_the_set_it_returns_is_actually_minimal(self):
        search = search_over(FIVE_LEAGUES)
        minimal = _minimal_blocking_set(search, 1, FOUR_FROM_EACH, 5.0)
        assert minimal is not None
        assert not search.feasible(1, minimal, 5.0), "the set is infeasible"
        for dropped in minimal:
            subset = [r for r in minimal if r is not dropped]
            assert search.feasible(1, subset, 5.0), "no proper subset is infeasible"

    def test_it_returns_nothing_when_the_requirements_are_not_the_cause(self):
        # Six cards, eleven slots. No arrangement of requirements explains that.
        pool = cards(84, 6, "a")
        minimal = _minimal_blocking_set(
            search_over(pool), 1,
            [Requirement(type="playersFromLeague", league="La Liga", op="min", value=1)],
            5.0,
        )
        assert minimal is None

    def test_and_the_diagnosis_then_says_the_requirements_are_RULED_OUT(self):
        pool = cards(84, 6, "a")
        report = diagnose_impossibility(
            pool, FORMATION,
            requirements=[
                Requirement(type="rareCount", op="min", value=1),
                Requirement(type="minPlayerRating", value=80),
            ],
        )
        assert report.kind in ("supply", "unexplained")
        assert "ruled out" in report.describe() or "running out of cards" in report.describe()


class TestSupplyStaysDistinctFromRequirements:
    def test_a_club_simply_short_of_cards_is_not_blamed_on_a_requirement(self):
        pool = cards(84, 6, "a")
        report = diagnose_impossibility(pool, FORMATION)
        assert report.kind in ("supply", "unexplained")
        assert report.binding == []

    def test_the_diagnosis_runs_at_the_squad_that_failed_not_the_one_asked_for(self):
        # Enough for two squads, three asked for. The blocking question is about
        # squad three, and the report says three rather than one.
        pool = cards(84, 22, "a")
        report = diagnose_impossibility(pool, FORMATION, count=3)
        assert report.achievable == 2
        assert "Squad 3 is blocked" in report.describe()
        assert "Built 2 of 3" in report.describe()


class TestASingleSolveSaysWhyRatherThanShrugging:
    """The old reason was "no squad in the available pool satisfies these
    requirements", which is the shrug checkpoint 12 exists to replace."""

    def request(self, pool, **kw):
        from fc_ai_solver import SolveRequest

        return SolveRequest(pool=pool, formation_slots=FORMATION, **kw)

    def test_the_reason_names_the_binding_requirement_and_the_gap(self):
        from fc_ai_solver import solve_single

        pool = cards(84, 6, "s", league="Serie A") + cards(83, 30, "b")
        response = solve_single(self.request(
            pool,
            requirements=[
                Requirement(type="playersFromLeague", league="Serie A", op="min", value=9)
            ],
        ))
        assert response.status == "infeasible"
        assert "ONE REQUIREMENT" in response.reason
        assert "can manage at best 6, 3 short of the 9" in response.reason

    def test_a_universal_conflict_is_reported_without_blaming_the_club(self):
        from fc_ai_solver import solve_single

        response = solve_single(self.request(
            cards(84, 6, "s"),
            requirements=[Requirement(type="totwCount", op="min", value=1)],
            universal_conflicts=["distinctLeagues exactly 1 with distinctNations min 5"],
        ))
        assert response.status == "infeasible"
        assert "IMPOSSIBLE FOR EVERYONE" in response.reason
        # It mentions the club only to rule it out, and quotes no gap against it.
        assert "not just your club" in response.reason
        assert "short of" not in response.reason
        assert "nothing to buy" in response.reason

    def test_it_can_be_turned_off_and_the_old_sentence_comes_back(self):
        from fc_ai_solver import solve_single

        response = solve_single(self.request(cards(84, 6, "s"), diagnose_on_failure=False))
        assert response.reason == "no squad in the available pool satisfies these requirements"

    def test_a_failure_the_diagnosis_calls_solvable_is_not_reported_as_a_shrug(self):
        # The diagnosis does not enforce pins, so it can disagree with the solve.
        # Saying which is better than printing two contradictory sentences.
        from fc_ai_solver import Pin, solve_single

        pool = cards(84, 30, "a")
        response = solve_single(self.request(
            pool,
            pins=[Pin(card_id="a0", slot_index=0), Pin(card_id="a0", slot_index=1)],
        ))
        assert response.status == "infeasible"
        assert "the pins, the exclusions or the exact rating multiset" in response.reason
