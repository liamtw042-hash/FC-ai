"""The margin that makes cost dominate the squad count tie break.

The claim being tested is not "this looks big enough". It is:

    the count term is bounded by max_squads, so scaling cost by max_squads + 1
    makes one coin strictly larger than the entire count term

which holds only while costs are whole coins. Both halves are asserted rather
than reasoned about, because reasoning about it is what produced the flaky test
this tie break exists to fix.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import PoolCard, lexicographic_objective, lexicographic_scale

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]


class TestTheCountTermIsBounded:
    @pytest.mark.parametrize("max_squads", [1, 2, 3, 5, 10, 25, 50, 100])
    def test_the_count_term_can_never_reach_the_scale_factor(self, max_squads):
        # The count term is the number of squads built, which cannot exceed
        # max_squads. If it ever could reach the scale factor, a difference of one
        # squad would be worth a whole coin and the ordering would invert.
        largest_possible_count_term = max_squads
        assert largest_possible_count_term < lexicographic_scale(max_squads)

    @pytest.mark.parametrize("max_squads", [1, 2, 3, 5, 10, 25, 50])
    def test_one_coin_beats_a_whole_extra_squad_at_the_maximum_count(self, max_squads):
        # The worst case for the tie break: the cheaper option builds every squad
        # allowed, the dearer one builds none. One coin still decides it.
        cheaper_but_maximal = lexicographic_objective(100, max_squads, max_squads)
        dearer_but_minimal = lexicographic_objective(101, 0, max_squads)
        assert cheaper_but_maximal < dearer_but_minimal

    @pytest.mark.parametrize("max_squads", [1, 3, 10, 50])
    def test_it_holds_at_every_count_difference_not_just_the_extreme(self, max_squads):
        for built in range(max_squads + 1):
            assert lexicographic_objective(100, built, max_squads) < lexicographic_objective(
                101, 0, max_squads
            )


class TestTheTieBreakOnlyDecidesTies:
    @pytest.mark.parametrize("max_squads", [1, 3, 10])
    def test_at_equal_cost_fewer_squads_wins(self, max_squads):
        for fewer in range(max_squads):
            assert lexicographic_objective(500, fewer, max_squads) < lexicographic_objective(
                500, fewer + 1, max_squads
            )

    def test_and_at_unequal_cost_the_count_is_irrelevant(self):
        # Every pairing of counts, with the cheaper option always winning.
        for cheap_count in range(11):
            for dear_count in range(11):
                assert lexicographic_objective(10, cheap_count, 10) < lexicographic_objective(
                    11, dear_count, 10
                )


class TestCostsAreWholeCoins:
    """The margin argument collapses if the smallest cost difference is not 1."""

    def test_a_fractional_cost_is_refused_at_the_boundary(self):
        with pytest.raises(Exception):
            PoolCard(
                id="frac", rating=84, positions=["CM"], nation="N", league="L", club="C",
                card_type="rare", quantity=1, cost=100.5,
            )

    def test_a_whole_number_expressed_as_a_float_is_fine(self):
        card = PoolCard(
            id="whole", rating=84, positions=["CM"], nation="N", league="L", club="C",
            card_type="rare", quantity=1, cost=100.0,
        )
        assert card.cost == 100
        assert isinstance(card.cost, int)

    def test_what_would_go_wrong_if_a_half_coin_got_through(self):
        # Documentation of the failure being prevented. With a half coin the
        # smallest real cost difference is 0.5, which at max_squads = 10 is worth
        # 5.5 against a count term that reaches 10, so the tie break wins and
        # starts choosing more expensive squads to build fewer of them.
        max_squads = 10
        scale = lexicographic_scale(max_squads)
        half_coin_difference = 0.5 * scale
        assert half_coin_difference < max_squads, "which is exactly the inversion"
