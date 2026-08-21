"""Local FastAPI wrapper. Localhost only, no auth, no deployment.

There is no code path here that resolves an EA hostname, and there never will be.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .api_models import impossibility_out, queue_out, repeat_out
from .challenge_model import ChallengeImpossible
from .chemistry_model import MissingChemistryRules
from .impossibility import diagnose_impossibility
from .queue_solve import QueueItem, solve_queue
from .repeat_solve import NegativeCostError, solve_repeat
from .schema import (
    DiagnoseRequest,
    DiagnoseResponse,
    QueueRequest,
    QueueResponse,
    RepeatRequest,
    RepeatResponse,
    SolveRequest,
    SolveResponse,
)
from .single_solve import UnsupportedRequirement, solve_single
from .squad_size import MixedSquadSizeError

app = FastAPI(title="FC-ai solver", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve/single", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    try:
        return solve_single(request)
    except MissingChemistryRules as error:
        # The caller asked for chemistry without sending the rules. The service
        # holds no defaults on purpose, so this is a 422 and never a guess.
        raise HTTPException(status_code=422, detail=str(error)) from error
    except UnsupportedRequirement as error:
        # Loud, not silent. Dropping a constraint would return a squad the game
        # rejects, which is worse than failing the request.
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/solve/repeat", response_model=RepeatResponse)
def solve_repeat_endpoint(request: RepeatRequest) -> RepeatResponse:
    try:
        outcome = solve_repeat(
            request.pool,
            request.formation_slots,
            requested=request.requested,
            requirements=request.requirements,
            chemistry=request.chemistry,
            allowed_rating_multisets=request.allowed_rating_multisets,
            rating_prices=request.rating_prices,
            max_copies_per_squad=request.max_copies_per_squad,
            time_budget_seconds=request.time_budget_seconds,
            diagnosis_budget_seconds=request.diagnosis_budget_seconds,
            workers=request.workers,
        )
    except (MissingChemistryRules, UnsupportedRequirement) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (ChallengeImpossible, NegativeCostError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return repeat_out(outcome, request.pool)


@app.post("/solve/queue", response_model=QueueResponse)
def solve_queue_endpoint(request: QueueRequest) -> QueueResponse:
    """One offs, sets and repeats in any mix, one shared pool. Brief 6.2 and 6.3.

    A set is a queue whose members are all kind="set" with the same set_name, so
    there is no separate endpoint for one: the same model answers both.
    """
    items = [
        QueueItem(
            name=item.name,
            formation_slots=item.formation_slots,
            requirements=item.requirements,
            chemistry=item.chemistry,
            multisets=item.multisets,
            kind=item.kind,
            count=item.count,
            priority=item.priority,
            set_name=item.set_name,
        )
        for item in request.items
    ]
    try:
        outcome = solve_queue(
            request.pool,
            items,
            time_budget_seconds=request.time_budget_seconds,
            rating_prices=request.rating_prices,
            max_copies_per_squad=request.max_copies_per_squad,
            workers=request.workers,
            include_plan=request.include_plan,
        )
    except (MissingChemistryRules, UnsupportedRequirement) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (ChallengeImpossible, MixedSquadSizeError, NegativeCostError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return queue_out(outcome, request.pool)


@app.post("/diagnose", response_model=DiagnoseResponse)
def diagnose_endpoint(request: DiagnoseRequest) -> DiagnoseResponse:
    """Why this cannot be built. Checkpoint 12.

    `universal_conflicts` comes from the rules engine's detectConflicts and is
    passed straight through. This service does not and must not derive it.
    """
    try:
        report = diagnose_impossibility(
            request.pool,
            request.formation_slots,
            requirements=request.requirements,
            chemistry=request.chemistry,
            multisets=request.multisets,
            count=request.count,
            max_copies_per_squad=request.max_copies_per_squad,
            universal_conflicts=request.universal_conflicts,
            time_budget_seconds=request.time_budget_seconds,
            workers=request.workers,
        )
    except (MissingChemistryRules, UnsupportedRequirement) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ChallengeImpossible as error:
        # The model could not even be built, which is itself the answer.
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return impossibility_out(report)
