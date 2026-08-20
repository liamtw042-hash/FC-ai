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


def tally(pool, squads):
    """Total cost, coins spent and value burned over a list of built squads.

    COINS AND VALUE ARE NOT THE SAME NUMBER and are never added together. Coins
    spent is money that left the account. Value burned is what the fodder would
    have fetched had it been sold instead. A solve that spends nothing and burns
    three hundred thousand is a very different afternoon from one that spends
    three hundred thousand, and one figure for both hides which happened.

    Lives here rather than in each solver so the two modes cannot drift apart.
    """
    by_id = {card.id: card for card in pool}
    total = coins = burned = 0
    for squad in squads:
        for placement in squad:
            card = by_id[placement.card_id]
            total += card.cost
            coins += card.coins_spent
            burned += card.value_burned
    return total, coins, burned
