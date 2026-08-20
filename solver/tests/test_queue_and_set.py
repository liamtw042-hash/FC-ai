"""Set mode, queue mode and diversity. Brief 6.2, 6.3, 6.4."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.slow

from fc_ai_solver import (
    MixedSquadSizeError,
    Pin,
    PoolCard,
    QueueItem,
    Requirement,
    SolveRequest,
    solve_alternatives,
    solve_queue,
    solve_set,
)

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
EIGHT = ["GK", "CB", "CB", "RB", "CM", "CM", "ST", "ST"]
ANY_POSITION = list(set(FORMATION))
M85 = [{86: 4, 85: 1, 83: 6}, {86: 3, 85: 4, 82: 4}]


def cards(rating: int, count: int, cost: int, prefix: str, **kw) -> list[PoolCard]:
    return [
        PoolCard(id=f"{prefix}{i}", rating=rating, positions=ANY_POSITION,
                 nation=f"N{prefix}{i}", league=f"L{prefix}{i}", club=f"C{prefix}{i}",
                 card_type=kw.pop("card_type", "rare"), quantity=1, cost=cost,
                 coins_spent=cost, value_burned=0, **kw)
        for i in range(count)
    ]


def deep_pool() -> list[PoolCard]:
    return (
        cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m")
        + cards(83, 80, 1200, "l") + cards(82, 80, 900, "x")
    )


def item(name: str, **kw) -> QueueItem:
    return QueueItem(name=name, formation_slots=FORMATION, **kw)


class TestSetMode:
    def test_a_set_that_fits_completes_and_totals_its_cost(self):
        outcome = solve_set(deep_pool(), [
            item("challenge 1", multisets=M85, set_name="marquee"),
            item("challenge 2", multisets=M85, set_name="marquee"),
            item("challenge 3", multisets=M85, set_name="marquee"),
        ])
        assert outcome.complete
        assert outcome.squads_built == 3
        assert outcome.total_cost > 0
        assert "set marquee: complete" in outcome.describe()

    def test_no_card_is_used_twice_across_the_set(self):
        outcome = solve_set(deep_pool(), [
            item("a", multisets=M85, set_name="s"),
            item("b", multisets=M85, set_name="s"),
        ])
        used = [p.card_id for o in outcome.items for squad in o.squads for p in squad]
        assert len(used) == len(set(used))

    def test_set_infeasibility_is_reported_PER_CHALLENGE_not_as_one_failure(self):
        # Two TOTW cards, three challenges each needing one. Two solvable, one not,
        # and knowing which is the actionable part.
        pool = deep_pool() + cards(83, 2, 1500, "totw", card_type="totw",
                                   is_totw=True, is_rare=True)
        totw = [Requirement(type="totwCount", op="min", value=1)]
        outcome = solve_set(pool, [
            item("needs totw 1", multisets=M85, requirements=totw, set_name="hard"),
            item("needs totw 2", multisets=M85, requirements=totw, set_name="hard"),
            item("needs totw 3", multisets=M85, requirements=totw, set_name="hard"),
        ])
        assert not outcome.complete
        solved = [o.name for o in outcome.items if o.complete]
        failed = [o.name for o in outcome.items if not o.complete]
        assert len(solved) == 2
        assert len(failed) == 1
        described = outcome.describe()
        assert "set hard: INCOMPLETE" in described
        assert "solvable" in described
        # And the failing one carries its own diagnosis, not a shared shrug.
        failing = next(o for o in outcome.items if not o.complete)
        assert failing.diagnosis is not None
        assert "totwCount min 1" in failing.diagnosis.explanation


class TestQueueMode:
    def test_a_mixed_queue_of_one_offs_sets_and_repeats(self):
        outcome = solve_queue(deep_pool(), [
            item("one off", multisets=M85),
            item("set member a", multisets=M85, kind="set", set_name="pair"),
            item("set member b", multisets=M85, kind="set", set_name="pair"),
            item("repeat x3", multisets=M85, kind="repeat", count=3),
        ])
        assert outcome.squads_built == 6
        by_name = {o.name: o for o in outcome.items}
        assert by_name["repeat x3"].achieved == 3
        assert by_name["one off"].achieved == 1

    def test_one_shared_pool_with_nothing_used_twice_anywhere(self):
        outcome = solve_queue(deep_pool(), [
            item("a", multisets=M85, kind="repeat", count=2),
            item("b", multisets=M85, kind="repeat", count=2),
        ])
        used = [p.card_id for o in outcome.items for squad in o.squads for p in squad]
        assert len(used) == 44
        assert len(set(used)) == 44

    def test_priority_decides_who_gets_the_scarce_fodder(self):
        # Only enough for two squads. Whichever item has the higher priority
        # should take them.
        thin = cards(86, 8, 4000, "h") + cards(85, 8, 2600, "m") + cards(83, 12, 1200, "l")
        low = solve_queue(thin, [
            item("cheap sbc", multisets=M85, kind="repeat", count=3, priority=1),
            item("valuable sbc", multisets=M85, kind="repeat", count=3, priority=1),
        ])
        high = solve_queue(thin, [
            item("cheap sbc", multisets=M85, kind="repeat", count=3, priority=1),
            item("valuable sbc", multisets=M85, kind="repeat", count=3, priority=10),
        ])
        valuable_low = next(o for o in low.items if o.name == "valuable sbc").achieved
        valuable_high = next(o for o in high.items if o.name == "valuable sbc").achieved
        assert valuable_high >= valuable_low
        assert valuable_high == high.squads_built, "priority took everything it could"

    def test_a_partially_feedable_queue_comes_back_partially_solved(self):
        # The gate that made this work: requirements are enforced only on squads
        # that are actually built. Without it an unbuilt squad fails its own
        # minimums and the whole queue reads infeasible.
        thin = cards(86, 8, 4000, "h") + cards(85, 8, 2600, "m") + cards(83, 12, 1200, "l")
        outcome = solve_queue(thin, [
            item("big ask", multisets=M85, kind="repeat", count=6,
                 requirements=[Requirement(type="teamRating", op="min", value=85)]),
        ])
        assert 0 < outcome.squads_built < 6
        assert not outcome.complete

    def test_the_uniform_squad_size_guard_applies(self):
        with pytest.raises(MixedSquadSizeError):
            solve_queue(deep_pool(), [
                item("eleven", multisets=M85),
                QueueItem(name="invented eight", formation_slots=EIGHT),
            ])

    def test_coins_spent_and_value_burned_stay_separate(self):
        pool = [
            card.model_copy(update={"coins_spent": 0, "value_burned": card.cost})
            for card in deep_pool()
        ]
        outcome = solve_queue(pool, [item("a", multisets=M85)])
        assert outcome.coins_spent == 0
        assert outcome.value_burned == outcome.total_cost

    def test_it_reports_through_the_existing_grind_planner(self):
        # Not a second planner. The queue hands its achieved counts to plan_grind
        # so the supply picture and the solve agree by construction.
        outcome = solve_queue(deep_pool(), [item("a", multisets=M85, kind="repeat", count=3)])
        assert outcome.plan is not None
        assert "a" in outcome.plan.baseline
        assert outcome.plan.summary() in outcome.describe()


class TestTheTenEightyFivesInAMixedQueue:
    def test_it_runs_and_reports_what_it_achieved(self):
        pool = (
            cards(86, 60, 4000, "h") + cards(85, 40, 2600, "m")
            + cards(83, 80, 1200, "l") + cards(82, 80, 900, "x")
        )
        outcome = solve_queue(pool, [
            item("ten 85s", multisets=M85, kind="repeat", count=10, priority=5),
            item("side sbc", multisets=M85, kind="one_off", priority=1),
        ], time_budget_seconds=120.0)
        ten = next(o for o in outcome.items if o.name == "ten 85s")
        assert ten.achieved == 10, outcome.describe()
        assert outcome.squads_built >= 10


class TestDiversity:
    def base_request(self, pool) -> SolveRequest:
        return SolveRequest(
            pool=pool, formation_slots=FORMATION, rating_counts={86: 4, 85: 1, 83: 6},
        )

    def test_it_returns_several_solutions_cheapest_first(self):
        result = solve_alternatives(self.base_request(deep_pool()), count=5)
        assert len(result.alternatives) == 5
        costs = [a.response.total_cost for a in result.alternatives]
        assert costs == sorted(costs)

    def test_each_differs_from_every_earlier_one_by_at_least_K_cards(self):
        result = solve_alternatives(self.base_request(deep_pool()), count=5, min_difference=3)
        for later in range(1, len(result.alternatives)):
            for earlier in range(later):
                difference = result.alternatives[later].differs_from(result.alternatives[earlier])
                assert difference >= 3, f"#{later + 1} vs #{earlier + 1}"

    def test_a_bigger_K_makes_them_more_different(self):
        result = solve_alternatives(self.base_request(deep_pool()), count=3, min_difference=8)
        for later in range(1, len(result.alternatives)):
            assert result.alternatives[later].differs_from(result.alternatives[0]) >= 8

    def test_the_compact_diff_names_what_changed(self):
        result = solve_alternatives(self.base_request(deep_pool()), count=2)
        dropped, added = result.alternatives[1].diff_against(result.alternatives[0])
        assert len(dropped) == len(added) >= 3
        assert "out" in result.describe() and "in" in result.describe()

    def test_running_out_is_reported_honestly_not_as_a_failure(self):
        # Exactly enough cards for one squad, so there is no second one.
        exact = cards(86, 4, 4000, "h") + cards(85, 1, 2600, "m") + cards(83, 6, 1200, "l")
        result = solve_alternatives(self.base_request(exact), count=5)
        assert len(result.alternatives) == 1
        assert result.exhausted
        assert "Only 1 of 5 found" in result.describe()

    def test_pins_hold_across_a_re_solve(self):
        pool = deep_pool()
        pinned_id = pool[0].id
        # Pin objects, not dicts: model_copy(update=...) bypasses validation, so a
        # dict here reaches the solver unconverted and fails on attribute access.
        request = self.base_request(pool).model_copy(
            update={"pins": [Pin(card_id=pinned_id, slot_index=0)]}
        )
        result = solve_alternatives(request, count=4, min_difference=3)
        assert len(result.alternatives) >= 2
        for alternative in result.alternatives:
            slot_zero = next(p for p in alternative.response.placements if p.slot_index == 0)
            assert slot_zero.card_id == pinned_id, "the pin held"

    def test_the_count_is_capped(self):
        with pytest.raises(ValueError, match="capped at 20"):
            solve_alternatives(self.base_request(deep_pool()), count=21)


class TestContentionIsAFifthKindOfCause:
    """A queue item can be perfectly buildable and still lose. Diagnosing it
    against the whole club calls that a supply or requirement problem, or worse,
    says the club holds enough cards while the planner says to buy some."""

    def exact_for_two(self) -> list[PoolCard]:
        # Exactly one shape of M85 twice over, nothing spare.
        return cards(86, 8, 4000, "h") + cards(85, 2, 2600, "m") + cards(83, 12, 1200, "l")

    def test_an_item_that_loses_the_race_is_named_as_contention(self):
        outcome = solve_queue(self.exact_for_two(), [
            item("hog", multisets=M85, kind="repeat", count=2, priority=10),
            item("loser", multisets=M85, kind="one_off", priority=1),
        ])
        loser = next(o for o in outcome.items if o.name == "loser")
        assert loser.achieved == 0
        assert loser.diagnosis is not None
        assert loser.diagnosis.mode == "contention", loser.diagnosis.explanation

    def test_it_names_the_rivals_that_took_the_cards(self):
        outcome = solve_queue(self.exact_for_two(), [
            item("hog", multisets=M85, kind="repeat", count=2, priority=10),
            item("loser", multisets=M85, kind="one_off", priority=1),
        ])
        loser = next(o for o in outcome.items if o.name == "loser")
        assert "hog" in loser.diagnosis.explanation
        assert "Raise this item's priority" in loser.diagnosis.explanation

    def test_the_diagnosis_runs_against_what_is_LEFT_not_the_whole_club(self):
        # The bug this was written for: the whole club diagnosis said "the pool,
        # though it holds enough cards at every rating" while the planner in the
        # same output said buying three cards would unlock it. Both were right
        # about different pools, which is the same as being wrong.
        outcome = solve_queue(self.exact_for_two(), [
            item("hog", multisets=M85, kind="repeat", count=2, priority=10),
            item("loser", multisets=M85, kind="one_off", priority=1),
        ])
        loser = next(o for o in outcome.items if o.name == "loser")
        explanation = loser.diagnosis.explanation
        assert "holds enough cards at every rating" not in explanation
        assert "the club running out of cards" in explanation
        assert loser.diagnosis.supply, "the residual shortfall is carried through"

    def test_an_item_that_could_not_be_built_ALONE_keeps_its_real_cause(self):
        # Contention is asked FIRST, and the answer here is no. So the diagnosis
        # runs against the whole club, not the leftovers: against the leftovers an
        # impossible requirement reads as "the club is running out of cards",
        # which is true of what is left and useless as advice.
        outcome = solve_queue(self.exact_for_two(), [
            item("hog", multisets=M85, kind="repeat", count=2, priority=10),
            item("impossible", multisets=M85, kind="one_off", priority=1,
                 requirements=[Requirement(type="totwCount", op="min", value=1)]),
        ])
        blocked = next(o for o in outcome.items if o.name == "impossible")
        assert blocked.achieved == 0
        assert blocked.diagnosis.mode == "requirement"
        assert "totwCount min 1" in blocked.diagnosis.explanation
        assert "CONTENTION" not in blocked.diagnosis.explanation

    def test_equal_priority_rivals_are_named_too(self):
        # Losing to an equal is still contention, and the fix is different:
        # raising this item's priority actually works.
        outcome = solve_queue(self.exact_for_two(), [
            item("first", multisets=M85, kind="repeat", count=2, priority=1),
            item("second", multisets=M85, kind="one_off", priority=1),
        ])
        short = [o for o in outcome.items if not o.complete]
        assert short, "the pool feeds two squads, not three"
        assert short[0].diagnosis.mode == "contention"

    def test_a_lone_item_that_falls_short_is_never_called_contention(self):
        # Nothing took its cards. There is nobody to blame but the club.
        outcome = solve_queue(self.exact_for_two(), [
            item("only", multisets=M85, kind="repeat", count=4, priority=1),
        ])
        only = next(o for o in outcome.items if o.name == "only")
        assert only.achieved == 2
        assert only.diagnosis.mode != "contention"


class TestThePlannerAgreesWithTheDiagnosis:
    """The contradiction had a second half. The item level diagnosis and the grind
    planner are two views of the same solve, and they have to agree."""

    def exact_for_two(self) -> list[PoolCard]:
        return cards(86, 8, 4000, "h") + cards(85, 2, 2600, "m") + cards(83, 12, 1200, "l")

    def queue(self):
        return solve_queue(self.exact_for_two(), [
            item("hog", multisets=M85, kind="repeat", count=2, priority=10),
            item("loser", multisets=M85, kind="one_off", priority=1),
        ])

    def test_losing_the_race_is_not_reported_as_a_block(self):
        # The planner used to compare this challenge's count in ITS optimal
        # solution against its count in the queue's. With two challenges of equal
        # standing and one squad to go round, which one gets it is an arbitrary
        # tie break, so the two solutions disagree and a challenge nothing is
        # blocking gets flagged.
        plan = self.queue().plan
        assert [b.name for b in plan.blocks] == []

    def test_it_quotes_the_purchase_that_the_item_diagnosis_asked_for(self):
        outcome = self.queue()
        loser = next(o for o in outcome.items if o.name == "loser")
        assert loser.diagnosis.mode == "contention"
        assert "buy more fodder" in loser.diagnosis.explanation
        summary = outcome.plan.summary()
        assert "Buying cards would not help" not in summary
        assert "buy" in summary and "loser" in summary

    def test_a_rating_the_queue_spent_to_zero_still_has_a_price(self):
        # HOW MANY is a question about what is left. HOW MUCH EACH is a question
        # about the market. Pricing the residual off the residual made a rating the
        # queue had spent down read as unpriced, while the planner quoted it by
        # name in the same output.
        outcome = self.queue()
        loser = next(o for o in outcome.items if o.name == "loser")
        assert loser.diagnosis.supply, "there is a residual shortfall to price"
        assert all(s.is_priced for s in loser.diagnosis.supply)
        assert "The total cost is NOT quoted" not in loser.diagnosis.explanation
        # The AVOIDS caveat is a different thing and stays: rating 82 is absent
        # from this club entirely, so it is unpriced no matter which pool is asked.

    def test_the_baseline_never_understates_what_was_actually_built(self):
        # Reading a challenge's baseline off the planner's own tie break made the
        # baseline lower than the squads the queue had already built, and the
        # first purchase step then offered one of them back "for nothing".
        outcome = self.queue()
        for o in outcome.items:
            assert outcome.plan.baseline[o.name] >= o.achieved
        assert "for nothing" not in outcome.plan.summary()
