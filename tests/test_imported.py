from backend import imported


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

    store = imported.load()
    assert store["weeks"]["1"]["dates"] == ["2026-10-20"] and store["weeks"]["1"]["final"] is False
    day = store["days"]["2026-10-20"]
    assert [r["player"] for r in day["1"]] == ["10", "11"] and day["1"][1]["slot"] == "BN"
    assert store["players"]["20"]["name"] == "P20" and "owner" not in store["players"]["20"]
    assert store["last_import"]


def test_new_league_resets(tmp_path, monkeypatch):
    monkeypatch.setattr(imported, "DATA_FILE", tmp_path / "league.json")
    base, week = _payloads()
    imported.merge_import("base", base)
    imported.merge_import("week", week)
    imported.merge_import("base", {**base, "league_id": "2"})
    assert imported.status()["dates"] == []


def test_final_weeks_and_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(imported, "DATA_FILE", tmp_path / "league.json")
    base, week = _payloads()
    imported.merge_import("base", base)
    imported.merge_import("week", {**week, "days": {}, "final": True})
    assert imported.status("1")["final_weeks"] == []          # final but its day is not stored yet
    imported.merge_import("week", {**week, "final": True})
    assert imported.status("1")["final_weeks"] == [1]
    imported.merge_import("week", {**week, "week": 2, "dates": ["2026-10-27"], "days": {}})
    assert imported.status("1")["final_weeks"] == [1]         # week 2 is not final

    imported.merge_import("meta", {"league_id": "1", "current_week": 7, "rosters": {"x": []}})
    b = imported.load()["base"]
    assert b["current_week"] == 7 and b["rosters"] == base["rosters"]


def test_team_logos_downloaded_once_from_allowed_hosts(tmp_path, monkeypatch):
    monkeypatch.setattr(imported, "DATA_FILE", tmp_path / "league.json")
    monkeypatch.setattr(imported, "LOGO_DIR", tmp_path / "logos")
    calls = []

    class Resp:
        status_code = 200
        headers = {"content-type": "image/png"}
        content = b"\x89PNG fake"

    def fake_get(url, **kw):
        calls.append(url)
        return Resp()

    monkeypatch.setattr(imported.requests, "get", fake_get)
    base, _ = _payloads()
    base["teams"] = [
        {"id": "1", "name": "A", "logo": "https://yahoofantasysports-res.cloudinary.com/image/upload/t_s90sq/fantasy-logos/x.png"},
        {"id": "2", "name": "B", "logo": "https://evil.example.com/x.png"},
    ]
    imported.merge_import("base", base)
    assert calls == ["https://yahoofantasysports-res.cloudinary.com/image/upload/t_s192sq/fantasy-logos/x.png"]
    logos = imported.load()["logos"]
    assert set(logos) == {"1"} and logos["1"]["file"] == "1_1.png"
    assert (tmp_path / "logos" / "1_1.png").read_bytes() == b"\x89PNG fake"

    imported.merge_import("meta", {"league_id": "1", "teams": base["teams"]})
    assert len(calls) == 1                      # same URL, file exists: not downloaded again
