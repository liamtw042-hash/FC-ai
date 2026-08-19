"""Squad size is eleven, everywhere, and the objective depends on it.

WHY THIS IS ITS OWN MODULE RATHER THAN AN INLINE CHECK.

The cost model shifts every card by a constant offset so the solver objective can
never go negative. That shift is order neutral because a squad of eleven moves by
exactly 11 * offset, the same amount for every candidate squad, so nothing is
reordered.

The moment a queue mixes squad sizes that stops being true. An eight card squad
moves by 8 * offset and an eleven card squad by 11 * offset, so the smaller squad
is quietly favoured by 3 * offset for a reason that has nothing to do with cost.

SUBTRACTING THE PER SQUAD SHIFT DOES NOT FIX IT. Taking m_j * offset back off each
squad recovers the raw weighted cost exactly, which is the negative quantity the
offset existed to remove, so an extra squad becomes a gain again. The two problems
are the same problem seen from opposite ends and no additive correction solves
both.

So the answer is to refuse. Every SBC in FC 26 is an eleven card squad, so this
costs nothing today, and a loud failure is the correct response to a case the
objective genuinely cannot price. If EA ever ships a challenge with a different
size, the fix is a lexicographic objective where real cost dominates and the
preference weighting becomes a bounded tie break, which is size independent. That
is a real change to how solutions are ranked, and it is not going to happen by
accident inside a queue solve.
"""

from __future__ import annotations

SQUAD_SIZE = 11


class MixedSquadSizeError(ValueError):
    """A queue contained squads of different sizes, which the objective cannot price."""


class UnsupportedSquadSizeError(ValueError):
    """A squad that is not eleven cards."""


def require_squad_size(slots: list[str], *, label: str = "squad") -> None:
    if len(slots) != SQUAD_SIZE:
        raise UnsupportedSquadSizeError(
            f"{label} has {len(slots)} slots. This solver builds {SQUAD_SIZE} card squads, "
            f"and the cost offset that keeps the objective non negative is only order "
            f"neutral at a fixed size. See squad_size.py."
        )


def require_uniform_squad_sizes(challenges: dict[str, list[str]]) -> None:
    """Every challenge in a queue must field the same eleven card squad.

    Takes a mapping so the error can name the offender rather than an index.
    """
    offenders = {name: len(slots) for name, slots in challenges.items() if len(slots) != SQUAD_SIZE}
    if not offenders:
        return
    detail = ", ".join(f"{name} has {size}" for name, size in sorted(offenders.items()))
    raise MixedSquadSizeError(
        f"every challenge in a queue must be a {SQUAD_SIZE} card squad, but {detail}. "
        f"Solving a mixed size queue would bias the objective toward the smaller squad "
        f"by the difference in their cost offsets, for reasons unrelated to cost. "
        f"See squad_size.py."
    )
