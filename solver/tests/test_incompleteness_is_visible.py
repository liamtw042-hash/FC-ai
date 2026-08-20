"""The second audit: where a result that means "we did not finish looking" was
reported as "we looked and it is not there".

Every one of these is the same defect wearing different clothes. A CP-SAT solve
that runs out of time returns UNKNOWN, `_Search.feasible` has to return a bool, so
a timeout reads as "infeasible" and every sentence downstream is stated as fact.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import (
    PlannerChallenge,
    PoolCard,
    QueueItem,
    Requirement,
    plan_grind,
    solve_queue,
)
from fc_ai_solver.grind_planner import GrindPlan
from fc_ai_solver.repeat_solve import _diagnose, _Search

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = sorted(set(FORMATION))
M85 = [{86: 4, 85: 1, 83: 6}, {86: 3, 85: 4, 82: 4}]


def cards(rating: int, count: int, cost: int, prefix: str) -> list[PoolCard]:
    return [
        PoolCard(id=f"{prefix}{i}", rating=rating, positions=ANY_POSITION,
                 nation=f"N{prefix}{i}", league=f"L{prefix}{i}", club=f"C{prefix}{i}",
                 card_type="rare", quantity=1, cost=cost, market_price=cost)
        for i in range(count)
    ]


class TimingOutSearch(_Search):
    """A search whose probes never finish. Every `feasible` is a timeout."""

    def __init__(self, pool):
        super().__init__(pool, FORMATION, None, None, 0.001, 1)

    def feasible(self, count, requirements, budget=None) -> bool:
        self.solves += 1
        self.unknown += 1
        return False


class TestADiagnosisSaysWhenItDidNotFinish:
    def test_a_probe_that_times_out_is_counted_rather_than_read_as_infeasible(self):
        search = TimingOutSearch(cards(84, 22, 1000, "a"))
        diagnosis = _diagnose(
            search, 1, [Requirement(type="rareCount", op="min", value=1)], 0.001
        )
        assert diagnosis.probes_timed_out > 0
        assert not diagnosis.complete

    def test_and_the_explanation_says_so_where_the_answer_is(self):
        # A caveat only counts if it is where the number is.
        search = TimingOutSearch(cards(84, 22, 1000, "a"))
        diagnosis = _diagnose(
            search, 1, [Requirement(type="rareCount", op="min", value=1)], 0.001
        )
        assert "NOT A COMPLETE ANSWER" in diagnosis.explanation
        assert "ran out of time" in diagnosis.explanation

    def test_a_diagnosis_whose_probes_all_finished_carries_no_caveat(self):
        pool = cards(84, 6, 1000, "a")
        search = _Search(pool, FORMATION, None, None, 10.0, 8)
        diagnosis = _diagnose(search, 1, [], 10.0)
        assert diagnosis.probes_timed_out == 0
        assert diagnosis.complete
        assert "NOT A COMPLETE ANSWER" not in diagnosis.explanation


class TestThePlannerDoesNotCallIgnoranceGoodNews:
    def test_a_baseline_it_could_not_solve_is_reported_as_NO_PLAN(self):
        # This is the one that mattered: an empty plan used to render as
        # "Nothing left to unlock by buying: the queue is fully fed", which is a
        # flatly false statement produced by a timeout.
        #
        # WHICH kind of failure has to be stated. This test originally set
        # baseline_failed alone and asserted the timeout wording, which was an
        # assumption rather than a construction. The sweep split the two, so both
        # are built explicitly here.
        timed_out = GrindPlan(
            baseline={}, steps=[], supply_limited=[], blocks=[],
            baseline_failed=True, baseline_timed_out=True,
        )
        assert "NO PLAN" in timed_out.summary()
        assert "fully fed" not in timed_out.summary()
        assert "not the same as there being nothing to buy" in timed_out.summary()

        infeasible = GrindPlan(
            baseline={}, steps=[], supply_limited=[], blocks=[],
            baseline_failed=True, baseline_timed_out=False,
        )
        assert "NO PLAN" in infeasible.summary()
        assert "fully fed" not in infeasible.summary()
        assert "not for want of time" in infeasible.summary()

    def test_a_step_search_that_stopped_early_says_UNKNOWN_rather_than_nothing(self):
        plan = GrindPlan(
            baseline={"a": 1}, steps=[], supply_limited=[], blocks=[],
            steps_truncated=True, steps_probed=1, steps_requested=3,
        )
        summary = plan.summary()
        assert "UNKNOWN beyond that, not nothing" in summary
        assert "fully fed" not in summary

    def test_a_healthy_plan_still_says_fully_fed_when_it_really_is(self):
        pool = cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m") + cards(83, 80, 1200, "l")
        plan = plan_grind(pool, [PlannerChallenge("a", 1, M85, 1)])
        assert "NO PLAN" not in plan.summary()

    def test_it_counts_the_steps_it_meant_to_probe(self):
        # Thin enough that the club cannot feed all six, so there are steps to
        # probe. With a club that already feeds everything there are none, and
        # zero is then the right answer rather than a missing one.
        pool = cards(86, 8, 4000, "h") + cards(85, 8, 2600, "m") + cards(83, 12, 1200, "l")
        plan = plan_grind(pool, [PlannerChallenge("a", 6, M85, 1)], max_extra_steps=3)
        assert plan.steps_requested == 3
        assert plan.steps_probed == len(plan.steps)

    def test_a_queue_it_can_already_feed_has_no_steps_to_probe(self):
        pool = cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m") + cards(83, 80, 1200, "l")
        plan = plan_grind(pool, [PlannerChallenge("a", 1, M85, 1)], max_extra_steps=3)
        assert plan.steps_requested == 0
        assert not plan.steps_truncated


class TestAnEmptyQueueResultSaysWHICHKindOfEmpty:
    def test_a_club_that_cannot_feed_anything_still_reports_PER_ITEM(self):
        # Six cards, eleven slots. The model is not infeasible: `built[j]` can be
        # zero, which is exactly the gate that lets a queue come back partially
        # solved. So this does NOT take the whole queue failure path, and it must
        # not: each item carries its own diagnosis instead of one bare zero.
        outcome = solve_queue(cards(84, 6, 1000, "a"), [
            QueueItem(name="a", formation_slots=FORMATION),
        ])
        assert outcome.squads_built == 0
        assert outcome.failure is None
        assert outcome.items[0].diagnosis is not None
        assert "0 of 1" in outcome.describe()

    def test_a_queue_that_ran_out_of_time_says_that_instead(self):
        pool = cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m") + cards(83, 80, 1200, "l")
        outcome = solve_queue(
            pool,
            [QueueItem(name="a", formation_slots=FORMATION, multisets=M85,
                       kind="repeat", count=10)],
            time_budget_seconds=0.001,
            include_plan=False,
        )
        if outcome.squads_built == 0:
            assert outcome.failure is not None
            assert "NOT the same as nothing being possible" in outcome.failure
        else:
            pytest.skip("the solver was fast enough to find something even at 1ms")

    def test_a_queue_that_built_something_carries_no_failure_line(self):
        pool = cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m") + cards(83, 80, 1200, "l")
        outcome = solve_queue(pool, [
            QueueItem(name="a", formation_slots=FORMATION, multisets=M85),
        ])
        assert outcome.squads_built == 1
        assert outcome.failure is None


class TestRunningOutOfTimeIsNotRunningOutOfSquads:
    """`exhausted` used to be set by a timeout as well as by a proof, so "the pool
    has no further squad" was printed when nobody had checked."""

    def request(self, pool, **kw):
        from fc_ai_solver import SolveRequest

        return SolveRequest(pool=pool, formation_slots=FORMATION, **kw)

    def test_a_pool_with_exactly_one_squad_in_it_is_EXHAUSTED(self):
        from fc_ai_solver import solve_alternatives

        exact = cards(86, 4, 4000, "h") + cards(85, 1, 2600, "m") + cards(83, 6, 1200, "l")
        result = solve_alternatives(
            self.request(exact, rating_counts={86: 4, 85: 1, 83: 6}), count=5
        )
        assert len(result.alternatives) == 1
        assert result.exhausted
        assert not result.timed_out
        assert "no further squad" in result.describe()

    def test_a_search_that_ran_out_of_time_says_UNKNOWN_rather_than_none_exist(self):
        from fc_ai_solver import solve_alternatives

        deep = cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m") + cards(83, 80, 1200, "l")
        result = solve_alternatives(
            self.request(deep, rating_counts={86: 4, 85: 1, 83: 6}, time_budget_seconds=0.0001),
            count=5,
        )
        if len(result.alternatives) == result.requested:
            pytest.skip("the solver was fast enough to find all five even at 0.1ms")
        assert result.timed_out
        assert not result.exhausted
        assert "RAN OUT OF TIME" in result.describe()
        assert "no further squad" not in result.describe()
