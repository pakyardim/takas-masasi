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


def test_bench_on_one_day_only():
    wk = _week()
    wk["days"].append({"date": "2026-11-03",
                       "lineups": {"A": [{"player": "p1", "slot": "PG"}], "B": [{"player": "p3", "slot": "C"}]},
                       "stats": {"p1": {"PTS": 50, "TO": 9, "FGM": 20, "FGA": 30}, "p3": None}})
    res = engine.what_if(LEAGUE, wk, "A", "B", [{"team": "A", "type": "bench", "player": "p1", "dates": ["2026-11-03"]}])
    pts = lambda r: next(c for c in r["categories"] if c["key"] == "PTS")["a"]
    assert pts(res["actual"]) == 60 and pts(res["hypothetical"]) == 10
    assert res["players"]["p1"]["actual"]["GP"] == 2 and res["players"]["p1"]["hypothetical"]["GP"] == 1


def test_start_bench_player_and_overfull_warning():
    res = engine.what_if(LEAGUE, _week(), "A", "B",
                         [{"team": "A", "type": "start", "player": "p2", "dates": ["2026-11-02"]}], active_slots=1)
    assert next(c for c in res["hypothetical"]["categories"] if c["key"] == "PTS")["a"] == 40
    assert res["warnings"] == [{"team": "A", "date": "2026-11-02", "played": 2, "slots": 1}]


def test_versus_all():
    wk = _week()
    wk["days"][0]["lineups"]["C"] = [{"player": "p4", "slot": "C"}]
    wk["days"][0]["stats"]["p4"] = {"PTS": 5, "TO": 5, "FGM": 1, "FGA": 10}
    rows = engine.versus_all(LEAGUE, wk, "A", ["B", "C"])
    assert [r["actual"]["result"] for r in rows] == ["L", "W"]
    rows = engine.versus_all(LEAGUE, wk, "A", ["B"], [{"team": "A", "out": "p1", "in": "p2"}])
    assert rows[0]["hypothetical"]["result"] == "W"


def test_uneven_trade_with_drop_and_add():
    rosters = {"A": ["p1", "p2"], "B": ["p3", "p4"]}
    avgs = {"p1": {"PTS": 30, "TO": 3, "FGM": 10, "FGA": 20, "GP": 5},
            "p2": {"PTS": 5, "TO": 1, "FGM": 2, "FGA": 5, "GP": 5},
            "p3": {"PTS": 14, "TO": 2, "FGM": 5, "FGA": 10, "GP": 5},
            "p4": {"PTS": 12, "TO": 2, "FGM": 5, "FGA": 10, "GP": 5},
            "fa": {"PTS": 8, "TO": 1, "FGM": 3, "FGA": 8, "GP": 5}}
    # A gives its star for two players and must drop p2; B fills the open spot with a free agent
    r = engine.evaluate_trade(LEAGUE, rosters, avgs, "A", ["p1"], "B", ["p3", "p4"],
                              pool={k: avgs[k] for k in ("p1", "p2", "p3", "p4")},
                              drops_a=["p2"], adds_b=["fa"])
    pts = next(c for c in r["categories"] if c["key"] == "PTS")
    assert pts["a_net"] == (14 + 12) - (30 + 5)          # received - (given + dropped)
    assert pts["b_net"] == (30 + 8) - (14 + 12)          # (received + added) - given
    assert pts["better_for_a"] == "L" and pts["better_for_b"] == "W"
    a_after = next(x for x in r["team_impact"]["A"] if x["key"] == "PTS")["after"]
    assert a_after == 26 and r["moves"]["drops_a"] == ["p2"]
    z = lambda p: r["players"][p]["z"]["TOTAL"]
    assert abs(r["a_net_value"] - (z("p3") + z("p4") - z("p1") - z("p2"))) < 1e-9
    assert abs(r["b_net_value"] - (z("p1") + z("fa") - z("p3") - z("p4"))) < 1e-9
