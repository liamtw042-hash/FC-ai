"""One copy of a player per squad. PENDING P-009, rule fact squad:one_copy_per_player.

UNVERIFIED. These tests prove the constraint does what it was told, which is not
the same as proving the game agrees. If P-009 comes back saying a repeat IS
allowed, every one of these expectations flips, and that is the point of it being
a reading rather than an assumption.

BOTH HALVES OF THE RULE COME FROM THE CALLER. This service does not decide what
makes two cards the same thing and does not know the limit is one, so every test
here supplies both.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import (
    PoolCard,
    QueueItem,
    SolveRequest,
    UnsupportedRequirement,
    solve_queue,
    solve_repeat,
    solve_single,
    solve_variable_count,
)

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = sorted(set(FORMATION))


def card(index: int, quantity: int = 1, key: str | None = None, rating: int = 84) -> PoolCard:
    return PoolCard(
        id=f"c{index}", rating=rating, positions=ANY_POSITION, nation="N", league="L",
        club="C", card_type="rare", quantity=quantity, cost=100, market_price=100,
        player_key=key,
    )


def eleven(quantity: int = 1) -> list[PoolCard]:
    return [card(i, quantity, f"p{i}") for i in range(11)]


class TestWithinOneSquad:
    def test_a_single_stack_can_no_longer_fill_a_whole_squad(self):
        # This is the bug as reported, in its extreme form: one stack of eleven
        # duplicates used to come back as a complete squad.
        outcome = solve_repeat([card(0, 11, "p0")], FORMATION, requested=1,
                               max_copies_per_squad=1)
        assert outcome.achieved == 0

    def test_eleven_distinct_players_still_build(self):
        outcome = solve_repeat(eleven(), FORMATION, requested=1, max_copies_per_squad=1)
        assert outcome.achieved == 1
        assert len({p.card_id for p in outcome.squads[0]}) == 11

    def test_two_ROWS_sharing_a_key_count_as_one_player(self):
        # A base gold and a special card of the same footballer are two stacks with
        # two ids. Keying on the id alone would let both into one squad.
        pool = [
            PoolCard(id="nif", rating=84, positions=ANY_POSITION, nation="N", league="L",
                     club="C", card_type="rare", quantity=1, cost=100, market_price=100,
                     player_key="same-person"),
            PoolCard(id="totw", rating=86, positions=ANY_POSITION, nation="N", league="L",
                     club="C", card_type="totw", quantity=1, cost=100, market_price=100,
                     player_key="same-person"),
        ] + [card(i, 1, f"p{i}") for i in range(10)]
        outcome = solve_repeat(pool, FORMATION, requested=1, max_copies_per_squad=1)
        assert outcome.achieved == 1
        used = {p.card_id for p in outcome.squads[0]}
        assert not {"nif", "totw"} <= used

    def test_a_limit_above_one_is_honoured_rather_than_hardcoded(self):
        # The service knows the NUMBER it was given, not that the number is one.
        pool = [card(0, 6, "p0"), card(1, 6, "p1")] + [card(i, 1, f"p{i}") for i in range(2, 4)]
        outcome = solve_repeat(pool, FORMATION, requested=1, max_copies_per_squad=6)
        assert outcome.achieved == 1


class TestAcrossSquadsIsUntouched:
    """Deliberately still allowed. A stack of four 84s feeding four squads is the
    normal way a repeatable SBC is fed, and it is the whole point of a stack."""

    def test_one_stack_per_player_feeds_several_squads(self):
        outcome = solve_repeat(eleven(quantity=3), FORMATION, requested=3,
                               max_copies_per_squad=1)
        assert outcome.achieved == 3
        for squad in outcome.squads:
            assert len({p.card_id for p in squad}) == 11

    def test_and_the_across_run_quantity_cap_still_holds(self):
        outcome = solve_repeat(eleven(quantity=2), FORMATION, requested=3,
                               max_copies_per_squad=1)
        assert outcome.achieved == 2


class TestEveryEntryPointApplaysIt:
    """A squad rule that only some entry points apply is worse than one nobody
    applies: it makes the answer depend on which function was called."""

    def test_solve_single(self):
        response = solve_single(SolveRequest(
            pool=[card(0, 11, "p0")], formation_slots=FORMATION, max_copies_per_squad=1,
        ))
        assert response.status == "infeasible"

    def test_solve_repeat(self):
        assert solve_repeat([card(0, 11, "p0")], FORMATION, requested=1,
                            max_copies_per_squad=1).achieved == 0

    def test_solve_queue(self):
        outcome = solve_queue([card(0, 11, "p0")], [
            QueueItem(name="a", formation_slots=FORMATION),
        ], max_copies_per_squad=1, include_plan=False)
        assert outcome.squads_built == 0

    def test_solve_variable_count_which_builds_its_own_model(self):
        # This one does not call add_challenge at all, so it was the entry point
        # most likely to be missed.
        result = solve_variable_count([card(0, 11, "p0")], FORMATION,
                                      max_squads=1, min_squads=1, max_copies_per_squad=1)
        assert result.squads_built == 0


class TestItRefusesToGuess:
    def test_keys_without_a_limit_raise_rather_than_allowing_a_repeat(self):
        with pytest.raises(UnsupportedRequirement, match="max_copies_per_squad"):
            solve_repeat(eleven(), FORMATION, requested=1)

    def test_a_limit_below_one_is_refused(self):
        with pytest.raises(UnsupportedRequirement, match="at least 1"):
            solve_repeat(eleven(), FORMATION, requested=1, max_copies_per_squad=0)

    def test_a_pool_with_no_keys_and_no_limit_is_left_alone(self):
        # Backwards compatible on purpose: the solver's own unit tests build pools
        # without player identity because they are testing other machinery.
        outcome = solve_repeat([card(0, 11)], FORMATION, requested=1)
        assert outcome.achieved == 1


class TestTheDiagnosisAgreesWithTheSolve:
    def test_a_diagnosis_probe_uses_the_same_rule_as_the_solve(self):
        # A probe run without the limit would report a squad as buildable that the
        # real solve refuses, which is the worst kind of wrong answer.
        outcome = solve_repeat([card(0, 11, "p0")], FORMATION, requested=1,
                               max_copies_per_squad=1)
        assert outcome.achieved == 0
        assert outcome.diagnosis is not None
        assert "buildable" not in outcome.diagnosis.explanation.lower()
