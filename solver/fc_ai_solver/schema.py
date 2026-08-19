"""Wire format between the TypeScript rules engine and the CP-SAT model.

DESIGN RULE, and it is the important one in this directory.

The Python service knows NO GAME RULES. It is a constraint compiler. Every rule
that could be wrong about EA FC lives in the TypeScript rules engine, which is
the only implementation under ground truth verification. Rating maths never
crosses this boundary at all: TypeScript enumerates the rating multisets and asks
this service to fill an exact one. Chemistry ladders and card contribution weights
arrive as DATA in the request rather than being written down again here.

Every squad this service returns is re-validated by the TypeScript engine before
it reaches the user, so if the two ever disagree the authoritative one wins and
the disagreement is visible rather than silent.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PoolCard(BaseModel):
    """One stack of owned cards. quantity copies are quantity submittable items."""

    id: str
    rating: int
    positions: list[str]
    nation: str
    league: str | None = None
    club: str | None = None
    card_type: str
    promo_name: str | None = None
    is_rare: bool = False
    is_totw: bool = False
    is_evolved: bool = False
    is_womens: bool = False
    quantity: int = Field(default=1, ge=1)
    # Cost of consuming ONE copy. Already includes the duplicate and storage
    # weightings from the cost model, so this service just adds numbers up.
    cost: int = 0
    # Split for reporting, never blended. Must sum to cost per copy.
    coins_spent: int = 0
    value_burned: int = 0


class Requirement(BaseModel):
    """Mirrors the TypeScript Requirement union, one flat shape."""

    type: str
    op: Literal["min", "max", "exact"] | None = None
    value: int | None = None
    count: int | None = None
    league: str | None = None
    nation: str | None = None
    club: str | None = None
    card_type: str | None = None
    promo_name: str | None = None
    quality: str | None = None
    position: str | None = None
    def_id: str | None = None


class SolveRequest(BaseModel):
    pool: list[PoolCard]
    formation_slots: list[str]
    requirements: list[Requirement] = Field(default_factory=list)
    # The exact rating multiset to fill, chosen by the TypeScript enumerator.
    # Omitted means any ratings, which is only useful for tests.
    rating_counts: dict[int, int] | None = None
    time_budget_seconds: float = 5.0
    # Reproducibility. CP-SAT is deterministic for a fixed worker count.
    workers: int = 8


class PlacedCard(BaseModel):
    card_id: str
    slot_index: int
    slot_position: str
    in_position: bool


class SolveResponse(BaseModel):
    status: Literal["optimal", "feasible", "infeasible", "unknown"]
    placements: list[PlacedCard] = Field(default_factory=list)
    total_cost: int = 0
    coins_spent: int = 0
    value_burned: int = 0
    # False when the time budget ran out before optimality was proven. The caller
    # MUST label such a result "best found, not proven optimal".
    proven_optimal: bool = False
    wall_time_seconds: float = 0.0
    # Why no squad exists, when the model itself can say.
    reason: str | None = None
