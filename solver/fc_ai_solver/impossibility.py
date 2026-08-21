"""Impossibility diagnosis with binding constraint identification. Checkpoint 12.

ONE PATH, NOT A FOURTH ONE. Everything here is the requirement, pair, minimal set,
supply and depth machinery that repeat mode, set mode, queue mode and the grind
planner already share. This module is the front door to it for a challenge that
will not solve at all, and it adds exactly two things that only make sense here:

  - the UNIVERSAL conflicts, which are a fact about the SBC rather than about a
    club, carried in as data from the TypeScript `detectConflicts` and reported
    first so nobody goes shopping for a squad nobody could build
  - a `describe()` that leads with the kind of cause, because "which of these is
    it" is the reader's first question and the one a wall of text buries

The rule the whole file turns on: THE PYTHON SERVICE KNOWS NO GAME RULES. It does
not decide that "exactly 1 distinct league with min 5 distinct nations" is
contradictory. That judgement is made by the rules engine and arrives here as a
sentence.
"""

from __future__ import annotations

from .repeat_solve import (
    ClubLimit,
    ShortfallDiagnosis,
    _diagnose,
    _Search,
)
from .schema import ChemistryConfig, PoolCard, Requirement
from .squad_size import require_squad_size

# Ordered worst first: a challenge nobody can build is not worth diagnosing
# against a club, and a club that is out of cards is not a requirement problem.
KINDS = (
    "solvable",
    "universal",
    "requirement",
    "requirement_pair",
    "requirement_set",
    "supply",
    "contention",
    "unexplained",
)


class Impossibility:
    """Why this challenge cannot be built, and what would change that."""

    def __init__(
        self,
        kind: str,
        count: int,
        universal: list[str],
        diagnosis: ShortfallDiagnosis | None,
        achievable: int | None = None,
    ) -> None:
        self.kind = kind
        self.count = count
        # Impossible for everyone, from the rules engine. Never derived here.
        self.universal = universal
        self.diagnosis = diagnosis
        # How many of the requested count the club CAN build, when that was asked.
        self.achievable = achievable

    @property
    def solvable(self) -> bool:
        return self.kind == "solvable"

    @property
    def is_universal(self) -> bool:
        return self.kind == "universal"

    @property
    def limits(self) -> list[ClubLimit]:
        return self.diagnosis.limits if self.diagnosis else []

    @property
    def binding(self) -> list[str]:
        """The binding constraints, named. Empty when nothing was named."""
        return self.diagnosis.blocking if self.diagnosis else []

    def describe(self) -> str:
        if self.solvable:
            return f"Solvable: {self.count} squad(s) can be built from this club"
        if self.is_universal:
            reasons = "; ".join(self.universal)
            return (
                f"IMPOSSIBLE FOR EVERYONE, not just your club. The requirements "
                f"contradict each other: {reasons}. No club can build this, so there "
                f"is nothing to buy and nothing to check in your club"
            )
        assert self.diagnosis is not None
        head = {
            "requirement": "ONE REQUIREMENT",
            "requirement_pair": "TWO REQUIREMENTS TOGETHER",
            "requirement_set": "A SET OF REQUIREMENTS TOGETHER",
            "supply": "YOUR CLUB IS SHORT OF CARDS",
            "contention": "CONTENTION WITH THE REST OF THE QUEUE",
            "unexplained": "NOT NAMED",
        }.get(self.diagnosis.mode, self.diagnosis.mode.upper())
        built = (
            f" Built {self.achievable} of {self.count}."
            if self.achievable is not None and self.count > 1
            else ""
        )
        return f"{head}.{built} Squad {(self.achievable or 0) + 1} is blocked by {self.diagnosis.explanation}"


def diagnose_impossibility(
    pool: list[PoolCard],
    formation_slots: list[str],
    *,
    requirements: list[Requirement] | None = None,
    chemistry: ChemistryConfig | None = None,
    multisets: list[dict[int, int]] | None = None,
    count: int = 1,
    max_copies_per_squad: int | None = None,
    universal_conflicts: list[str] | None = None,
    achievable: int | None = None,
    time_budget_seconds: float = 10.0,
    workers: int = 8,
) -> Impossibility:
    """Why `count` squads cannot be built from this club, and what binds.

    `universal_conflicts` is the output of the rules engine's `detectConflicts`,
    passed through rather than recomputed. When it is non empty the club is never
    consulted: a contradiction between requirements is true for everyone, and
    telling someone their club is short of Serie A cards when the SBC is
    unsatisfiable in principle sends them shopping for nothing.

    `achievable` short circuits the "how many CAN be built" search when the caller
    already knows, which repeat and queue mode both do.
    """
    require_squad_size(formation_slots, label="this challenge")
    universal = list(universal_conflicts or [])
    if universal:
        return Impossibility("universal", count, universal, None)

    requirements = list(requirements or [])
    search = _Search(
        pool, formation_slots, chemistry, multisets, time_budget_seconds, workers,
        max_copies_per_squad=max_copies_per_squad,
    )

    if achievable is None:
        if search.feasible(count, requirements, time_budget_seconds):
            return Impossibility("solvable", count, [], None, achievable=count)
        # How far does it get? Needed so the diagnosis runs at the squad that
        # actually fails rather than at the one that was asked for.
        achievable = 0
        for reachable in range(1, count):
            if not search.feasible(reachable, requirements, time_budget_seconds):
                break
            achievable = reachable
    elif achievable >= count:
        return Impossibility("solvable", count, [], None, achievable=achievable)

    diagnosis = _diagnose(search, achievable + 1, requirements, time_budget_seconds)
    return Impossibility(diagnosis.mode, count, [], diagnosis, achievable=achievable)
