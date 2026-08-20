"""The marginal squad test.

The trap: preference bonuses in the cost model are negative, so a card's weighted
cost can fall below zero. In a single solve that is harmless, because the squad is
always eleven cards. In a multi squad solve the COUNT is part of the choice, and a
squad costing less than nothing makes one more squad look like a gain.

These tests hold the line from both ends: the model rejects a negative cost
outright, and given non negative costs it declines a squad it was offered but does
not need.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import NegativeCostError, PoolCard, solve_variable_count

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]


def fodder(count: int, cost: int, prefix: str = "f") -> list[PoolCard]:
    return [
        PoolCard(
            id=f"{prefix}{i}",
            rating=84,
            positions=list(set(FORMATION)),
            nation=f"N{i}",
            league=f"L{i}",
            club=f"C{i}",
            card_type="rare",
            quantity=1,
            cost=cost,
        )
        for i in range(count)
    ]


class TestDeclinesTheMarginalSquad:
    def test_offered_three_squads_and_needing_one_it_builds_one(self):
        # Enough fodder for three squads, only one required. Every extra squad
        # costs something, so the cheapest answer is to stop at one.
        pool = fodder(33, cost=100)
        result = solve_variable_count(pool, FORMATION, max_squads=3, min_squads=1)
        assert result.squads_built == 1
        assert result.total_cost == 11 * 100
        assert result.proven_optimal

    def test_it_still_builds_every_squad_actually_required(self):
        pool = fodder(33, cost=100)
        result = solve_variable_count(pool, FORMATION, max_squads=3, min_squads=3)
        assert result.squads_built == 3
        assert result.total_cost == 33 * 100

    def test_a_free_squad_is_still_declined(self):
        # Zero cost fodder is the boundary case, and the one that caught a real
        # gap. With costs alone the objective is INDIFFERENT here: three squads
        # for nothing is exactly as cheap as one, so the solver was free to build
        # three and did, intermittently. The count is now a lexicographic tie
        # break under cost, so fewer squads wins ties and never wins anything else.
        pool = fodder(33, cost=0)
        for _ in range(5):
            result = solve_variable_count(pool, FORMATION, max_squads=3, min_squads=1)
            assert result.squads_built == 1
            assert result.total_cost == 0

    def test_the_tie_break_never_overrides_a_real_price_difference(self):
        # One coin of genuine cost has to outweigh the whole count term, or the
        # tie break would start choosing worse squads to build fewer of them.
        cheap = fodder(11, cost=0, prefix="cheap")
        dear = fodder(22, cost=1, prefix="dear")
        result = solve_variable_count(cheap + dear, FORMATION, max_squads=3, min_squads=2)
        # Two squads are required, and the cheapest pair uses all eleven free
        # cards plus eleven at a coin each.
        assert result.squads_built == 2
        assert result.total_cost == 11

    def test_it_spends_the_cheap_fodder_first_across_the_whole_run(self):
        # Solved jointly, not one squad at a time. Greedy would burn the cheap
        # eleven on squad one and then have no choice on squad two, which happens
        # to give the same answer here, so the check is on the TOTAL.
        pool = fodder(11, cost=10, prefix="cheap") + fodder(22, cost=500, prefix="dear")
        result = solve_variable_count(pool, FORMATION, max_squads=2, min_squads=2)
        assert result.squads_built == 2
        assert result.total_cost == 11 * 10 + 11 * 500


class TestNegativeCostsAreRefused:
    def test_a_negative_cost_raises_rather_than_being_solved(self):
        # This is the failure the TypeScript offset exists to prevent. If it ever
        # reaches here, the objective is unsound and the answer would be worse
        # than useless, because every extra squad would look optimal.
        pool = fodder(33, cost=100)
        pool[0] = pool[0].model_copy(update={"cost": -150})
        with pytest.raises(NegativeCostError, match="negative cost"):
            solve_variable_count(pool, FORMATION, max_squads=3, min_squads=1)

    def test_and_here_is_what_would_happen_without_that_guard(self):
        # Demonstration, not a behaviour we ship. With every card priced below
        # zero the cheapest answer really is to build as many squads as possible,
        # which is exactly the trap.
        pool = fodder(33, cost=-100)
        with pytest.raises(NegativeCostError):
            solve_variable_count(pool, FORMATION, max_squads=3, min_squads=1)

        # Same pool shifted by a constant offset, which is what costModel.ts does.
        shifted = [card.model_copy(update={"cost": card.cost + 150}) for card in pool]
        result = solve_variable_count(shifted, FORMATION, max_squads=3, min_squads=1)
        assert result.squads_built == 1


class TestSharedPool:
    def test_no_card_is_used_twice_across_squads(self):
        pool = fodder(22, cost=100)
        result = solve_variable_count(pool, FORMATION, max_squads=2, min_squads=2)
        used = [p.card_id for squad in result.squads for p in squad]
        assert len(used) == 22
        assert len(set(used)) == 22

    def test_a_stack_of_three_can_serve_three_squads_and_no_more(self):
        pool = [
            PoolCard(id="stack", rating=84, positions=list(set(FORMATION)), nation="N",
                     league="L", club="C", card_type="rare", quantity=3, cost=1),
        ] + fodder(30, cost=100)
        result = solve_variable_count(pool, FORMATION, max_squads=3, min_squads=3)
        used = [p.card_id for squad in result.squads for p in squad]
        assert used.count("stack") == 3

    def test_says_why_when_the_pool_cannot_field_what_was_asked(self):
        pool = fodder(11, cost=100)
        result = solve_variable_count(pool, FORMATION, max_squads=3, min_squads=2)
        assert result.squads_built == 0
        assert "cannot field 2 squad(s)" in (result.shortfall_reason or "")
