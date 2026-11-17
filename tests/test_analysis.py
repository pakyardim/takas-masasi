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
    # free agents (replacement level = their average); fa2 was drafted by A and dropped
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
    imported.merge_import("transactions", {"rows": [
        {"ts": "Oct 22, 1:00 am", "team": "1", "moves": [{"player": pl("a1"), "action": "trade", "source": ""}]},
        {"ts": "Oct 22, 1:00 am", "team": "2", "moves": [{"player": pl("b1"), "action": "trade", "source": ""}]},
    ]})
    r = analysis.moves_report(imported.ImportedProvider())
    assert len(r["trades"]) == 1
    sides = r["trades"][0]["sides"]
    assert sides[0]["team"] == "1" and sides[0]["value"] > sides[1]["value"] == 0
