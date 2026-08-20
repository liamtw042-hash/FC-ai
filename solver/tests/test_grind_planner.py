"""The grind planner, brief 6.3.

Built on the supply model rather than beside it, so the tests check both that it
answers the question and that it agrees with the diagnosis it shares a model with.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import PlannerChallenge, PoolCard, plan_grind
from fc_ai_solver.repeat_solve import _supply_diagnosis

M85 = [{86: 4, 85: 1, 83: 6}, {86: 3, 85: 4, 82: 4}]
M84 = [{85: 4, 84: 1, 82: 6}]


def cards(rating: int, count: int, cost: int) -> list[PoolCard]:
    return [
        PoolCard(id=f"r{rating}n{i}", rating=rating, positions=["CM"], nation="N",
                 league="L", club="C", card_type="rare", quantity=1, cost=cost)
        for i in range(count)
    ]


def deep_pool() -> list[PoolCard]:
    return (
        cards(86, 10, 4000) + cards(85, 14, 2600) + cards(84, 10, 1800)
        + cards(83, 30, 1200) + cards(82, 30, 900)
    )


class TestWhatIsAchievableNow:
    def test_it_reports_a_baseline_per_challenge_across_the_whole_queue(self):
        plan = plan_grind(deep_pool(), [
            PlannerChallenge("85 squad", 4, M85),
            PlannerChallenge("84 squad", 3, M84),
        ])
        assert plan.baseline == {"85 squad": 2, "84 squad": 3}
        assert plan.baseline_total == 5

    def test_the_queue_shares_one_pool_so_challenges_compete(self):
        # Alone, the 85 squad reaches three. Queued with the 84 squad, which wants
        # the same 85 rated cards, it reaches fewer.
        alone = plan_grind(deep_pool(), [PlannerChallenge("85 squad", 4, M85)])
        together = plan_grind(deep_pool(), [
            PlannerChallenge("85 squad", 4, M85),
            PlannerChallenge("84 squad", 3, M84),
        ])
        assert together.baseline["85 squad"] < alone.baseline["85 squad"]

    def test_priority_decides_who_gets_the_scarce_cards(self):
        pool = cards(85, 8, 2600) + cards(84, 20, 1800) + cards(83, 40, 1200) + cards(82, 40, 900)
        low = plan_grind(pool, [
            PlannerChallenge("85 squad", 2, M85, priority=1),
            PlannerChallenge("84 squad", 2, M84, priority=1),
        ])
        high = plan_grind(pool, [
            PlannerChallenge("85 squad", 2, M85, priority=1),
            PlannerChallenge("84 squad", 2, M84, priority=5),
        ])
        assert high.baseline["84 squad"] >= low.baseline["84 squad"]

    def test_a_challenge_with_no_rating_requirement_still_eats_eleven_cards(self):
        pool = cards(84, 15, 100)
        plan = plan_grind(pool, [PlannerChallenge("anything goes", 3, None)])
        assert plan.baseline["anything goes"] == 1


class TestTheCheapestPurchase:
    def test_it_names_what_to_buy_the_cost_and_what_it_unlocks(self):
        plan = plan_grind(deep_pool(), [PlannerChallenge("85 squad", 4, M85)])
        step = plan.steps[0]
        assert step.extra_squads == 1
        assert step.coin_cost > 0
        assert step.unlocks["85 squad"] == 1
        assert "to unlock 1 more squad" in step.describe()
        assert "coins per squad" in step.describe()

    def test_it_finds_the_cheapest_MIX_across_shapes_not_one_shape_at_a_time(self):
        # Two shapes reach the same squad rating. One leans on 86s at 9000, the
        # other on 85s at 500. A per shape calculation would quote whichever shape
        # it happened to pick. The model prices both and buys the cheap way out.
        pool = cards(86, 6, 9000) + cards(85, 6, 500) + cards(83, 60, 1200) + cards(82, 60, 900)
        plan = plan_grind(pool, [PlannerChallenge("85 squad", 4, M85)])
        step = plan.steps[0]
        bought = {p.rating for p in step.purchases}
        assert 85 in bought
        assert 86 not in bought, "buying the dear rating would be the per shape answer"

    def test_the_biggest_unlock_is_the_best_value_not_the_largest(self):
        plan = plan_grind(deep_pool(), [PlannerChallenge("85 squad", 4, M85)])
        best = plan.biggest_unlock
        assert best is not None
        for step in plan.steps:
            if step.extra_squads:
                assert best.coins_per_squad <= step.coins_per_squad

    def test_diminishing_returns_are_visible_rather_than_hidden(self):
        # Two challenges, seven squads wanted, five feedable, so there are two
        # steps to compare and the second costs more than the first.
        plan = plan_grind(deep_pool(), [
            PlannerChallenge("85 squad", 4, M85),
            PlannerChallenge("84 squad", 3, M84),
        ])
        assert len(plan.steps) >= 2
        assert plan.steps[1].coin_cost > plan.steps[0].coin_cost
        assert plan.steps[1].coins_per_squad > plan.steps[0].coins_per_squad

    def test_it_stops_at_what_was_actually_asked_for(self):
        plan = plan_grind(deep_pool(), [PlannerChallenge("85 squad", 3, M85)], max_extra_steps=5)
        assert all(plan.baseline_total + s.extra_squads <= 3 for s in plan.steps)


class TestItAgreesWithTheDiagnosisItSharesAModelWith:
    """No second heuristic. A planner that disagreed with the diagnosis would be
    worse than no planner."""

    def test_the_first_step_matches_what_the_shortfall_diagnosis_asks_for(self):
        pool = cards(86, 25, 4000) + cards(85, 20, 2600) + cards(83, 60, 1200) + cards(82, 40, 900)
        challenge = PlannerChallenge("85 squad", 10, M85)
        plan = plan_grind(pool, [challenge], max_extra_steps=1)
        baseline = plan.baseline["85 squad"]

        # The diagnosis asked the same question about the very next squad.
        shortfalls = _supply_diagnosis(pool, M85, baseline + 1)
        planner = {p.rating: p.quantity for p in plan.steps[0].purchases}
        diagnosis = {s.rating: s.missing for s in shortfalls}
        assert planner == diagnosis


class TestWhenBuyingCardsWouldNotHelp:
    def test_it_flags_a_challenge_held_back_by_something_other_than_supply(self):
        # Supply says three squads are feedable. The real solver only managed one,
        # so a requirement is binding and buying cards changes nothing.
        pool = deep_pool()
        plan = plan_grind(
            pool,
            [PlannerChallenge("85 squad", 3, M85)],
            known_achievable={"85 squad": 1},
        )
        assert plan.requirement_limited == ["85 squad"]

    def test_and_says_nothing_when_supply_really_is_the_limit(self):
        # The solver achieved exactly what supply allows, so nothing beyond the
        # club's contents is holding it back and no flag is raised.
        challenges = [PlannerChallenge("85 squad", 4, M85)]
        ceiling = plan_grind(deep_pool(), challenges).baseline["85 squad"]
        plan = plan_grind(deep_pool(), challenges, known_achievable={"85 squad": ceiling})
        assert plan.requirement_limited == []
        assert plan.supply_limited == ["85 squad"]


class TestEdges:
    def test_an_empty_queue_plans_nothing(self):
        plan = plan_grind(deep_pool(), [])
        assert plan.baseline == {}
        assert plan.steps == []
        assert plan.biggest_unlock is None

    def test_a_queue_the_club_already_covers_needs_no_purchases(self):
        pool = cards(86, 60, 4000) + cards(85, 60, 2600) + cards(83, 60, 1200) + cards(82, 60, 900)
        plan = plan_grind(pool, [PlannerChallenge("85 squad", 2, M85)])
        assert plan.baseline["85 squad"] == 2
        assert plan.supply_limited == []
        assert plan.steps == []

    def test_it_refuses_a_nonsense_challenge_rather_than_planning_around_it(self):
        with pytest.raises(ValueError, match="at least 1"):
            PlannerChallenge("bad", 0, M85)
        with pytest.raises(ValueError, match="priority"):
            PlannerChallenge("bad", 1, M85, priority=0)
