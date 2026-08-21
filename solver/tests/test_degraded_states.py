"""THE AUDIT METHOD, AS A TEST FILE.

Twice now an output path was cleared by reading what it prints, and twice the code
said something different. Reading the code is not enough either: what settles it
is FORCING the degraded state and asserting the string that comes out.

So this file is the method. Every claim-bearing output string in the solver has an
entry here, and each entry constructs the timeout, the infeasibility or the empty
case for real rather than reasoning about it.

The rule for adding to it: **if a function returns a sentence a person will act
on, it belongs here, with its degraded state forced.**
"""

from __future__ import annotations

from fc_ai_solver import (
    ClubLimit,
    PlannerChallenge,
    PoolCard,
    QueueItem,
    Requirement,
    SolveRequest,
    diagnose_impossibility,
    plan_grind,
    solve_alternatives,
    solve_queue,
    solve_repeat,
    solve_single,
)
from fc_ai_solver.grind_planner import GrindPlan, RequirementBlock
from fc_ai_solver.queue_solve import QueueOutcome
from fc_ai_solver.repeat_solve import ShortfallDiagnosis, SupplyShortfall, _Search, _diagnose

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = sorted(set(FORMATION))
M85 = [{86: 4, 85: 1, 83: 6}, {86: 3, 85: 4, 82: 4}]

# Small enough that a microsecond budget cannot finish it, big enough that the
# model is real rather than a stub.
TINY_BUDGET = 1e-6


def cards(rating: int, count: int, cost: int, prefix: str, **kw) -> list[PoolCard]:
    league = kw.pop("league", None)
    card_type = kw.pop("card_type", "rare")
    return [
        PoolCard(id=f"{prefix}{i}", rating=rating, positions=ANY_POSITION,
                 nation=f"N{prefix}{i}",
                 league=league or f"L{prefix}{i}",
                 club=f"C{prefix}{i}",
                 card_type=card_type, quantity=1, cost=cost,
                 market_price=cost, **kw)
        for i in range(count)
    ]


def deep() -> list[PoolCard]:
    return (
        cards(86, 40, 4000, "h") + cards(85, 40, 2600, "m")
        + cards(83, 80, 1200, "l") + cards(82, 80, 900, "x")
    )


def thin() -> list[PoolCard]:
    """Six cards, eleven slots. Every model over it is provably infeasible."""
    return cards(84, 6, 1000, "a")


class TestTheGrindPlannerSummary:
    """Four sentences, four forced states. The first of these was the worst defect
    the second audit found: an empty plan printing "the queue is fully fed"."""

    def test_a_baseline_that_TIMED_OUT_says_so_and_not_fully_fed(self):
        plan = plan_grind(
            deep(),
            [PlannerChallenge("a", 10, M85, 1)],
            time_budget_seconds=TINY_BUDGET,
        )
        assert plan.baseline_failed, "the state was not actually forced"
        assert plan.baseline_timed_out
        summary = plan.summary()
        assert "NO PLAN" in summary
        assert "time budget" in summary
        assert "fully fed" not in summary

    def test_a_baseline_that_is_INFEASIBLE_says_raising_the_budget_will_not_help(self):
        # Constructed rather than provoked: the baseline model leaves `built` free,
        # so it is feasible with zero squads for any pool. The wording still has to
        # exist and still has to be different, because the flag can be set.
        plan = GrindPlan(
            baseline={}, steps=[], supply_limited=[], blocks=[],
            baseline_failed=True, baseline_timed_out=False,
        )
        summary = plan.summary()
        assert "not for want of time" in summary
        assert "INFEASIBLE" in summary
        assert "raising the budget will not change it" in summary
        assert "time budget" not in summary.replace("not for want of time", "")

    def test_a_healthy_plan_that_really_is_fully_fed_still_says_so(self):
        plan = plan_grind(deep(), [PlannerChallenge("a", 1, M85, 1)])
        assert not plan.baseline_failed
        assert "NO PLAN" not in plan.summary()

    def test_a_truncated_step_search_says_UNKNOWN_beyond_that(self):
        plan = GrindPlan(
            baseline={"a": 1}, steps=[], supply_limited=[], blocks=[],
            steps_truncated=True, steps_probed=1, steps_requested=3,
        )
        assert "UNKNOWN beyond that, not nothing" in plan.summary()
        assert "fully fed" not in plan.summary()


class TestTheDiagnosisExplanation:
    def test_a_diagnosis_whose_probes_TIMED_OUT_stamps_the_explanation(self):
        search = _Search(deep(), FORMATION, None, M85, TINY_BUDGET, 1)
        diagnosis = _diagnose(
            search, 10, [Requirement(type="totwCount", op="min", value=1)], TINY_BUDGET
        )
        assert search.unknown > 0, "the state was not actually forced"
        assert diagnosis.probes_timed_out > 0
        assert not diagnosis.complete
        assert "NOT A COMPLETE ANSWER" in diagnosis.explanation

    def test_a_diagnosis_whose_probes_all_FINISHED_carries_no_caveat(self):
        search = _Search(thin(), FORMATION, None, None, 10.0, 8)
        diagnosis = _diagnose(search, 1, [], 10.0)
        assert search.unknown == 0
        assert diagnosis.complete
        assert "NOT A COMPLETE ANSWER" not in diagnosis.explanation

    def test_a_minimal_conflicting_set_does_not_claim_to_be_the_only_one(self):
        leagues = ["A", "B", "C", "D", "E"]
        pool = [
            card
            for index, league in enumerate(leagues)
            for card in cards(84, 4, 1000, f"g{index}", league=league)
        ]
        report = diagnose_impossibility(
            pool, FORMATION,
            requirements=[
                Requirement(type="playersFromLeague", league=league, op="min", value=4)
                for league in leagues
            ],
        )
        assert report.kind == "requirement_set", report.describe()
        assert "there may be others" in report.describe()


class TestTheQueueOutcome:
    def test_a_queue_that_TIMED_OUT_says_it_is_not_the_same_as_impossible(self):
        outcome = solve_queue(
            deep(),
            [QueueItem(name="a", formation_slots=FORMATION, multisets=M85,
                       kind="repeat", count=10)],
            time_budget_seconds=TINY_BUDGET,
            include_plan=False,
        )
        # NOT a skip. A skipped test looks like a passing one, which is the very
        # pattern this file exists to catch. No machine solves a 240 card ten
        # squad model in a microsecond, so if this ever stops being forced the
        # right response is to look, not to shrug.
        assert outcome.squads_built == 0, "the timeout was not forced"
        assert outcome.failure is not None
        assert "NOT the same as nothing being possible" in outcome.failure
        assert outcome.describe() == outcome.failure

    def test_a_PROVED_impossible_queue_says_it_was_proved(self):
        # Constructed: with `built` gated the real model is feasible at zero, so
        # this path is reached by status rather than by pool shape.
        outcome = QueueOutcome(
            [], 0, 0, 0, False, 0.1, None,
            failure=(
                "NOTHING BUILT, and the model PROVED it: no squad in this queue can be "
                "built from this club as it stands."
            ),
        )
        assert "PROVED" in outcome.describe()
        assert "ran out of time" not in outcome.describe()

    def test_a_short_item_says_the_DEEPER_squads_were_not_probed(self):
        # Eight cards of each rating: enough for two squads, not six.
        pool = cards(86, 8, 4000, "h") + cards(85, 8, 2600, "m") + cards(83, 12, 1200, "l")
        outcome = solve_queue(pool, [
            QueueItem(name="six", formation_slots=FORMATION, multisets=M85,
                      kind="repeat", count=6),
        ], include_plan=False)
        assert 0 < outcome.squads_built < 6, "the state was not actually forced"
        described = outcome.items[0].describe()
        assert "were NOT probed separately" in described
        assert "unknown rather than the same thing" in described

    def test_an_item_one_squad_short_does_NOT_get_the_deeper_caveat(self):
        # There are no deeper squads, so the caveat would be noise.
        pool = cards(86, 8, 4000, "h") + cards(85, 8, 2600, "m") + cards(83, 12, 1200, "l")
        outcome = solve_queue(pool, [
            QueueItem(name="three", formation_slots=FORMATION, multisets=M85,
                      kind="repeat", count=3),
        ], include_plan=False)
        assert outcome.items[0].achieved == 2, "this pool did not land one squad short"
        assert "were NOT probed separately" not in outcome.items[0].describe()


class TestTheAlternativesSummary:
    def test_a_search_that_TIMED_OUT_says_UNKNOWN_not_none_exist(self):
        request = SolveRequest(
            pool=deep(), formation_slots=FORMATION,
            rating_counts={86: 4, 85: 1, 83: 6}, time_budget_seconds=TINY_BUDGET,
        )
        result = solve_alternatives(request, count=5)
        assert len(result.alternatives) < result.requested, "the timeout was not forced"
        assert result.timed_out
        assert not result.exhausted
        assert "RAN OUT OF TIME" in result.describe()
        assert "no further squad" not in result.describe()

    def test_a_pool_that_is_genuinely_EXHAUSTED_says_that_instead(self):
        exact = cards(86, 4, 4000, "h") + cards(85, 1, 2600, "m") + cards(83, 6, 1200, "l")
        result = solve_alternatives(
            SolveRequest(pool=exact, formation_slots=FORMATION,
                         rating_counts={86: 4, 85: 1, 83: 6}),
            count=5,
        )
        assert result.exhausted and not result.timed_out
        assert "no further squad" in result.describe()
        assert "RAN OUT OF TIME" not in result.describe()


class TestTheSingleSolveReason:
    def test_a_solve_that_TIMED_OUT_does_not_say_no_squad_satisfies_it(self):
        response = solve_single(SolveRequest(
            pool=deep(), formation_slots=FORMATION,
            rating_counts={86: 4, 85: 1, 83: 6},
            time_budget_seconds=TINY_BUDGET,
        ))
        assert response.status == "unknown", "the timeout was not forced"
        assert response.reason is not None
        assert "time budget ran out" in response.reason
        assert "no squad in the available pool satisfies" not in response.reason

    def test_a_solve_that_is_INFEASIBLE_carries_the_diagnosis(self):
        response = solve_single(SolveRequest(pool=thin(), formation_slots=FORMATION))
        assert response.status == "infeasible"
        assert response.reason is not None
        assert response.reason != "no squad in the available pool satisfies these requirements"

    def test_the_diagnosis_can_be_turned_off_and_the_old_sentence_returns(self):
        response = solve_single(SolveRequest(
            pool=thin(), formation_slots=FORMATION, diagnose_on_failure=False,
        ))
        assert response.reason == "no squad in the available pool satisfies these requirements"


class TestTheRepeatSummary:
    def test_a_short_repeat_says_the_deeper_squads_were_not_probed(self):
        from fc_ai_solver.api_models import repeat_out

        pool = cards(86, 8, 4000, "h") + cards(85, 8, 2600, "m") + cards(83, 12, 1200, "l")
        outcome = solve_repeat(pool, FORMATION, requested=6, allowed_rating_multisets=M85)
        assert 0 < outcome.achieved < 6, "the state was not actually forced"
        summary = repeat_out(outcome, pool).summary
        assert "were NOT probed separately" in summary

    def test_a_complete_repeat_carries_no_blocked_line_at_all(self):
        from fc_ai_solver.api_models import repeat_out

        outcome = solve_repeat(deep(), FORMATION, requested=2, allowed_rating_multisets=M85)
        assert outcome.achieved == 2
        summary = repeat_out(outcome, deep()).summary
        assert "blocked by" not in summary
        assert "NOT probed" not in summary


class TestTheSmallerStringsThatStillMakeClaims:
    """A sentence does not have to be long to be acted on."""

    def test_an_unpriced_shortfall_quotes_NO_coin_figure(self):
        shortfall = SupplyShortfall(rating=91, needed=4, held=0, unit_cost=None, basis="unknown")
        assert shortfall.cost_to_close is None
        assert not shortfall.is_priced
        assert "91" in shortfall.describe(1)

    def test_a_club_limit_that_cannot_be_reached_quotes_no_number(self):
        limit = ClubLimit(
            Requirement(type="rareCount", op="min", value=9), "rareCount min 9", 9, None, False,
        )
        described = limit.describe()
        assert "part of the answer rather than all of it" in described
        assert "9" in described
        assert "at best" not in described

    def test_a_requirement_with_no_numeric_value_says_there_is_no_gap(self):
        limit = ClubLimit(
            Requirement(type="excludeEvolved"), "excludeEvolved", None, None, False,
        )
        assert "no gap to quote" in limit.describe()

    def test_a_requirement_block_that_was_capped_says_UNKNOWN_rather_than_nothing(self):
        block = RequirementBlock(
            name="a", achieved=2, supply_ceiling=9,
            depths=[], conditional_supply=[], probed_to=4, requested=9,
        )
        assert block.probing_was_capped
        assert "no formation or requirements were supplied" in block.describe()

    def test_an_unexplained_diagnosis_admits_it_rather_than_naming_something(self):
        diagnosis = ShortfallDiagnosis(
            mode="unexplained", blocking=[], contributions=[],
            explanation="the pool, though it holds enough cards at every rating.",
        )
        assert diagnosis.blocking == []
        assert diagnosis.mode == "unexplained"


class TestChemistryThatWasNotComputed:
    """`chemistry` defaulted to 0 and repeat and queue mode never set it, so "not
    computed" and "computed as zero" were the same value. The TypeScript guard
    that exists to catch a drift between the two engines then reported one on
    every squad that had any chemistry at all."""

    def chem_config(self):
        from fc_ai_solver import ChemistryConfig, ChemistryContribution

        return ChemistryConfig(
            club_thresholds=[(2, 1), (4, 2), (7, 3)],
            nation_thresholds=[(2, 1), (5, 2), (8, 3)],
            league_thresholds=[(3, 1), (5, 2), (8, 3)],
            contributions={"rare": ChemistryContribution(club=1, league=1, nation=1)},
            max_player_chemistry=3,
            max_squad_chemistry=33,
        )

    def linked(self) -> list[PoolCard]:
        """Two clubmates who can play their slots, nine strangers who cannot.

        This is the shape that produced the false positive: the two in position
        clubmates are worth 1 each, and every other player is gated to 0.
        """
        pool = [
            PoolCard(id="mate1", rating=84, positions=["CM"], nation="Na", league="Liga",
                     club="Estrela", card_type="rare", quantity=1, cost=100,
                     market_price=100, player_key="mate1"),
            PoolCard(id="mate2", rating=84, positions=["ST"], nation="Nb", league="Liga",
                     club="Estrela", card_type="rare", quantity=1, cost=100,
                     market_price=100, player_key="mate2"),
        ]
        for i in range(9):
            pool.append(
                PoolCard(id=f"s{i}", rating=84, positions=["GK"], nation=f"N{i}",
                         league=f"L{i}", club=f"C{i}", card_type="rare", quantity=1,
                         cost=100, market_price=100, player_key=f"s{i}")
            )
        return pool

    # A chemistry requirement, because nothing else makes the solver place the two
    # clubmates in position: every card costs the same, so a squad worth 0 is an
    # equally good answer and the first version of this test passed by luck.
    NEEDS_TWO = [Requirement(type="teamChemistry", op="min", value=2)]

    def test_repeat_mode_REPORTS_chemistry_rather_than_leaving_it_at_zero(self):
        outcome = solve_repeat(
            self.linked(), FORMATION, requested=1, chemistry=self.chem_config(),
            requirements=list(self.NEEDS_TWO), max_copies_per_squad=1,
        )
        assert outcome.achieved == 1, "the squad was not built, so nothing was forced"
        reported = [p.chemistry for p in outcome.squads[0]]
        assert None not in reported, "chemistry was left unreported"
        assert sum(reported) == 2

    def test_and_reports_None_when_no_chemistry_model_was_built(self):
        # No chemistry config, so there is nothing to report and it says so rather
        # than saying zero.
        outcome = solve_repeat(
            self.linked(), FORMATION, requested=1, max_copies_per_squad=1,
        )
        assert outcome.achieved == 1
        assert all(p.chemistry is None for p in outcome.squads[0])

    def test_queue_mode_does_the_same(self):
        outcome = solve_queue(
            self.linked(),
            [QueueItem(name="a", formation_slots=FORMATION, chemistry=self.chem_config(),
                       requirements=list(self.NEEDS_TWO))],
            max_copies_per_squad=1, include_plan=False,
        )
        assert outcome.squads_built == 1
        reported = [p.chemistry for p in outcome.items[0].squads[0]]
        assert None not in reported
        assert sum(reported) == 2

    def test_single_solve_agrees_on_the_same_squad(self):
        # The two engines have to make it 2, or the guard was right and this is a
        # real drift rather than a reporting gap.
        response = solve_single(SolveRequest(
            pool=self.linked(), formation_slots=FORMATION, chemistry=self.chem_config(),
            requirements=list(self.NEEDS_TWO), max_copies_per_squad=1,
        ))
        assert response.status in ("optimal", "feasible")
        assert response.squad_chemistry == 2
