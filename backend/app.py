"""FastAPI app: JSON API + static frontend.

Run:  uvicorn backend.app:app --reload
Demo mode is used unless YAHOO_CLIENT_ID / YAHOO_LEAGUE_ID are set (or DEMO=1)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import engine, imported

load_dotenv()
ROOT = Path(__file__).resolve().parent.parent


def make_provider():
    """Priority: DEMO=1 -> demo; extension data -> imported; Yahoo API keys -> yahoo; else demo."""
    if os.environ.get("DEMO") == "1":
        from .demo import DemoProvider
        return DemoProvider()
    if imported.DATA_FILE.exists():
        try:
            return imported.ImportedProvider()
        except RuntimeError:
            pass
    if os.environ.get("YAHOO_CLIENT_ID") and os.environ.get("YAHOO_LEAGUE_ID"):
        from .yahoo import YahooProvider
        return YahooProvider()
    from .demo import DemoProvider
    return DemoProvider()


_provider = make_provider()


def P():
    return _provider


app = FastAPI(title="Fantasy Takas & Ya Olsaydı")


# ---------------------------------------------------------------- browser extension import
# The extension posts from a chrome-extension:// page that has host permission for
# 127.0.0.1, so no CORS headers are needed.

@app.get("/api/import/status")
def import_status(league_id: str | None = None):
    return imported.status(league_id)


class ImportReq(BaseModel):
    kind: str
    data: dict


@app.post("/api/import")
def do_import(req: ImportReq):
    global _provider
    try:
        imported.merge_import(req.kind, req.data)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, f"Geçersiz veri: {e}")
    if os.environ.get("DEMO") != "1":
        _provider = imported.ImportedProvider()
    return {"ok": True}


@app.get("/api/league")
def league():
    lg = P().league()
    rosters = P().rosters()
    keys = [p for ps in rosters.values() for p in ps]
    return {"league": lg, "rosters": rosters, "players": P().player_info(keys)}


@app.get("/api/search")
def search(q: str):
    if len(q.strip()) < 2:
        return []
    return P().search(q)


class TradeReq(BaseModel):
    team_a: str
    give_a: list[str]
    team_b: str
    give_b: list[str]
    period: str = "season"


@app.post("/api/trade")
def trade(req: TradeReq):
    if not req.give_a and not req.give_b:
        raise HTTPException(400, "En az bir oyuncu seç.")
    lg = P().league()
    rosters = P().rosters()
    keys = {p for ps in rosters.values() for p in ps} | set(req.give_a) | set(req.give_b)
    avgs = P().averages(sorted(keys), req.period)
    # z-scores always use season averages of rostered players as the reference pool
    pool_src = avgs if req.period == "season" else P().averages(sorted(keys), "season")
    pool = {k: v for k, v in pool_src.items() if v.get("GP")}
    result = engine.evaluate_trade(lg, rosters, avgs, req.team_a, req.give_a, req.team_b, req.give_b, pool)
    result["info"] = P().player_info(req.give_a + req.give_b)
    return result


def _active_slots() -> int:
    return P().active_slots() if hasattr(P(), "active_slots") else 10


def _week_all(week: int):
    """Week data for every team in the league (needed for 'versus everyone')."""
    lg = P().league()
    try:
        return lg, P().week(week, [t["key"] for t in lg["teams"]])
    except KeyError as e:
        raise HTTPException(404, str(e))


def _real_opponent(week: int, team: str):
    return next((m[1] if m[0] == team else m[0] for m in P().matchups(week) if team in m), None)


@app.get("/api/week/{week}")
def week(week: int, team: str, opponent: str | None = None):
    """A team's week: result vs the chosen (default: real) opponent, daily lineup grid,
    and how the same week would have gone against every other team."""
    lg, wk = _week_all(week)
    real_opp = _real_opponent(week, team)
    opp = opponent or real_opp
    if not opp or opp == team:
        raise HTTPException(404, "Bu hafta eşleşme bulunamadı.")
    res = engine.what_if(lg, wk, team, opp, [])

    keys, usage, grid = set(), {}, {}
    for t in (team, opp):
        rows = {}
        for d in wk["days"]:
            for e in d["lineups"].get(t, []):
                keys.add(e["player"])
                line = d["stats"].get(e["player"])
                active = e["slot"] not in engine.INACTIVE_SLOTS
                u = usage.setdefault(e["player"], {"team": t, "active_games": 0, "bench_games": 0})
                if line:
                    u["active_games" if active else "bench_games"] += 1
                rows.setdefault(e["player"], {})[d["date"]] = {
                    "slot": e["slot"], "active": active, "played": bool(line),
                    "pts": line.get("PTS") if line else None}
        grid[t] = rows

    official = None
    if opp == real_opp and hasattr(P(), "official"):
        off = P().official(week)
        if team in off and opp in off:
            official = engine.head_to_head(off[team], off[opp], lg)
    others = [t["key"] for t in lg["teams"] if t["key"] != team]
    return {"week": week, "start": wk["start"], "end": wk["end"], "dates": [d["date"] for d in wk["days"]],
            "team": team, "opponent": opp, "real_opponent": real_opp,
            "result": res["actual"], "official": official, "players": P().player_info(sorted(keys)),
            "usage": usage, "grid": grid, "versus": engine.versus_all(lg, wk, team, others),
            "active_slots": _active_slots()}


class Edit(BaseModel):
    team: str
    type: str = "swap"            # swap | bench | start
    out: str | None = None
    into: str | None = None
    player: str | None = None
    dates: list[str] | None = None


class WhatIfReq(BaseModel):
    week: int
    team: str
    opponent: str
    edits: list[Edit] = []


@app.post("/api/whatif")
def whatif(req: WhatIfReq):
    lg, wk = _week_all(req.week)
    known = {p for d in wk["days"] for p in d["stats"]}
    edits = []
    for e in req.edits:
        if e.type == "swap":
            if not e.out or not e.into:
                raise HTTPException(400, "Değişiklikte çıkan ve giren oyuncu olmalı.")
            edits.append({"team": e.team, "type": "swap", "out": e.out, "in": e.into, "dates": e.dates})
        elif e.type in ("bench", "start") and e.player:
            edits.append({"team": e.team, "type": e.type, "player": e.player, "dates": e.dates})
        else:
            raise HTTPException(400, f"Geçersiz değişiklik: {e.type}")
    extra = {e["in"]: P().player_week_stats(e["in"], req.week)
             for e in edits if e["type"] == "swap" and e["in"] not in known}
    res = engine.what_if(lg, wk, req.team, req.opponent, edits, extra, _active_slots())
    res["info"] = P().player_info(list(res["players"]))
    others = [t["key"] for t in lg["teams"] if t["key"] != req.team]
    res["versus"] = engine.versus_all(lg, wk, req.team, others, edits, extra)
    return res


app.mount("/static", StaticFiles(directory=ROOT / "frontend"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "frontend" / "index.html")
