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


@app.get("/api/week/{week}")
def week(week: int, team: str):
    """Actual lineup/result for a team's matchup that week."""
    lg = P().league()
    opp = next((m[1] if m[0] == team else m[0] for m in P().matchups(week) if team in m), None)
    if not opp:
        raise HTTPException(404, "Bu hafta eşleşme bulunamadı.")
    try:
        wk = P().week(week, [team, opp])
    except KeyError as e:
        raise HTTPException(404, str(e))
    keys = sorted({e["player"] for d in wk["days"] for t in (team, opp) for e in d["lineups"][t]})
    res = engine.what_if(lg, wk, team, opp, [])
    # per-player summary of the week (active vs bench totals) for the UI
    summary = {}
    for t in (team, opp):
        for d in wk["days"]:
            for e in d["lineups"][t]:
                s = summary.setdefault(e["player"], {"team": t, "active_games": 0, "bench_games": 0})
                line = d["stats"].get(e["player"])
                if line:
                    s["active_games" if e["slot"] not in engine.INACTIVE_SLOTS else "bench_games"] += 1
    official = None
    if hasattr(P(), "official"):
        off = P().official(week)
        if team in off and opp in off:
            official = engine.head_to_head(off[team], off[opp], lg)
    return {"week": week, "start": wk["start"], "end": wk["end"], "team": team, "opponent": opp,
            "result": res["actual"], "official": official, "players": P().player_info(keys), "usage": summary}


class Swap(BaseModel):
    team: str
    out: str
    into: str


class WhatIfReq(BaseModel):
    week: int
    team: str
    opponent: str
    swaps: list[Swap]


@app.post("/api/whatif")
def whatif(req: WhatIfReq):
    lg = P().league()
    wk = P().week(req.week, [req.team, req.opponent])
    known = {p for d in wk["days"] for p in d["stats"]}
    extra = {s.into: P().player_week_stats(s.into, req.week) for s in req.swaps if s.into not in known}
    swaps = [{"team": s.team, "out": s.out, "in": s.into} for s in req.swaps]
    res = engine.what_if(lg, wk, req.team, req.opponent, swaps, extra)
    res["info"] = P().player_info(list(res["players"]))
    return res


app.mount("/static", StaticFiles(directory=ROOT / "frontend"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "frontend" / "index.html")
