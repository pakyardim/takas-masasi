from backend import engine, imported


def _payloads():
    line = lambda pts, fgm, fga: {"PTS": pts, "FGM": fgm, "FGA": fga, "FTM": 1, "FTA": 2, "3PTM": 1,
                                  "REB": 3, "AST": 2, "ST": 1, "BLK": 0, "TO": 1}
    base = {
        "league_id": "1", "name": "Test", "scoring_type": "Head-to-Head - Categories",
        "categories": ["FG%", "FT%", "3PTM", "PTS", "REB", "AST", "ST", "BLK", "TO"],
        "teams": [{"id": "1", "name": "A"}, {"id": "2", "name": "B"}], "my_team": "1", "current_week": 1,
        "rosters": {"1": ["10", "11"], "2": ["20"]},
        "players": {k: {"id": k, "name": f"P{k}", "nba_team": "X", "positions": ["PG"], "status": "", "owner": o}
                    for k, o in [("10", "1"), ("11", "1"), ("20", "2")]},
        "averages": {p: {k: {"GP": 5, **line(10, 4, 9)} for k in ("10", "11", "20")}
                     for p in ("season", "last30", "last14", "last7")},
    }
    week = {
        "week": 1, "pairs": [["1", "2"]], "dates": ["2026-10-20"],
        "official": {"1": line(10, 4, 8), "2": line(20, 8, 16)},
        "days": {"2026-10-20": {
            "1": [{"player": "10", "slot": "PG", "line": line(10, 4, 8)}, {"player": "11", "slot": "BN", "line": line(30, 12, 20)}],
            "2": [{"player": "20", "slot": "C", "line": line(20, 8, 16)}],
        }},
        "players": {},
    }
    return base, week


def test_import_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(imported, "DATA_FILE", tmp_path / "league.json")
    base, week = _payloads()
    imported.merge_import("base", base)
    imported.merge_import("week", week)
    assert imported.status("1")["dates"] == ["2026-10-20"]

    p = imported.ImportedProvider()
    lg = p.league()
    assert [c["key"] for c in lg["categories"]][0] == "FG%" and lg["categories"][0]["ratio"] == ["FGM", "FGA"]
    assert next(c for c in lg["categories"] if c["key"] == "TO")["higher"] is False
    assert lg["weeks"] == [{"week": 1, "start": "2026-10-20", "end": "2026-10-20"}]

    wk = p.week(1, ["1", "2"])
    res = engine.what_if(lg, wk, "1", "2", [{"team": "1", "out": "10", "in": "11"}])
    assert res["actual"]["result"] == "L" and res["hypothetical"]["categories"][3]["a"] == 30

    off = p.official(1)
    assert engine.head_to_head(off["1"], off["2"], lg)["score"] == res["actual"]["score"]
    assert p.player_week_stats("20", 1)["2026-10-20"]["PTS"] == 20


def test_new_league_resets(tmp_path, monkeypatch):
    monkeypatch.setattr(imported, "DATA_FILE", tmp_path / "league.json")
    base, week = _payloads()
    imported.merge_import("base", base)
    imported.merge_import("week", week)
    imported.merge_import("base", {**base, "league_id": "2"})
    assert imported.status()["dates"] == []
