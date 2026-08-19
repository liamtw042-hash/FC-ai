"""The mixed size queue.

The cost offset that keeps the objective non negative is order neutral only while
every squad is the same size. A queue mixing an eleven card SBC with an eight card
one would shift them by 11 * offset and 8 * offset, favouring the smaller by
3 * offset for reasons unrelated to cost.

Subtracting each squad's own shift does not rescue it: that recovers the raw
weighted cost, which is the negative quantity the offset removed, so an extra
squad becomes a gain again. No additive correction fixes both ends, so the queue
is refused.
"""

from __future__ import annotations

import pytest

from fc_ai_solver import (
    SQUAD_SIZE,
    MixedSquadSizeError,
    PoolCard,
    UnsupportedSquadSizeError,
    require_squad_size,
    require_uniform_squad_sizes,
    solve_variable_count,
)
from fc_ai_solver.costs import OFFSET_DEMO_NOTE  # noqa: F401  (documentation anchor)

ELEVEN = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
# Invented, because no real FC 26 SBC has one. The point is that if one appeared,
# the solver refuses rather than quietly mispricing it.
EIGHT = ["GK", "CB", "CB", "RB", "CM", "CM", "ST", "ST"]


class TestASingleChallenge:
    def test_eleven_is_accepted(self):
        require_squad_size(ELEVEN)

    def test_anything_else_is_refused_loudly(self):
        with pytest.raises(UnsupportedSquadSizeError, match="8 slots"):
            require_squad_size(EIGHT, label="the invented 8 card challenge")

    def test_the_message_says_why_rather_than_just_no(self):
        with pytest.raises(UnsupportedSquadSizeError, match="only order neutral at a fixed size"):
            require_squad_size(EIGHT)


class TestAMixedSizeQueue:
    def test_a_uniform_queue_passes(self):
        require_uniform_squad_sizes({"marquee matchup": ELEVEN, "league sbc": ELEVEN})

    def test_a_mixed_queue_is_refused_and_names_the_offender(self):
        with pytest.raises(MixedSquadSizeError) as error:
            require_uniform_squad_sizes(
                {
                    "83 rated squad": ELEVEN,
                    "invented 8 card challenge": EIGHT,
                    "another 11": ELEVEN,
                }
            )
        message = str(error.value)
        assert "invented 8 card challenge has 8" in message
        assert "83 rated squad" not in message, "only the offenders are named"
        assert "bias the objective toward the smaller squad" in message

    def test_several_offenders_are_all_named(self):
        with pytest.raises(MixedSquadSizeError) as error:
            require_uniform_squad_sizes({"a": EIGHT, "b": ELEVEN, "c": ELEVEN[:9]})
        message = str(error.value)
        assert "a has 8" in message
        assert "c has 9" in message


class TestTheBiasIsReal:
    def test_the_shift_differs_by_exactly_the_size_difference_times_the_offset(self):
        # Not a behaviour test, a demonstration of the quantity being refused.
        offset = 150  # the default from costModel.ts
        assert SQUAD_SIZE * offset - len(EIGHT) * offset == 3 * offset == 450

    def test_repeat_mode_refuses_a_non_eleven_formation_before_solving(self):
        pool = [
            PoolCard(id=f"c{i}", rating=84, positions=list(set(EIGHT)), nation=f"N{i}",
                     league=f"L{i}", club=f"C{i}", card_type="rare", quantity=1, cost=100)
            for i in range(16)
        ]
        with pytest.raises(UnsupportedSquadSizeError):
            solve_variable_count(pool, EIGHT, max_squads=2, min_squads=1)
