"""Turning the solver's own objects into the wire shapes. Nothing else.

Kept apart from the solving code on purpose: `RepeatOutcome` and `QueueOutcome`
are what the tests reason about, and bending them into Pydantic models to save
this file would put serialisation concerns inside the search.
"""

from __future__ import annotations

from .costs import tally
from .impossibility import Impossibility
from .queue_solve import QueueOutcome
from .repeat_solve import RepeatOutcome, ShortfallDiagnosis
from .schema import (
    ClubLimitOut,
    DiagnoseResponse,
    DiagnosisOut,
    ItemOutcomeOut,
    QueueResponse,
    RepeatResponse,
    SquadOut,
    SupplyShortfallOut,
)


def diagnosis_out(diagnosis: ShortfallDiagnosis | None) -> DiagnosisOut | None:
    if diagnosis is None:
        return None
    return DiagnosisOut(
        mode=diagnosis.mode,
        blocking=list(diagnosis.blocking),
        explanation=diagnosis.explanation,
        supply=[
            SupplyShortfallOut(
                rating=shortfall.rating,
                needed=shortfall.needed,
                held=shortfall.held,
                missing=shortfall.missing,
                unit_cost=shortfall.unit_cost,
                basis=shortfall.basis,
                cost_to_close=shortfall.cost_to_close,
            )
            for shortfall in diagnosis.supply
        ],
        limits=[
            ClubLimitOut(
                name=limit.name,
                asked=limit.asked,
                best=limit.best,
                gap=limit.gap,
                reachable=limit.reachable,
                description=limit.describe(),
            )
            for limit in diagnosis.limits
        ],
    )


def repeat_out(outcome: RepeatOutcome, pool) -> RepeatResponse:
    _, coins, burned = tally(pool, outcome.squads)
    head = f"{outcome.achieved} of {outcome.requested} squad(s) built"
    if not outcome.proven_optimal:
        head += ", NOT PROVEN OPTIMAL, best found in budget"
    tail = ""
    if outcome.diagnosis is not None:
        tail = f". Squad {outcome.achieved + 1} blocked by {outcome.diagnosis.explanation}"
        # The diagnosis is about the next squad only. Deeper ones are a separate
        # question and the planner is what answers it per depth; saying nothing
        # here reads as "and the same for the rest", which was not checked.
        remaining = outcome.requested - outcome.achieved
        if remaining > 1:
            tail += (
                f". Squads {outcome.achieved + 2} to {outcome.requested} were NOT probed "
                f"separately, so what blocks them is unknown rather than the same thing"
            )
    elif outcome.shortfall_reason:
        tail = f". {outcome.shortfall_reason}"
    return RepeatResponse(
        requested=outcome.requested,
        achieved=outcome.achieved,
        squads=[
            SquadOut(placements=squad, cost=_squad_cost(pool, squad))
            for squad in outcome.squads
        ],
        total_cost=outcome.total_cost,
        coins_spent=coins,
        value_burned=burned,
        proven_optimal=outcome.proven_optimal,
        wall_time_seconds=outcome.wall_time_seconds,
        diagnosis=diagnosis_out(outcome.diagnosis),
        summary=(
            f"{head}, {outcome.total_cost} cost, {coins} coins spent, "
            f"{burned} value burned{tail}"
        ),
    )


def _squad_cost(pool, squad) -> int:
    by_id = {card.id: card for card in pool}
    return sum(by_id[placement.card_id].cost for placement in squad)


def queue_out(outcome: QueueOutcome, pool) -> QueueResponse:
    return QueueResponse(
        items=[
            ItemOutcomeOut(
                name=item.name,
                kind=item.item.kind,
                set_name=item.item.set_name,
                priority=item.item.priority,
                requested=item.item.count,
                achieved=item.achieved,
                squads=[
                    SquadOut(placements=squad, cost=_squad_cost(pool, squad))
                    for squad in item.squads
                ],
                cost=item.cost,
                diagnosis=diagnosis_out(item.diagnosis),
            )
            for item in outcome.items
        ],
        squads_built=outcome.squads_built,
        total_cost=outcome.total_cost,
        coins_spent=outcome.coins_spent,
        value_burned=outcome.value_burned,
        complete=outcome.complete,
        proven_optimal=outcome.proven_optimal,
        wall_time_seconds=outcome.wall_time_seconds,
        plan_summary=outcome.plan.summary() if outcome.plan is not None else None,
        summary=outcome.describe(),
    )


def impossibility_out(report: Impossibility) -> DiagnoseResponse:
    return DiagnoseResponse(
        kind=report.kind,
        count=report.count,
        achievable=report.achievable,
        solvable=report.solvable,
        universal=list(report.universal),
        diagnosis=diagnosis_out(report.diagnosis),
        summary=report.describe(),
    )
