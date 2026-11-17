"""FastAPI app: JSON API + static frontend.

Run:  uvicorn backend.app:app --reload
Demo mode is used unless YAHOO_CLIENT_ID / YAHOO_LEAGUE_ID are set (or DEMO=1)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analysis, engine, forecast, imported

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
    # None = let the app choose (worst players to drop, best free agents to add)
    drops_a: list[str] | None = None
    drops_b: list[str] | None = None
    adds_a: list[str] | None = None
    adds_b: list[str] | None = None


def _roster_limits():
    """(regular roster spots, {team: players currently parked in IL slots})"""
    p = P()
    cap = p.roster_capacity() if hasattr(p, "roster_capacity") else 13
    il = p.il_players() if hasattr(p, "il_players") else {}
    return cap, il


@app.post("/api/trade")
def trade(req: TradeReq):
    if not req.give_a and not req.give_b:
        raise HTTPException(400, "En az bir oyuncu seç.")
    lg = P().league()
    rosters = P().rosters()
    rostered = {p for ps in rosters.values() for p in ps}
    free = [k for k in (P().free_agents() if hasattr(P(), "free_agents") else []) if k not in rostered]
    keys = sorted(rostered | set(req.give_a) | set(req.give_b) | set(free))
    season = P().averages(keys, "season")
    avgs = season if req.period == "season" else P().averages(keys, req.period)
    # free agents only have season averages: fall back to them
    for k in free:
        if not avgs.get(k, {}).get("GP"):
            avgs[k] = season.get(k, {"GP": 0})
    # z-scores always use season averages of rostered players as the reference pool
    pool = {k: season[k] for k in rostered if season.get(k, {}).get("GP")}
    is_points = lg["scoring"] == "points"
    zmodel = None if is_points else engine.build_z_model(pool, lg)

    def value(k):
        avg = avgs.get(k) or {}
        if not avg.get("GP"):
            return None
        return engine.fantasy_points(avg, lg) if is_points else engine.player_z(avg, lg, zmodel)["TOTAL"]

    cap, il = _roster_limits()
    free_ranked = sorted((k for k in free if season.get(k, {}).get("GP", 0) >= 3 and value(k) is not None),
                         key=value, reverse=True)

    def balance(team, give, receive, drops_req, adds_req, taken):
        """How many players the team must drop / may add, with suggestions."""
        il_now = set(il.get(team, []))
        regular = [p for p in rosters[team] if p not in il_now]
        after = [p for p in regular if p not in give] + [p for p in receive if p not in regular]
        need = max(0, len(after) - cap)
        freed = max(0, len(give) - len(receive))
        room = min(freed, max(0, cap - len(after)))
        # drop candidates: everyone on the roster after the trade, worst first. Players with no
        # games in the period (injured) go last: no data is not a reason to cut someone.
        cands = sorted(after, key=lambda k: (value(k) is None, value(k) or 0.0))
        drops = [k for k in (drops_req or []) if k in after][:need] if drops_req is not None else []
        for k in cands:
            if len(drops) >= need:
                break
            if k not in drops:
                drops.append(k)
        options = [k for k in free_ranked if k not in taken][:25]
        if adds_req is not None:
            adds = [k for k in adds_req if k in free and k not in taken][:room]
        else:
            adds = options[:room]
        taken.update(adds)
        return {"team": team, "need_drop": need, "room": room, "drops": drops, "adds": adds,
                "drop_options": [{"key": k, "value": value(k)} for k in cands],
                "add_options": [{"key": k, "value": value(k)} for k in options],
                "il": sorted(il_now)}

    taken: set = set()
    bal_a = balance(req.team_a, req.give_a, req.give_b, req.drops_a, req.adds_a, taken)
    bal_b = balance(req.team_b, req.give_b, req.give_a, req.drops_b, req.adds_b, taken)

    result = engine.evaluate_trade(lg, rosters, avgs, req.team_a, req.give_a, req.team_b, req.give_b, pool,
                                   drops_a=bal_a["drops"], drops_b=bal_b["drops"],
                                   adds_a=bal_a["adds"], adds_b=bal_b["adds"])
    result["balance"] = {"a": bal_a, "b": bal_b, "capacity": cap, "has_free_agents": bool(free_ranked)}
    info_keys = set(req.give_a + req.give_b)
    for b in (bal_a, bal_b):
        info_keys |= set(b["drops"]) | set(b["adds"]) | {o["key"] for o in b["drop_options"]} | {o["key"] for o in b["add_options"]}
    result["info"] = P().player_info(sorted(info_keys))
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


@app.get("/api/allplay")
def allplay(team: str):
    """Every week of the season for one team: its score against every other team's week."""
    lg = P().league()
    others = [t["key"] for t in lg["teams"] if t["key"] != team]
    if len(others) == len(lg["teams"]):
        raise HTTPException(404, "Takım bulunamadı.")
    today = forecast.today_et()
    weeks = []
    for w in lg["weeks"]:
        try:
            wk = P().week(w["week"], [t["key"] for t in lg["teams"]])
        except KeyError:
            continue
        played = [d for d in wk["days"] if any(d["stats"].get(e["player"]) for e in d["lineups"].get(team, []))]
        if not played:
            continue
        weeks.append({"week": w["week"], "start": w["start"], "end": w["end"], "complete": w["end"] < today,
                      "real_opponent": _real_opponent(w["week"], team),
                      "rows": engine.versus_all(lg, wk, team, others)})
    return {"team": team, "league": lg["name"], "scoring": lg["scoring"],
            "teams": [t for t in lg["teams"] if t["key"] != team], "weeks": weeks}


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


def _report(fn):
    if not isinstance(P(), imported.ImportedProvider):
        return {"available": False, "reason": "demo"}
    return fn(P())


@app.get("/api/draft")
def draft():
    return _report(analysis.draft_report)


@app.get("/api/moves")
def moves():
    return _report(analysis.moves_report)


_cache: dict = {}


def _cached(name, fn):
    """Simulations take a moment: reuse the result until new data is imported."""
    if not isinstance(P(), imported.ImportedProvider):
        return {"available": False, "reason": "demo"}
    stamp = (P().store.get("last_import"), forecast.today_et())
    if _cache.get(name, (None,))[0] != stamp:
        _cache[name] = (stamp, fn(P()))
    return _cache[name][1]


@app.get("/api/forecast")
def get_forecast():
    return _cached("forecast", forecast.forecast)


@app.get("/api/power")
def get_power():
    return _cached("power", forecast.power)


@app.get("/api/standings")
def get_standings():
    return _cached("standings", forecast.standings)


# ---------------------------------------------------------------- web UI (Vite build in web/dist)
DIST = ROOT / "web" / "dist"
NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>Takas Masası</title>
<body style="font:16px/1.5 system-ui;max-width:560px;margin:60px auto;padding:0 20px">
<h2>Arayüz henüz derlenmemiş</h2>
<p>Bir kez şu komutları çalıştır, sonra bu sayfayı yenile:</p>
<pre style="background:#f5f8fa;padding:12px;border-radius:8px">cd web
npm install
npm run build</pre></body>"""

if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/favicon.svg", include_in_schema=False)
@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(ROOT / "web" / "public" / "favicon.svg", media_type="image/svg+xml")


@app.get("/")
def index():
    if not (DIST / "index.html").exists():
        return HTMLResponse(NOT_BUILT, status_code=503)
    # never cache the entry page: it points at the current hashed asset files
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
