"""The supply model on its own. Fast, because it is a tiny relaxed problem."""

from __future__ import annotations

from fc_ai_solver import PoolCard
from fc_ai_solver.repeat_solve import _supply_diagnosis


def cards(rating: int, count: int, cost: int) -> list[PoolCard]:
    return [
        PoolCard(id=f"r{rating}n{i}", rating=rating, positions=["CM"], nation="N",
                 league="L", club="C", card_type="rare", quantity=1, cost=cost)
        for i in range(count)
    ]


class TestItOnlyFiresWhenTheClubIsActuallyShort:
    def test_a_club_with_enough_reports_nothing(self):
        pool = cards(86, 40, 4000) + cards(85, 40, 2600) + cards(83, 40, 1200)
        assert _supply_diagnosis(pool, [{86: 4, 85: 1, 83: 6}], 4) == []

    def test_a_club_one_card_short_reports_that_one_card(self):
        pool = cards(86, 7, 4000) + cards(85, 40, 2600) + cards(83, 40, 1200)
        (shortfall,) = _supply_diagnosis(pool, [{86: 4, 85: 1, 83: 6}], 2)
        assert (shortfall.rating, shortfall.needed, shortfall.held, shortfall.missing) == (86, 8, 7, 1)


class TestItPicksTheCheapestGapToClose:
    def test_it_prefers_conjuring_the_cheap_rating_when_either_would_do(self):
        # Two multisets reach the same squad rating: one leans on 86s, the other
        # on 85s. Both are short, and the model should buy the cheap way out.
        pool = cards(86, 6, 9000) + cards(85, 6, 500) + cards(83, 60, 1200) + cards(82, 60, 900)
        shortfalls = _supply_diagnosis(pool, [{86: 4, 85: 1, 83: 6}, {86: 3, 85: 4, 82: 4}], 4)
        assert shortfalls, "the club is short either way"
        assert shortfalls[0].rating == 85, "the cheap gap is the one to close"

    def test_several_shortfalls_come_back_cheapest_first(self):
        # One multiset only, so both gaps are forced and neither can be avoided.
        pool = cards(86, 10, 4000) + cards(85, 10, 1000) + cards(83, 60, 1200)
        shortfalls = _supply_diagnosis(pool, [{86: 4, 85: 4, 83: 3}], 4)
        assert [s.rating for s in shortfalls] == [85, 86]
        assert [s.missing for s in shortfalls] == [6, 6]
        assert [s.cost_to_close for s in shortfalls] == [6000, 24000]

    def test_a_rating_the_club_holds_none_of_still_gets_a_price(self):
        # Otherwise the report cannot say what closing the gap would cost.
        pool = cards(83, 60, 1200)
        shortfalls = _supply_diagnosis(pool, [{86: 4, 83: 7}], 2)
        (eighty_six,) = [s for s in shortfalls if s.rating == 86]
        assert eighty_six.held == 0
        assert eighty_six.missing == 8
        assert eighty_six.cost_to_close is not None


class TestWithNoRatingConstraint:
    def test_it_falls_back_to_counting_cards(self):
        pool = cards(84, 15, 100)
        (shortfall,) = _supply_diagnosis(pool, None, 2)
        assert shortfall.needed == 22
        assert shortfall.held == 15
        assert shortfall.missing == 7

    def test_and_reports_nothing_when_there_are_enough(self):
        assert _supply_diagnosis(cards(84, 30, 100), None, 2) == []


class TestTheWording:
    def test_it_reads_as_a_shopping_list(self):
        pool = cards(86, 25, 4000) + cards(85, 20, 2600) + cards(83, 60, 1200)
        shortfalls = _supply_diagnosis(pool, [{86: 4, 85: 1, 83: 6}], 8)
        assert shortfalls[0].describe(8) == (
            "8 squads need 32 cards rated 86, you have 25, add 7"
        )


class TestAShortfallWithNoRating:
    def test_it_says_cards_not_cards_rated_zero(self):
        # rating None means the challenge has no rating requirement, so the
        # shortfall is in cards generally. It used to render as "cards rated 0".
        pool = cards(84, 15, 100)
        (shortfall,) = _supply_diagnosis(pool, None, 2)
        assert shortfall.rating is None
        assert shortfall.describe(2) == "2 squads need 22 cards, you have 15, add 7"
        assert "rated 0" not in shortfall.describe(2)
