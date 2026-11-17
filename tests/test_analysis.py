from backend import analysis, imported


def L(pts, **kw):
    base = {"PTS": pts, "FGM": pts / 2.5, "FGA": pts / 1.2, "FTM": 2, "FTA": 2.5, "3PTM": 1, "REB": 5, "AST": 3,
            "ST": 1, "BLK": 0.5, "TO": 2}
    return {**base, **kw}


def _store(tmp_path, monkeypatch):
    monkeypatch.setattr(imported, "DATA_FILE", tmp_path / "league.json")
    pl = lambda k: {"id": k, "name": f"P{k}", "nba_team": "X", "positions": ["PG"], "status": ""}
    season = {"a1": {"GP": 10, **L(30)}, "a2": {"GP": 10, **L(8)}, "b1": {"GP": 10, **L(20)}, "b2": {"GP": 0}}
    imported.merge_import("base", {
        "league_id": "1", "name": "T", "scoring_type": "Head-to-Head - Categories",
        "categories": ["FG%", "FT%", "3PTM", "PTS", "REB", "AST", "ST", "BLK", "TO"],
        "teams": [{"id": "1", "name": "A"}, {"id": "2", "name": "B"}], "my_team": "1", "current_week": 1,
        "rosters": {"1": ["a1", "a2"], "2": ["b1", "b2"]},
        "players": {k: {**pl(k), "owner": "1" if k[0] == "a" else "2"} for k in season},
        "averages": {p: season for p in ("season", "last30", "last14", "last7")},
    })
    # free agents (replacement level = average of the best free agents); fa2 was drafted by A and dropped
    imported.merge_import("pool", {"players": {"fa1": pl("fa1"), "fa2": pl("fa2")},
                                   "averages": {"fa1": {"GP": 10, **L(14)}, "fa2": {"GP": 10, **L(4)}}})
    imported.merge_import("draft", {"picks": [
        {"round": 1, "pick": 1, "overall": 1, "player": pl("b1"), "team_name": "B"},
        {"round": 1, "pick": 2, "overall": 2, "player": pl("a2"), "team_name": "A"},
        {"round": 2, "pick": 1, "overall": 3, "player": pl("fa2"), "team_name": "A"},
        {"round": 2, "pick": 2, "overall": 4, "player": pl("b2"), "team_name": "B"},
    ]})
    # team A added a1 on Oct 21: he sits one game on the bench, then plays two active games
    days = {
        "2026-10-20": {"1": [{"player": "a2", "slot": "PG", "line": L(8)}], "2": [{"player": "b1", "slot": "PG", "line": L(20)}]},
        "2026-10-21": {"1": [{"player": "a1", "slot": "BN", "line": L(40)}, {"player": "a2", "slot": "PG", "line": None}], "2": []},
        "2026-10-22": {"1": [{"player": "a1", "slot": "PG", "line": L(30)}], "2": []},
        "2026-10-23": {"1": [{"player": "a1", "slot": "PG", "line": L(30)}], "2": []},
    }
    imported.merge_import("week", {"week": 1, "pairs": [["1", "2"]], "dates": sorted(days), "official": {},
                                   "days": days, "players": {}})
    imported.merge_import("transactions", {"rows": [
        {"ts": "Oct 21, 9:00 am", "team": "1", "moves": [{"player": pl("a1"), "action": "add", "source": "Free Agent"},
                                                         {"player": pl("fa2"), "action": "drop", "source": "To Free Agent"}]},
        {"ts": "Oct 21, 9:00 am", "team": "1", "moves": [{"player": pl("a1"), "action": "add", "source": "Free Agent"}]},
    ], "complete": True})
    return imported.ImportedProvider()


def test_draft_report(tmp_path, monkeypatch):
    r = analysis.draft_report(_store(tmp_path, monkeypatch))
    assert r["available"] and r["has_pool"] and r["unknown"] == 0
    by = {p["player"]["key"]: p for p in r["picks"]}
    assert by["b1"]["value"] > 0 > by["fa2"]["value"]      # above / below replacement
    assert by["b2"]["value"] == 0 and by["b2"]["gp"] == 0   # never played -> worth nothing
    assert by["a2"]["kept"] and not by["fa2"]["kept"]
    assert [t["name"] for t in r["teams"]] == ["B", "A"]    # B's draft produced more
    assert r["teams"][0]["best"]["player"]["key"] == "b1"


def test_moves_report(tmp_path, monkeypatch):
    p = _store(tmp_path, monkeypatch)
    st = imported.status("1")
    assert st["has_draft"] and st["tx_complete"] and len(st["tx_keys"]) == 2
    r = analysis.moves_report(p)
    assert r["available"] and r["count"] == 2
    top = r["pickups"][0]
    assert top["player"]["key"] == "a1" and top["team"] == "1"
    assert (top["games"], top["active_games"]) == (3, 2) and top["ongoing"]
    assert top["value"] > 0 and top["value_all"] > top["value"]   # the benched 40-point game is not credited
    assert r["teams"][0]["name"] == "A" and r["teams"][1]["adds"] == 0


def test_trade_sides(tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch)
    pl = lambda k: {"id": k, "name": f"P{k}", "nba_team": "X", "positions": ["PG"]}
    # Oct 24: b1 goes to team 1 (and plays a good game there), a2 goes to team 2 (no game yet)
    day = {"1": [{"player": "a1", "slot": "PG", "line": L(30)}, {"player": "b1", "slot": "SG", "line": L(25)}],
           "2": [{"player": "a2", "slot": "PG", "line": None}]}
    imported.merge_import("week", {"week": 1, "pairs": [["1", "2"]], "official": {}, "players": {},
                                   "dates": ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"],
                                   "days": {"2026-10-24": day}})
    imported.merge_import("transactions", {"rows": [
        {"ts": "Oct 24, 1:00 am", "team": "1", "moves": [{"player": pl("b1"), "action": "trade", "source": ""}]},
        {"ts": "Oct 24, 1:00 am", "team": "2", "moves": [{"player": pl("a2"), "action": "trade", "source": ""}]},
    ]})
    r = analysis.moves_report(imported.ImportedProvider())
    assert len(r["trades"]) == 1
    sides = r["trades"][0]["sides"]
    assert sides[0]["team"] == "1" and sides[0]["value"] > sides[1]["value"] == 0
    assert sides[0]["players"][0]["active_games"] == 1


def test_readd_same_player_is_not_double_counted(tmp_path, monkeypatch):
    p = _store(tmp_path, monkeypatch)       # the fixture adds a1 twice at the same time
    r = analysis.moves_report(p)
    a1 = [x for x in r["pickups"] if x["player"]["key"] == "a1"]
    assert sorted(x["games"] for x in a1) == [0, 3]


def _with_schedule(tmp_path, monkeypatch):
    from datetime import date, timedelta
    _store(tmp_path, monkeypatch)
    today = date.today()
    days = [today + timedelta(days=i) for i in range(14)]
    md = [f"{d.month}/{d.day}" for d in days]
    pl = lambda k, nba, st="": {"id": k, "nba_team": nba, "status": st}
    row = lambda k, nba, slot, games, st="": {"player": pl(k, nba, st), "slot": slot, "games": games}
    every, never = [True] * 14, [False] * 14
    imported.merge_import("schedule", {"dates": md, "teams": {
        "1": [row("a1", "AAA", "PG", every), row("a2", "BBB", "IL", every)],
        "2": [row("b1", "CCC", "PG", every), row("b2", "DDD", "BN", never, "O")]}})
    iso = [d.isoformat() for d in days]
    imported.merge_import("week", {"week": 2, "pairs": [["1", "2"]], "dates": iso[:7], "official": {}, "days": {}, "players": {}})
    imported.merge_import("meta", {"league_id": "1", "current_week": 2})
    return imported.ImportedProvider()


def test_power_rankings(tmp_path, monkeypatch):
    from backend import rankings
    p = _with_schedule(tmp_path, monkeypatch)
    r = rankings.power(p)
    assert r["available"] and r["weeks"] == [1]
    assert [t["rank"] for t in r["teams"]] == [1, 2]
    top = r["teams"][0]
    assert 0 <= top["power"] <= 100 and top["prev_rank"] is None
    assert sum(t["allplay"][0] for t in r["teams"]) == sum(t["allplay"][1] for t in r["teams"])
    assert all(t["record"] == t["allplay"] for t in r["teams"])   # two teams: all-play is the real schedule


def test_alternative_standings(tmp_path, monkeypatch):
    from backend import rankings
    p = _with_schedule(tmp_path, monkeypatch)
    r = rankings.standings(p)
    assert r["available"] and r["n"] == 2 and r["weeks_done"] == [1]
    by = {t["team"]: t for t in r["teams"]}
    # two teams, nine categories: roto points per category are 2 and 1 (or 1.5 each when tied)
    assert by["1"]["roto"]["points"] + by["2"]["roto"]["points"] == 9 * 3
    assert all(c["points"] in (1, 1.5, 2) for c in by["1"]["roto"]["cats"].values())
    assert by["1"]["one_win"]["record"][0] + by["1"]["one_win"]["record"][1] + by["1"]["one_win"]["record"][2] == 1
    assert sum(by["1"]["h2h"]["record"]) == 9
    assert by["1"]["h2h"]["record"][0] == by["2"]["h2h"]["record"][1]
    assert {by["1"]["points"]["rank"], by["2"]["points"]["rank"]} == {1, 2}
