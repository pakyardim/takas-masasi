from backend import engine

LEAGUE = {
    "scoring": "categories",
    "categories": [
        {"key": "FG%", "label": "FG%", "higher": True, "ratio": ["FGM", "FGA"]},
        {"key": "PTS", "label": "PTS", "higher": True},
        {"key": "TO", "label": "TO", "higher": False},
    ],
}


def test_ratio_is_volume_weighted():
    tot = engine.add_lines([{"FGM": 1, "FGA": 2}, {"FGM": 9, "FGA": 18}, {"FGM": 0, "FGA": 0}])
    assert engine.category_values(tot, LEAGUE)["FG%"] == 0.5


def test_turnovers_lower_wins():
    r = engine.head_to_head({"PTS": 100, "TO": 10, "FGM": 40, "FGA": 80},
                            {"PTS": 90, "TO": 12, "FGM": 40, "FGA": 100}, LEAGUE)
    assert r["score"] == {"W": 3, "L": 0, "T": 0}


def _week():
    # one day, team A starts p1 and benches p2; team B starts p3
    return {"days": [{
        "date": "2026-11-02",
        "lineups": {"A": [{"player": "p1", "slot": "PG"}, {"player": "p2", "slot": "BN"}],
                    "B": [{"player": "p3", "slot": "C"}]},
        "stats": {"p1": {"PTS": 10, "TO": 1, "FGM": 4, "FGA": 10},
                  "p2": {"PTS": 30, "TO": 1, "FGM": 12, "FGA": 20},
                  "p3": {"PTS": 20, "TO": 3, "FGM": 8, "FGA": 16}},
    }]}


def test_bench_swap_flips_result():
    res = engine.what_if(LEAGUE, _week(), "A", "B", [{"team": "A", "out": "p1", "in": "p2"}])
    assert res["actual"]["result"] == "L"         # 10 pts, .400 vs 20 pts, .500 -> A wins TO only
    assert res["hypothetical"]["result"] == "W"   # p2 (30 pts, .600) takes p1's active slot
    assert res["flipped"]
    assert res["players"]["p2"]["hypothetical"]["PTS"] == 30
    assert res["players"]["p1"]["hypothetical"] == {}


def test_outside_player_uses_extra_stats():
    extra = {"fa": {"2026-11-02": {"PTS": 5, "TO": 0, "FGM": 2, "FGA": 5}}}
    res = engine.what_if(LEAGUE, _week(), "A", "B", [{"team": "A", "out": "p1", "in": "fa"}], extra)
    assert res["players"]["fa"]["hypothetical"]["PTS"] == 5


def test_trade_ranks_and_net():
    rosters = {"A": ["p1", "p2"], "B": ["p3"], "C": ["p4"]}
    avgs = {"p1": {"PTS": 10, "TO": 1, "FGM": 4, "FGA": 10, "GP": 5},
            "p2": {"PTS": 12, "TO": 2, "FGM": 5, "FGA": 10, "GP": 5},
            "p3": {"PTS": 25, "TO": 3, "FGM": 9, "FGA": 18, "GP": 5},
            "p4": {"PTS": 15, "TO": 2, "FGM": 6, "FGA": 12, "GP": 5}}
    r = engine.evaluate_trade(LEAGUE, rosters, avgs, "A", ["p1"], "B", ["p3"])
    pts = next(c for c in r["categories"] if c["key"] == "PTS")
    assert pts["a_net"] == 15 and pts["better_for_a"] == "W"
    to = next(c for c in r["categories"] if c["key"] == "TO")
    assert to["better_for_a"] == "L"
    a_pts = next(x for x in r["team_impact"]["A"] if x["key"] == "PTS")
    assert (a_pts["before"], a_pts["after"], a_pts["rank_after"]) == (22, 37, 1)
    assert r["roster_spots"]["a_net"] == 0


def test_points_league():
    lg = {"scoring": "points", "categories": [], "modifiers": {"PTS": 1, "TO": -1}}
    r = engine.head_to_head({"PTS": 50, "TO": 5}, {"PTS": 48, "TO": 1}, lg)
    assert r["result"] == "L" and r["a_points"] == 45
