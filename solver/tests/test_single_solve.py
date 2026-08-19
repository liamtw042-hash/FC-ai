"""Checkpoint 8. CP-SAT single solve against a hand built 50 card club."""

from __future__ import annotations

import itertools

import pytest

from fc_ai_solver import PoolCard, Requirement, SolveRequest, UnsupportedRequirement, solve_single


def solve(pool, formation, **kwargs):
    return solve_single(SolveRequest(pool=pool, formation_slots=formation, **kwargs))


def used_counts(response, pool) -> dict[str, int]:
    counts: dict[str, int] = {}
    for placement in response.placements:
        counts[placement.card_id] = counts.get(placement.card_id, 0) + 1
    return counts


class TestBasics:
    def test_fills_every_slot_exactly_once(self, club_50, formation):
        response = solve(club_50, formation)
        assert response.status == "optimal"
        assert len(response.placements) == 11
        assert sorted(p.slot_index for p in response.placements) == list(range(11))
        assert [p.slot_position for p in sorted(response.placements, key=lambda p: p.slot_index)] == formation

    def test_reports_cost_split_without_blending_it(self, club_50, formation):
        response = solve(club_50, formation)
        by_id = {card.id: card for card in club_50}
        counts = used_counts(response, club_50)
        assert response.coins_spent == sum(by_id[i].coins_spent * n for i, n in counts.items())
        assert response.value_burned == sum(by_id[i].value_burned * n for i, n in counts.items())

    def test_rejects_a_formation_that_is_not_eleven_slots(self, club_50):
        with pytest.raises(ValueError, match="This solver builds 11 card squads"):
            solve(club_50, ["GK", "CB"])


class TestQuantity:
    """A stack of n is n submittable items. A boolean would cap every stack at one."""

    def test_a_stack_can_fill_several_slots(self):
        pool = [
            PoolCard(id="cheap", rating=84, positions=["CM"], nation="N", league="L", club="C",
                     card_type="rare", quantity=11, cost=10),
            PoolCard(id="dear", rating=84, positions=["CM"], nation="N", league="L", club="C",
                     card_type="rare", quantity=11, cost=1000),
        ]
        response = solve(pool, ["CM"] * 11)
        assert response.total_cost == 110
        assert used_counts(response, pool) == {"cheap": 11}

    def test_never_uses_more_copies_than_are_owned(self):
        pool = [
            PoolCard(id="cheap", rating=84, positions=["CM"], nation="N", league="L", club="C",
                     card_type="rare", quantity=3, cost=10),
            PoolCard(id="dear", rating=84, positions=["CM"], nation="N", league="L", club="C",
                     card_type="rare", quantity=20, cost=100),
        ]
        response = solve(pool, ["CM"] * 11)
        counts = used_counts(response, pool)
        assert counts["cheap"] == 3
        assert counts["dear"] == 8
        assert response.total_cost == 3 * 10 + 8 * 100


class TestRatingMultiset:
    """The non linear rating formula never enters the model. TypeScript picks the
    multiset and this service fills exactly that."""

    def test_fills_the_requested_multiset_exactly(self, club_50, formation):
        wanted = {88: 2, 84: 5, 82: 4}
        response = solve(club_50, formation, rating_counts=wanted)
        assert response.status == "optimal"
        by_id = {card.id: card for card in club_50}
        got: dict[int, int] = {}
        for placement in response.placements:
            rating = by_id[placement.card_id].rating
            got[rating] = got.get(rating, 0) + 1
        assert got == wanted

    def test_says_infeasible_when_the_club_cannot_supply_the_multiset(self, club_50, formation):
        response = solve(club_50, formation, rating_counts={99: 11})
        assert response.status == "infeasible"
        assert response.reason


class TestOptimality:
    def test_matches_brute_force_on_a_pool_small_enough_to_enumerate(self):
        pool = [
            PoolCard(id=f"c{i}", rating=84, positions=["CM"], nation=f"N{i % 3}",
                     league="Premier League" if i % 2 == 0 else "La Liga",
                     club=f"Club{i % 4}", card_type="rare", quantity=1, cost=100 + 7 * i)
            for i in range(14)
        ]
        requirements = [Requirement(type="playersFromLeague", league="La Liga", op="min", value=4)]
        response = solve(pool, ["CM"] * 11, requirements=requirements)

        best = None
        for combo in itertools.combinations(range(14), 11):
            if sum(1 for i in combo if pool[i].league == "La Liga") < 4:
                continue
            cost = sum(pool[i].cost for i in combo)
            if best is None or cost < best:
                best = cost
        assert response.total_cost == best
        assert response.proven_optimal

    def test_labels_a_result_it_could_not_prove_optimal(self, club_50, formation):
        # A budget this small cannot prove optimality, and the flag must say so
        # rather than letting a merely feasible squad pass as cheapest.
        response = solve(club_50, formation, time_budget_seconds=0.001)
        assert response.status in ("optimal", "feasible", "unknown")
        if response.status == "feasible":
            assert response.proven_optimal is False


class TestRequirements:
    def test_named_league_minimum(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="playersFromLeague", league="Serie A", op="min", value=5),
        ])
        by_id = {card.id: card for card in club_50}
        assert sum(1 for p in response.placements if by_id[p.card_id].league == "Serie A") >= 5

    def test_same_league_min_is_about_any_one_league(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="sameLeagueCount", op="min", value=7),
        ])
        by_id = {card.id: card for card in club_50}
        counts: dict[str, int] = {}
        for placement in response.placements:
            league = by_id[placement.card_id].league
            counts[league] = counts.get(league, 0) + 1
        assert max(counts.values()) >= 7

    def test_same_league_max_is_about_every_league(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="sameLeagueCount", op="max", value=4),
        ])
        by_id = {card.id: card for card in club_50}
        counts: dict[str, int] = {}
        for placement in response.placements:
            league = by_id[placement.card_id].league
            counts[league] = counts.get(league, 0) + 1
        assert max(counts.values()) <= 4

    def test_distinct_nations(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="distinctNations", op="min", value=6),
        ])
        by_id = {card.id: card for card in club_50}
        assert len({by_id[p.card_id].nation for p in response.placements}) >= 6

    def test_max_player_rating_excludes_cards_outright(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="maxPlayerRating", value=84),
        ])
        by_id = {card.id: card for card in club_50}
        assert max(by_id[p.card_id].rating for p in response.placements) <= 84

    def test_min_player_rating_with_and_without_a_count(self, club_50, formation):
        by_id = {card.id: card for card in club_50}

        counted = solve(club_50, formation, requirements=[
            Requirement(type="minPlayerRating", value=86, count=3),
        ])
        assert sum(1 for p in counted.placements if by_id[p.card_id].rating >= 86) >= 3

        all_eleven = solve(club_50, formation, requirements=[
            Requirement(type="minPlayerRating", value=83),
        ])
        assert min(by_id[p.card_id].rating for p in all_eleven.placements) >= 83

    def test_totw_and_quality_counts(self, club_50, formation):
        by_id = {card.id: card for card in club_50}
        response = solve(club_50, formation, requirements=[
            Requirement(type="totwCount", op="min", value=2),
            Requirement(type="qualityCount", quality="gold", op="exact", value=11),
        ])
        assert sum(1 for p in response.placements if by_id[p.card_id].is_totw) >= 2
        assert all(by_id[p.card_id].rating >= 75 for p in response.placements)

    def test_exclude_evolved(self, club_50, formation):
        by_id = {card.id: card for card in club_50}
        response = solve(club_50, formation, requirements=[Requirement(type="excludeEvolved")])
        assert not any(by_id[p.card_id].is_evolved for p in response.placements)

    def test_specific_player_must_appear(self, club_50, formation):
        target = club_50[7].id
        response = solve(club_50, formation, requirements=[
            Requirement(type="specificPlayer", def_id=target),
        ])
        assert any(p.card_id == target for p in response.placements)

    def test_specific_player_not_in_the_pool_is_reported_not_ignored(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="specificPlayer", def_id="not-in-my-club"),
        ])
        assert response.status == "infeasible"
        assert "not in the available pool" in (response.reason or "")


class TestNeverSilentlyDropsAConstraint:
    """Quietly ignoring a requirement returns a squad the game rejects, which is
    the one failure worth being loud about."""

    def test_an_unknown_requirement_raises(self, club_50, formation):
        with pytest.raises(UnsupportedRequirement, match="not expressible"):
            solve(club_50, formation, requirements=[Requirement(type="somethingNewEaShipped")])

    def test_a_squad_size_other_than_eleven_raises(self, club_50, formation):
        with pytest.raises(UnsupportedRequirement, match="not supported"):
            solve(club_50, formation, requirements=[Requirement(type="squadSize", value=8)])

    def test_a_position_the_formation_lacks_is_reported(self, club_50, formation):
        response = solve(club_50, formation, requirements=[
            Requirement(type="specificPosition", position="CAM", op="min", value=1),
        ])
        assert response.status == "infeasible"
        assert "CAM" in (response.reason or "")


class TestNullEntities:
    def test_icons_with_no_club_do_not_link_through_the_blank(self):
        pool = [
            PoolCard(id=f"icon{i}", rating=90, positions=["CM"], nation=f"N{i}", league=None,
                     club=None, card_type="icon", quantity=1, cost=1000) for i in range(11)
        ] + [
            PoolCard(id=f"c{i}", rating=84, positions=["CM"], nation="England",
                     league="Premier League", club="Arsenal", quantity=1, card_type="rare", cost=100)
            for i in range(11)
        ]
        # If the eleven null clubs counted as one shared club, this would be
        # satisfiable by the Icons alone at a much higher cost.
        response = solve(pool, ["CM"] * 11, requirements=[
            Requirement(type="sameClubCount", op="min", value=11),
        ])
        assert response.status == "optimal"
        assert all(p.card_id.startswith("c") for p in response.placements)
