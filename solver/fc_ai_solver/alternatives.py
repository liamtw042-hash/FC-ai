"""Top N solutions for one challenge, each genuinely different. Brief 6.4.

Five near identical squads are one answer printed five times. Each solution must
differ from every earlier one by at least K cards, which is expressed directly:
for a previous solution S, the new squad may reuse at most 11 - K of it.

Pins hold across a re solve. That is the whole point of pinning: keep the cards
worth keeping and ask for something else around them. A pinned card does not count
against the difference requirement, since the caller asked for it to stay.
"""

from __future__ import annotations

from collections import Counter

from .schema import PlacedCard, SolveRequest, SolveResponse
from .single_solve import solve_single
from .squad_size import SQUAD_SIZE

DEFAULT_SOLUTIONS = 5
MAX_SOLUTIONS = 20
DEFAULT_MIN_DIFFERENCE = 3


class Alternative:
    def __init__(self, response: SolveResponse, index: int) -> None:
        self.response = response
        self.index = index

    @property
    def card_ids(self) -> list[str]:
        return [placement.card_id for placement in self.response.placements]

    def differs_from(self, other: "Alternative") -> int:
        """How many cards would have to change to turn this squad into that one."""
        mine = Counter(self.card_ids)
        theirs = Counter(other.card_ids)
        shared = sum((mine & theirs).values())
        return SQUAD_SIZE - shared

    def diff_against(self, other: "Alternative") -> tuple[list[str], list[str]]:
        """(dropped, added) relative to `other`. The compact diff for the UI."""
        mine = Counter(self.card_ids)
        theirs = Counter(other.card_ids)
        dropped = sorted((theirs - mine).elements())
        added = sorted((mine - theirs).elements())
        return dropped, added


class AlternativesResult:
    def __init__(
        self,
        alternatives: list[Alternative],
        requested: int,
        min_difference: int,
        exhausted: bool,
        timed_out: bool = False,
    ) -> None:
        self.alternatives = alternatives
        self.requested = requested
        self.min_difference = min_difference
        # True when the pool was PROVED to hold no further different squad.
        self.exhausted = exhausted
        # True when the search ran out of time instead. NOT the same fact: one
        # says there is no fifth squad, the other says we did not find one, and
        # they were the same flag until the second audit.
        self.timed_out = timed_out

    def describe(self) -> str:
        lines = []
        for alternative in self.alternatives:
            head = (
                f"  {alternative.index + 1}. {alternative.response.total_cost} cost, "
                f"chem {alternative.response.squad_chemistry}"
            )
            if alternative.index > 0:
                dropped, added = alternative.diff_against(self.alternatives[0])
                head += f"  vs #1: out {', '.join(dropped)} / in {', '.join(added)}"
            lines.append(head)
        if len(self.alternatives) < self.requested:
            if self.timed_out:
                lines.append(
                    f"  Only {len(self.alternatives)} of {self.requested} found, and the "
                    f"search RAN OUT OF TIME rather than running out of squads. Whether a "
                    f"further one differing by {self.min_difference} cards exists is "
                    f"UNKNOWN. Raise the time budget."
                )
            elif self.exhausted:
                lines.append(
                    f"  Only {len(self.alternatives)} of {self.requested} found: the pool has "
                    f"no further squad differing by {self.min_difference} cards. Fewer than "
                    f"asked for is not a failure, it is the honest count."
                )
        return "\n".join(lines)


def solve_alternatives(
    request: SolveRequest,
    *,
    count: int = DEFAULT_SOLUTIONS,
    min_difference: int = DEFAULT_MIN_DIFFERENCE,
) -> AlternativesResult:
    """Cheapest first, each differing from all earlier ones by min_difference cards."""
    if count < 1:
        raise ValueError("count must be at least 1")
    if count > MAX_SOLUTIONS:
        raise ValueError(f"count is capped at {MAX_SOLUTIONS}")
    if not 1 <= min_difference <= SQUAD_SIZE:
        raise ValueError(f"min_difference must be between 1 and {SQUAD_SIZE}")

    pinned = {pin.card_id for pin in request.pins}
    found: list[Alternative] = []
    forbidden: list[list[str]] = []

    for index in range(count):
        attempt = request.model_copy(
            update={"exclude_similar_to": list(forbidden), "min_difference": min_difference}
        )
        response = solve_single(attempt)
        if response.status == "unknown":
            # Out of time, not out of squads. Reported as ignorance.
            return AlternativesResult(
                found, count, min_difference, exhausted=False, timed_out=True,
            )
        if response.status != "optimal" and response.status != "feasible":
            return AlternativesResult(found, count, min_difference, exhausted=True)

        alternative = Alternative(response, index)
        found.append(alternative)
        # Pinned cards are excluded from the difference requirement: the caller
        # asked for them to stay, so counting them as sameness would make every
        # further solution impossible.
        forbidden.append([cid for cid in alternative.card_ids if cid not in pinned])

    return AlternativesResult(found, count, min_difference, exhausted=False)
