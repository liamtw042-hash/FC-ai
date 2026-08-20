"""The HTTP surface the CLI and the UI both use.

Localhost only. There is no code path in this service that resolves an EA
hostname, and the test at the bottom of this file is what keeps it that way.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from fc_ai_solver.app import app

client = TestClient(app)

FORMATION = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]
ANY_POSITION = sorted(set(FORMATION))


def card(index: int, rating: int, cost: int, **kw) -> dict:
    return {
        "id": f"c{index}", "rating": rating, "positions": ANY_POSITION,
        "nation": f"N{index}", "league": kw.pop("league", f"L{index}"),
        "club": f"C{index}", "card_type": "rare", "quantity": 1,
        "cost": cost, "coins_spent": kw.pop("coins_spent", 0),
        "value_burned": kw.pop("value_burned", cost), **kw,
    }


def pool(count: int, rating: int = 84, cost: int = 1000, start: int = 0, **kw) -> list[dict]:
    return [card(start + i, rating, cost, **kw) for i in range(count)]


class TestHealth:
    def test_it_is_up(self):
        assert client.get("/health").json() == {"status": "ok"}


class TestRepeat:
    def test_it_builds_what_it_can_and_reports_the_count(self):
        response = client.post("/solve/repeat", json={
            "pool": pool(33), "formation_slots": FORMATION, "requested": 3,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["requested"] == 3
        assert body["achieved"] == 3
        assert len(body["squads"]) == 3

    def test_coins_spent_and_value_burned_come_back_SEPARATELY(self):
        # Fodder already owned costs no coins and burns what it was worth. One
        # figure for both would hide which of the two happened.
        response = client.post("/solve/repeat", json={
            "pool": pool(22, cost=500, coins_spent=0, value_burned=500),
            "formation_slots": FORMATION, "requested": 2,
        })
        body = response.json()
        assert body["coins_spent"] == 0
        assert body["value_burned"] == 11000
        assert body["total_cost"] == 11000

    def test_a_shortfall_comes_back_with_its_diagnosis_not_just_a_number(self):
        response = client.post("/solve/repeat", json={
            "pool": pool(22), "formation_slots": FORMATION, "requested": 4,
        })
        body = response.json()
        assert body["achieved"] == 2
        assert body["diagnosis"] is not None
        assert body["diagnosis"]["mode"] in ("supply", "unexplained")
        assert "Squad 3 blocked by" in body["summary"]

    def test_an_unsupported_requirement_is_a_422_and_not_a_dropped_constraint(self):
        response = client.post("/solve/repeat", json={
            "pool": pool(22), "formation_slots": FORMATION, "requested": 1,
            "requirements": [{"type": "inventedRequirement", "op": "min", "value": 1}],
        })
        assert response.status_code == 422
        assert "not expressible" in response.json()["detail"]


class TestQueue:
    def test_a_mixed_queue_comes_back_item_by_item(self):
        response = client.post("/solve/queue", json={
            "pool": pool(44), "items": [
                {"name": "one off", "formation_slots": FORMATION},
                {"name": "twice", "formation_slots": FORMATION, "kind": "repeat", "count": 2},
            ],
        })
        assert response.status_code == 200
        body = response.json()
        assert body["squads_built"] == 3
        names = {item["name"]: item for item in body["items"]}
        assert names["twice"]["achieved"] == 2
        assert names["one off"]["achieved"] == 1

    def test_a_set_is_a_queue_and_reports_per_challenge(self):
        response = client.post("/solve/queue", json={
            "pool": pool(22), "items": [
                {"name": "a", "formation_slots": FORMATION, "kind": "set", "set_name": "weekly"},
                {"name": "b", "formation_slots": FORMATION, "kind": "set", "set_name": "weekly"},
                {"name": "c", "formation_slots": FORMATION, "kind": "set", "set_name": "weekly"},
            ],
        })
        body = response.json()
        assert body["squads_built"] == 2
        assert not body["complete"]
        assert "set weekly: INCOMPLETE" in body["summary"]

    def test_the_grind_planner_summary_rides_along(self):
        response = client.post("/solve/queue", json={
            "pool": pool(44), "items": [
                {"name": "a", "formation_slots": FORMATION, "kind": "repeat", "count": 2},
            ],
        })
        assert response.json()["plan_summary"] is not None

    def test_a_mixed_squad_size_queue_is_refused_rather_than_silently_biased(self):
        response = client.post("/solve/queue", json={
            "pool": pool(44), "items": [
                {"name": "eleven", "formation_slots": FORMATION},
                {"name": "eight", "formation_slots": FORMATION[:8]},
            ],
        })
        assert response.status_code == 422


class TestDiagnose:
    def test_it_names_the_binding_requirement_and_the_gap(self):
        response = client.post("/diagnose", json={
            "pool": pool(6, league="Serie A") + pool(30, start=100),
            "formation_slots": FORMATION,
            "requirements": [
                {"type": "playersFromLeague", "league": "Serie A", "op": "min", "value": 9}
            ],
        })
        assert response.status_code == 200
        body = response.json()
        assert body["kind"] == "requirement"
        assert body["diagnosis"]["limits"][0]["best"] == 6
        assert body["diagnosis"]["limits"][0]["gap"] == 3

    def test_a_universal_conflict_is_passed_through_and_never_derived(self):
        response = client.post("/diagnose", json={
            "pool": [], "formation_slots": FORMATION,
            "universal_conflicts": ["distinctLeagues exactly 1 with distinctNations min 5"],
        })
        body = response.json()
        assert body["kind"] == "universal"
        assert "IMPOSSIBLE FOR EVERYONE" in body["summary"]

    def test_it_says_solvable_when_it_is(self):
        response = client.post("/diagnose", json={
            "pool": pool(22), "formation_slots": FORMATION, "count": 2,
        })
        assert response.json()["solvable"] is True


class TestSection12:
    """Section 1.2 is not negotiable, and a test is cheaper than a promise."""

    def test_no_route_and_no_source_file_mentions_an_EA_host(self):
        from pathlib import Path

        forbidden = ("ea.com", "easports", "utas.", "futbin", "companion")
        root = Path(__file__).resolve().parents[1] / "fc_ai_solver"
        for path in root.rglob("*.py"):
            text = path.read_text().lower()
            for needle in forbidden:
                assert needle not in text, f"{path.name} mentions {needle}"
