"""The grind planner, brief 6.3.

Built on the supply model rather than beside it, so the tests check both that it
answers the question and that it agrees with the diagnosis it shares a model with.
"""

from __future__ import annotations

import pytest

# Depth probing runs a diagnosis per squad, so these are among the slower tests.
# `pytest -m "not slow"` skips them while iterating.
pytestmark = pytest.mark.slow

from fc_ai_solver import (
    DepthBlock,
    PlannerChallenge,
    PoolCard,
    Requirement,
    RequirementBlock,
    ShortfallDiagnosis,
    plan_grind,
)
from fc_ai_solver.repeat_solve import _supply_diagnosis

M85 = [{86: 4, 85: 1, 83: 6}, {86: 3, 85: 4, 82: 4}]
M84 = [{85: 4, 84: 1, 82: 6}]


def cards(rating: int, count: int, cost: int) -> list[PoolCard]:
    return [
        # market_price is what a copy would cost to BUY. `cost` is the weighted
        # figure the solver minimises, and nothing prices a shortfall from it.
        PoolCard(id=f"r{rating}n{i}", rating=rating, positions=["CM"], nation="N",
                 league="L", club="C", card_type="rare", quantity=1, cost=cost,
                 market_price=cost)
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


FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = list(set(FORMATION))
TOTW_REQ = [Requirement(type="totwCount", op="min", value=1)]


def placeable(rating: int, count: int, cost: int, prefix: str, **kw) -> list[PoolCard]:
    return [
        PoolCard(id=f"{prefix}{rating}n{i}", rating=rating, positions=ANY_POSITION,
                 nation=f"N{prefix}{i}", league=f"L{prefix}{i}", club=f"C{prefix}{i}",
                 card_type=kw.pop("card_type", "rare"), quantity=1, cost=cost,
                 market_price=kw.pop("market_price", cost), **kw)
        for i in range(count)
    ]


def totw_starved_pool(totw_count: int = 2) -> list[PoolCard]:
    """Deep at every rating, but only a couple of TOTW cards."""
    return (
        placeable(86, 30, 4000, "h") + placeable(85, 30, 2600, "m")
        + placeable(84, 20, 1800, "n") + placeable(83, 60, 1200, "l")
        + placeable(82, 60, 900, "x")
        + placeable(83, totw_count, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
    )


class TestAFlagCarriesItsReason:
    """A warning without a reason is exactly where someone buys anyway, with a
    confident coin figure sitting next to it."""

    def test_the_diagnosis_is_run_and_attached(self):
        pool = totw_starved_pool()
        plan = plan_grind(
            pool,
            [PlannerChallenge("85 TOTW squad", 4, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        (block,) = plan.blocks
        assert block.achieved == 2
        assert block.supply_ceiling == 4
        assert block.depths
        assert block.depths[0].depth == 3
        assert block.depths[0].mode == "requirement"
        assert "totwCount min 1" in block.depths[0].explanation

    def test_and_the_message_names_the_blocker_rather_than_warning_vaguely(self):
        pool = totw_starved_pool()
        plan = plan_grind(
            pool,
            [PlannerChallenge("85 TOTW squad", 4, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        described = plan.blocks[0].describe()
        assert "Buying cards would not help" in described
        assert "Squad 3 is blocked by totwCount min 1" in described

    def test_without_the_inputs_to_diagnose_it_says_so_rather_than_guessing(self):
        # No formation supplied, so the plan can say a challenge is held back by
        # something other than supply but not what.
        plan = plan_grind(
            deep_pool(),
            [PlannerChallenge("85 squad", 3, M85)],
            known_achievable={"85 squad": 1},
        )
        (block,) = plan.blocks
        assert block.depths == []
        assert "cannot say what is blocking it" in block.describe()

    def test_an_unexplained_diagnosis_is_reported_as_unexplained(self):
        block = RequirementBlock(
            name="odd one",
            achieved=2,
            supply_ceiling=5,
            depths=[
                DepthBlock(3, "unexplained", "no single requirement and no pair explains it"),
                DepthBlock(4, "unexplained", "no single requirement and no pair explains it"),
            ],
            conditional_supply=[],
            probed_to=4,
            requested=4,
        )
        described = block.describe()
        assert "could not name" in described
        # And no room to read it as "the purchase might work anyway".
        assert "Buying cards is not the answer" in described


class TestAFlaggedChallengeGetsNoPurchaseQuoted:
    """A quoted number next to a warning gets read as a number, so the number goes."""

    def test_no_step_ever_unlocks_a_flagged_challenge(self):
        pool = totw_starved_pool()
        challenges = [
            PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                             requirements=TOTW_REQ),
            PlannerChallenge("84 squad", 6, M84, formation_slots=FORMATION),
        ]
        plan = plan_grind(pool, challenges, known_achievable={"85 TOTW squad": 2})
        assert plan.requirement_limited == ["85 TOTW squad"]
        for step in plan.steps:
            assert step.unlocks["85 TOTW squad"] == 0

    def test_purchases_target_the_unflagged_challenge_instead(self):
        # The unflagged challenge has to be genuinely supply limited for there to
        # be anything worth buying, so this pool is thin on 84s. Pinning the
        # flagged challenge also caps the queue total, which is why the first
        # version of this test found nothing to buy: the only headroom left in
        # the queue belonged to the challenge that cannot use it.
        pool = (
            placeable(86, 30, 4000, "h") + placeable(85, 30, 2600, "m")
            + placeable(84, 3, 1800, "n") + placeable(83, 60, 1200, "l")
            + placeable(82, 60, 900, "x")
            + placeable(83, 2, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
        )
        challenges = [
            PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                             requirements=TOTW_REQ),
            PlannerChallenge("84 squad", 6, M84, formation_slots=FORMATION),
        ]
        plan = plan_grind(pool, challenges, known_achievable={"85 TOTW squad": 2})
        assert plan.steps, "the 84 squad is short of 84s, so there is something to buy"
        assert plan.steps[0].unlocks["84 squad"] >= 1
        assert plan.steps[0].unlocks["85 TOTW squad"] == 0
        assert 84 in {p.rating for p in plan.steps[0].purchases}

    def test_the_flagged_challenge_is_reported_at_what_it_can_really_build(self):
        pool = totw_starved_pool()
        plan = plan_grind(
            pool,
            [
                PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                                 requirements=TOTW_REQ),
                PlannerChallenge("84 squad", 6, M84, formation_slots=FORMATION),
            ],
            known_achievable={"85 TOTW squad": 2},
        )
        # The ceiling is kept for the explanation, but the baseline is the truth.
        assert plan.baseline["85 TOTW squad"] == 2
        assert plan.supply_ceiling["85 TOTW squad"] > 2
        assert "85 TOTW squad" not in plan.supply_limited


class TestAQueueWhereNothingIsUnflagged:
    def test_there_is_no_shopping_list_at_all(self):
        pool = totw_starved_pool()
        plan = plan_grind(
            pool,
            [PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        assert plan.queue_is_requirement_blocked
        assert plan.steps == []
        assert plan.biggest_unlock is None

    def test_and_the_summary_says_requirement_blocked_not_supply_blocked(self):
        pool = totw_starved_pool()
        plan = plan_grind(
            pool,
            [PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        summary = plan.summary()
        assert "requirement blocked, not supply blocked" in summary
        assert "there is no shopping list" in summary
        assert "Squad 3 is blocked by totwCount min 1" in summary
        # No coin figure anywhere, because that is the thing that gets read.
        assert "coins" not in summary
        assert "Best value purchase" not in summary

    def test_a_healthy_queue_still_gets_its_shopping_list(self):
        plan = plan_grind(deep_pool(), [
            PlannerChallenge("85 squad", 4, M85),
            PlannerChallenge("84 squad", 3, M84),
        ])
        assert not plan.queue_is_requirement_blocked
        assert "Best value purchase" in plan.summary()
        assert "coins per squad" in plan.summary()


def deep_at_every_rating() -> list[PoolCard]:
    """Ratings are plentiful, so the TOTW requirement is the only thing biting."""
    return (
        placeable(86, 40, 4000, "h") + placeable(85, 40, 2600, "m")
        + placeable(83, 80, 1200, "l") + placeable(82, 80, 900, "x")
        + placeable(83, 2, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
    )


def thin_at_the_top() -> list[PoolCard]:
    """Enough ratings for four squads and no more, plus two TOTW cards."""
    return (
        placeable(86, 13, 4000, "h") + placeable(85, 16, 2600, "m")
        + placeable(83, 30, 1200, "l") + placeable(82, 20, 900, "x")
        + placeable(83, 2, 1500, "totw", card_type="totw", is_totw=True, is_rare=True)
    )


class TestBlockingIsPerSquadNotPerChallenge:
    """A requirement that stops squad 3 does not necessarily stop squad 5.

    Diagnosing only the first unbuildable squad and flagging the whole challenge
    hides a purchase that really would work once the requirement is dealt with.
    """

    def test_when_the_requirement_binds_all_the_way_nothing_changes(self):
        # Ratings are plentiful, so removing the TOTW requirement unlocks every
        # depth asked for. There is no supply story at any depth and the plan
        # should not invent one.
        plan = plan_grind(
            deep_at_every_rating(),
            [PlannerChallenge("85 TOTW squad", 5, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        (block,) = plan.blocks
        assert [d.mode for d in block.depths] == ["requirement"] * 3
        assert block.requirement_binds_through == 5
        assert block.binds_all_the_way
        assert block.supply_depths == []
        assert block.conditional_supply == []

        described = block.describe()
        assert "Buying cards would not help" in described
        assert "Squad 3 is blocked by totwCount min 1" in described
        assert "PRECONDITION" not in described, "there is no deeper purchase to caveat"

    def test_when_it_binds_at_three_and_four_the_deeper_supply_need_is_reported(self):
        plan = plan_grind(
            thin_at_the_top(),
            [PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        (block,) = plan.blocks
        assert [(d.depth, d.mode) for d in block.depths] == [
            (3, "requirement"), (4, "requirement"), (5, "supply"), (6, "supply"),
        ]
        assert block.requirement_binds_through == 4
        assert not block.binds_all_the_way
        assert block.supply_depths == [5, 6]
        assert block.conditional_supply, "the deeper squads have a card need to report"

    def test_and_the_precondition_is_stated_so_the_cards_are_not_bought_alone(self):
        plan = plan_grind(
            thin_at_the_top(),
            [PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        described = plan.blocks[0].describe()
        assert "Squad 3 is blocked by totwCount min 1" in described
        assert "squads 5 to 6 would also need cards" in described
        assert "rated 86" in described
        # The whole point: buying without clearing the requirement gets nothing.
        assert "PRECONDITION" in described
        assert "Buying those cards on their own unlocks nothing" in described

    def test_the_deeper_need_is_still_not_a_shopping_list_entry(self):
        # It is reported inside the block's explanation, never as a quoted step,
        # because the challenge still cannot grow until the requirement is cleared.
        plan = plan_grind(
            thin_at_the_top(),
            [PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        assert plan.queue_is_requirement_blocked
        assert plan.steps == []
        for step in plan.steps:
            assert step.unlocks["85 TOTW squad"] == 0

    def test_by_default_it_probes_every_squad_that_was_asked_for(self):
        # A fixed cap of four meant a run of ten stopped at squad six and said
        # nothing about the rest, which is the depth range this exists to cover.
        plan = plan_grind(
            deep_at_every_rating(),
            [PlannerChallenge("85 TOTW squad", 6, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
        )
        (block,) = plan.blocks
        assert block.probed_to == 6
        assert [d.depth for d in block.depths] == [3, 4, 5, 6]
        assert not block.probing_was_capped
        assert "UNKNOWN" not in block.describe()

    def test_when_capped_it_says_the_rest_is_unknown_rather_than_nothing(self):
        plan = plan_grind(
            deep_at_every_rating(),
            [PlannerChallenge("85 TOTW squad", 8, M85, formation_slots=FORMATION,
                              requirements=TOTW_REQ)],
            known_achievable={"85 TOTW squad": 2},
            max_depth_probes=2,
        )
        (block,) = plan.blocks
        assert block.probed_to == 4
        assert [d.depth for d in block.depths] == [3, 4]
        assert block.probing_was_capped
        described = block.describe()
        # Silence beyond the cap would read as "nothing blocks those", which is
        # not what a cap means.
        assert "Squads 5 to 8 were not probed" in described
        assert "UNKNOWN rather than nothing" in described


class TestAStepThatCannotBeCostedIsNotCosted:
    """An estimate rendered as a plain number is the same failure the purchase
    suppression exists to prevent. A wrong number gets acted on."""

    @staticmethod
    def pool_missing_a_rating() -> list[PoolCard]:
        # No cards rated 86 at all, so 86 has no price from anywhere.
        return placeable(85, 30, 2600, "m") + placeable(83, 60, 1200, "l")

    def test_the_coin_figure_is_withheld_and_the_rating_is_named(self):
        plan = plan_grind(
            self.pool_missing_a_rating(),
            [PlannerChallenge("85 squad", 3, [{86: 4, 85: 1, 83: 6}])],
        )
        assert plan.steps, "there is still something to buy, it just cannot be priced"
        step = plan.steps[0]
        assert not step.is_costable
        assert step.coin_cost is None
        assert step.coins_per_squad is None
        described = step.describe()
        assert "COST NOT QUOTED" in described
        assert "rating(s) 86 have no price" in described
        assert "at an unknown price" in described

    def test_an_uncostable_step_is_never_ranked_as_best_value(self):
        # Ranking it would mean inventing the value it is ranked on.
        plan = plan_grind(
            self.pool_missing_a_rating(),
            [PlannerChallenge("85 squad", 3, [{86: 4, 85: 1, 83: 6}])],
        )
        assert plan.biggest_unlock is None
        summary = plan.summary()
        assert "No purchase can be ranked by value" in summary
        assert "which have no price" in summary
        assert "Add them to the price table" in summary

    def test_supplying_a_price_table_turns_it_back_into_a_shopping_list(self):
        plan = plan_grind(
            self.pool_missing_a_rating(),
            [PlannerChallenge("85 squad", 3, [{86: 4, 85: 1, 83: 6}])],
            rating_prices={86: 9000},
        )
        step = plan.steps[0]
        assert step.is_costable
        assert step.coin_cost is not None
        assert plan.biggest_unlock is not None
        assert "coins per squad" in plan.summary()

    def test_a_priced_step_still_quotes_normally(self):
        plan = plan_grind(deep_pool(), [PlannerChallenge("85 squad", 4, M85)])
        assert plan.steps[0].is_costable
        assert "COST NOT QUOTED" not in plan.steps[0].describe()

    def test_a_table_price_beats_the_club_price(self):
        plan = plan_grind(
            deep_pool(),
            [PlannerChallenge("85 squad", 4, M85)],
            rating_prices={86: 50_000},
        )
        eighty_six = [p for step in plan.steps for p in step.purchases if p.rating == 86]
        for purchase in eighty_six:
            assert purchase.basis == "table"
            assert purchase.unit_cost == 50_000


class TestTheAvoidanceBiasIsStatedWhereTheNumberIs:
    """The weighting steers the mix away from ratings it cannot price. That makes
    the quoted cost possibly not the cheapest available, and a caveat only counts
    if it sits next to the number rather than in a design note."""

    # Two shapes for a squad rating of 85, from the enumerator. One leans on 86s,
    # the other reaches the same rating with an 87 and no 86s at all. The first
    # scenario I wrote had every shape needing 86s, so there was no mix to dodge
    # with and the flag was correctly empty.
    SHAPES = [{86: 4, 85: 1, 83: 6}, {87: 1, 85: 6, 83: 4}]

    @staticmethod
    def pool_with_one_unpriced_rating() -> list[PoolCard]:
        # Nothing rated 86 in the club, so 86 has no price, but the 87 shape can
        # be filled entirely from stock.
        return (
            placeable(87, 12, 6000, "t") + placeable(85, 40, 2600, "m")
            + placeable(83, 40, 1200, "l")
        )

    def test_a_priced_mix_that_dodged_an_unpriced_rating_says_so(self):
        plan = plan_grind(
            self.pool_with_one_unpriced_rating(),
            [PlannerChallenge("85 squad", 8, self.SHAPES)],
        )
        step = next(s for s in plan.steps if s.is_costable)
        assert 86 in step.avoided_unpriced
        described = step.describe()
        assert "coins per squad" in described, "it is still costed"
        assert "NOT NECESSARILY THE CHEAPEST" in described
        assert "avoids rating(s) 86" in described
        assert "might cost less and nothing here can tell" in described

    def test_the_caveat_disappears_once_the_rating_has_a_price(self):
        plan = plan_grind(
            self.pool_with_one_unpriced_rating(),
            [PlannerChallenge("85 squad", 8, self.SHAPES)],
            rating_prices={86: 4000},
        )
        for step in plan.steps:
            assert step.avoided_unpriced == []
            assert "NOT NECESSARILY THE CHEAPEST" not in step.describe()

    def test_a_fully_priced_pool_carries_no_caveat(self):
        plan = plan_grind(deep_pool(), [PlannerChallenge("85 squad", 4, M85)])
        assert plan.avoided_unpriced == []
        for step in plan.steps:
            assert "NOT NECESSARILY THE CHEAPEST" not in step.describe()

    def test_the_plan_collects_every_rating_it_was_steered_away_from(self):
        plan = plan_grind(
            self.pool_with_one_unpriced_rating(),
            [PlannerChallenge("85 squad", 8, self.SHAPES)],
        )
        assert plan.avoided_unpriced == [86]
