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
    # Cards sharing this key are the SAME THING for the purpose of the per squad
    # copy limit below. What "the same thing" means is the caller's decision and
    # is never made here: the rules engine sets it, currently to the card
    # definition id. None means the caller supplied no grouping, and then no copy
    # limit is applied to this card.
    player_key: str | None = None
    # Cost of consuming ONE copy. Already includes the duplicate and storage
    # weightings from the cost model, so this service just adds numbers up.
    # NOT A COIN PRICE. A weighted cost can be 50 for a card worth 4000, and
    # quoting it as coins is exactly the sort of number that gets acted on.
    cost: int = 0
    # Split for reporting, never blended. Must sum to cost per copy.
    coins_spent: int = 0
    value_burned: int = 0
    # What one copy would cost to BUY, in coins, if the caller knows. This is the
    # only field the shortfall diagnosis will price a rating from, short of the
    # price table. None means genuinely unpriced, and unpriced means no figure.
    market_price: int | None = None


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


class ChemistryContribution(BaseModel):
    """How many increments one card of this type adds to each threshold count.

    Supplied by the TypeScript rules engine. There is DELIBERATELY no default:
    an unknown card type is an error, not a guess, because a guess here silently
    mis-scores every squad containing that card.
    """

    club: int
    league: int
    nation: int
    # True only for Icons: the league increments apply to every league, not one.
    applies_league_to_all: bool = False
    # Icons, Heroes, Festival of Football Captains. Still gated on position.
    always_max_chem: bool = False


class Manager(BaseModel):
    nation: str
    league: str


class ChemistryConfig(BaseModel):
    """The chemistry rules, passed in as DATA.

    Nothing in this service knows what the numbers should be. The ladders and the
    contribution table are the TypeScript engine's, serialised. If a rule changes
    it changes in one place and arrives here on the next request.
    """

    # Descending [count, points] pairs. The first entry a count reaches wins.
    club_thresholds: list[tuple[int, int]]
    nation_thresholds: list[tuple[int, int]]
    league_thresholds: list[tuple[int, int]]
    # card_type to contribution. A pool card whose type is absent is an error.
    contributions: dict[str, ChemistryContribution]
    max_player_chemistry: int
    max_squad_chemistry: int
    manager: Manager | None = None


class Pin(BaseModel):
    """Hold one card in one slot. Used by re-solve with pins held, and by the
    cross check that proves this model agrees with the TypeScript engine."""

    card_id: str
    slot_index: int


class SolveRequest(BaseModel):
    pool: list[PoolCard]
    formation_slots: list[str]
    pins: list[Pin] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)
    # Required whenever any chemistry requirement is present. No default, and no
    # fallback: see ChemistryConfig.
    chemistry: ChemistryConfig | None = None
    # The exact rating multiset to fill, chosen by the TypeScript enumerator.
    # Omitted means any ratings, which is only useful for tests.
    rating_counts: dict[int, int] | None = None
    # Previously found squads this solve must differ from, as card id lists.
    # Used by solve_alternatives to get genuinely different answers rather than
    # five near identical ones.
    exclude_similar_to: list[list[str]] = Field(default_factory=list)
    min_difference: int = 3
    time_budget_seconds: float = 5.0
    # Reproducibility. CP-SAT is deterministic for a fixed worker count.
    workers: int = 8
    # How many cards sharing a player_key may appear in ONE squad. Supplied by
    # the caller, because whether a footballer may be fielded twice is a game rule
    # and this service holds none. None with keyed cards in the pool is an error,
    # not a licence to pick a number.
    max_copies_per_squad: int | None = None
    # On failure, run the checkpoint 12 diagnosis and put its answer in `reason`.
    # Default ON: "no squad in the available pool satisfies these requirements" is
    # exactly the shrug that diagnosis exists to replace, and a caller who wants
    # the shrug back can ask for it.
    diagnose_on_failure: bool = True
    diagnosis_budget_seconds: float = 10.0
    # Impossible for everyone, from the rules engine's detectConflicts. Passed
    # through, never derived here: this service holds no game rules.
    universal_conflicts: list[str] = Field(default_factory=list)


class PlacedCard(BaseModel):
    card_id: str
    slot_index: int
    slot_position: str
    in_position: bool
    # Reported so the TypeScript engine can re-derive it and compare. A mismatch
    # means the two implementations have drifted and must be surfaced, not hidden.
    #
    # None means THIS SERVICE DID NOT COMPUTE IT, which is not the same as zero.
    # Repeat and queue mode used to leave it at the old default of 0, so every
    # squad with real chemistry was reported as a drift between the two engines
    # when nothing had drifted. A guard that cries wolf gets ignored.
    chemistry: int | None = None


class SolveResponse(BaseModel):
    status: Literal["optimal", "feasible", "infeasible", "unknown"]
    placements: list[PlacedCard] = Field(default_factory=list)
    total_cost: int = 0
    coins_spent: int = 0
    value_burned: int = 0
    # False when the time budget ran out before optimality was proven. The caller
    # MUST label such a result "best found, not proven optimal".
    squad_chemistry: int = 0
    proven_optimal: bool = False
    wall_time_seconds: float = 0.0
    # Why no squad exists, when the model itself can say.
    reason: str | None = None


class RepeatRequest(BaseModel):
    """One repeatable SBC, N times, solved jointly. Brief 6.1."""

    pool: list[PoolCard]
    formation_slots: list[str]
    requested: int = Field(ge=1)
    requirements: list[Requirement] = Field(default_factory=list)
    chemistry: ChemistryConfig | None = None
    allowed_rating_multisets: list[dict[int, int]] | None = None
    rating_prices: dict[int, int] | None = None
    max_copies_per_squad: int | None = None
    time_budget_seconds: float = 60.0
    diagnosis_budget_seconds: float = 10.0
    workers: int = 8


class QueueItemRequest(BaseModel):
    """One entry in a queue: a challenge, how many of it, how much it matters."""

    name: str
    formation_slots: list[str]
    requirements: list[Requirement] = Field(default_factory=list)
    chemistry: ChemistryConfig | None = None
    multisets: list[dict[int, int]] | None = None
    kind: Literal["one_off", "set", "repeat"] = "one_off"
    count: int = Field(default=1, ge=1)
    priority: int = Field(default=1, ge=1)
    set_name: str | None = None


class QueueRequest(BaseModel):
    pool: list[PoolCard]
    items: list[QueueItemRequest]
    rating_prices: dict[int, int] | None = None
    max_copies_per_squad: int | None = None
    time_budget_seconds: float = 60.0
    workers: int = 8
    include_plan: bool = True


class SupplyShortfallOut(BaseModel):
    rating: int | None
    needed: int
    held: int
    missing: int
    unit_cost: int | None
    # "table", "pool" or "unknown". An unknown basis means NO coin figure is
    # quoted anywhere downstream, rather than an estimate that reads as a price.
    basis: str
    cost_to_close: int | None


class ClubLimitOut(BaseModel):
    name: str
    asked: int | None
    best: int | None
    gap: int | None
    reachable: bool
    description: str


class DiagnosisOut(BaseModel):
    mode: str
    blocking: list[str] = Field(default_factory=list)
    explanation: str
    supply: list[SupplyShortfallOut] = Field(default_factory=list)
    limits: list[ClubLimitOut] = Field(default_factory=list)


class SquadOut(BaseModel):
    placements: list[PlacedCard]
    # The WEIGHTED figure the solver minimised. Not coins. The two below are.
    cost: int
    coins_spent: int = 0
    value_burned: int = 0


class RepeatResponse(BaseModel):
    requested: int
    achieved: int
    squads: list[SquadOut] = Field(default_factory=list)
    total_cost: int = 0
    coins_spent: int = 0
    value_burned: int = 0
    proven_optimal: bool = False
    wall_time_seconds: float = 0.0
    diagnosis: DiagnosisOut | None = None
    summary: str = ""


class ItemOutcomeOut(BaseModel):
    name: str
    kind: str
    set_name: str | None = None
    priority: int
    requested: int
    achieved: int
    squads: list[SquadOut] = Field(default_factory=list)
    cost: int = 0
    diagnosis: DiagnosisOut | None = None


class QueueResponse(BaseModel):
    items: list[ItemOutcomeOut] = Field(default_factory=list)
    squads_built: int = 0
    total_cost: int = 0
    coins_spent: int = 0
    value_burned: int = 0
    complete: bool = False
    proven_optimal: bool = False
    wall_time_seconds: float = 0.0
    plan_summary: str | None = None
    summary: str = ""


class DiagnoseRequest(BaseModel):
    pool: list[PoolCard]
    formation_slots: list[str]
    requirements: list[Requirement] = Field(default_factory=list)
    chemistry: ChemistryConfig | None = None
    multisets: list[dict[int, int]] | None = None
    count: int = Field(default=1, ge=1)
    max_copies_per_squad: int | None = None
    # From the rules engine's detectConflicts. Passed through, never derived here.
    universal_conflicts: list[str] = Field(default_factory=list)
    time_budget_seconds: float = 10.0
    workers: int = 8


class DiagnoseResponse(BaseModel):
    kind: str
    count: int
    achievable: int | None
    solvable: bool
    universal: list[str] = Field(default_factory=list)
    diagnosis: DiagnosisOut | None = None
    summary: str
