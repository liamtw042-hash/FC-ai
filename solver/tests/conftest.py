import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fc_ai_solver import PoolCard  # noqa: E402

FORMATION_442 = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]


@pytest.fixture(scope="session")
def club_50() -> list[PoolCard]:
    raw = json.loads((Path(__file__).parent / "fixtures" / "club-50.json").read_text())
    return [PoolCard(**card) for card in raw["cards"]]


@pytest.fixture
def formation() -> list[str]:
    return list(FORMATION_442)
