"""Local FastAPI wrapper. Localhost only, no auth, no deployment.

There is no code path here that resolves an EA hostname, and there never will be.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .schema import SolveRequest, SolveResponse
from .single_solve import UnsupportedRequirement, solve_single

app = FastAPI(title="FC-ai solver", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve/single", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    try:
        return solve_single(request)
    except UnsupportedRequirement as error:
        # Loud, not silent. Dropping a constraint would return a squad the game
        # rejects, which is worse than failing the request.
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
