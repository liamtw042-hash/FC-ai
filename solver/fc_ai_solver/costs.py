"""Notes on the cost values arriving from TypeScript.

No cost is computed here. src/solver/costModel.ts owns the whole cost model,
including the offset that keeps the objective non negative. This module exists
only so the Python side has somewhere to record what it is assuming about those
numbers, and to give the tests something to point at.

ASSUMPTIONS, all of them checked rather than trusted:

  1. Every card cost is non negative. repeat_solve raises NegativeCostError
     otherwise, because an extra squad would look like a gain.
  2. Every squad is the same size. squad_size.py raises otherwise, because the
     offset is only order neutral at a fixed size.
"""

OFFSET_DEMO_NOTE = (
    "The offset is applied per card, so a squad shifts by size * offset. Order "
    "neutral at a fixed size, biased across mixed sizes, and unrecoverable by "
    "subtraction because that restores the negative raw cost."
)
