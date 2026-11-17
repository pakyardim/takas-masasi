"""Storage for the data the browser extension reads from Yahoo pages.

The web app loads this file directly and does all calculations in the browser;
this module only merges incoming syncs into it.

Storage: data/league.json
{
  "base":  {league_id, name, scoring_type, categories, teams, my_team, current_week,
            rosters, players, averages{season,last30,last14,last7}, synced_at},
  "weeks": {"4": {"pairs": [[a,b],...], "dates": [...], "official": {team: totals}}},
  "days":  {"2026-11-10": {team_id: [{player, slot, line}]}},
  "players": {id: {id, name, nba_team, positions, status}}
}
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = Path(os.environ.get("TAKAS_DATA_FILE") or ROOT / "data" / "league.json")

LOGO_DIR = DATA_FILE.parent / "logos"
LOGO_HOSTS = ("s.yimg.com", "yahoofantasysports-res.cloudinary.com")     # Yahoo's image CDNs only
LOGO_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}


def _download_logo(url: str) -> tuple[bytes, str] | None:
    """Fetch a team picture from Yahoo's CDN. Returns (bytes, extension) or None."""
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in LOGO_HOSTS:
        return None
    # uploaded pictures are served at 90px by default; a 192px rendition exists
    candidates = [url.replace("/t_s90sq/", "/t_s192sq/"), url] if "/t_s90sq/" in url else [url]
    for c in candidates:
        try:
            r = requests.get(c, timeout=10, allow_redirects=False)
        except requests.RequestException:
            continue
        ext = LOGO_TYPES.get(r.headers.get("content-type", "").split(";")[0].strip())
        if r.status_code == 200 and ext and 0 < len(r.content) <= 2_000_000:
            return r.content, ext
    return None


def _sync_logos(store: dict, league_id: str, teams: list[dict]):
    """Download team pictures whose URL is new; keep the files next to the data."""
    logos = store.setdefault("logos", {})
    for t in teams:
        url, tid = t.get("logo"), str(t.get("id", ""))
        if not url or not tid.isdigit():
            continue
        cur = logos.get(tid)
        if cur and cur["url"] == url and (LOGO_DIR / cur["file"]).exists():
            continue
        got = _download_logo(url)
        if not got:
            continue
        data, ext = got
        LOGO_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{league_id}_{tid}.{ext}"
        (LOGO_DIR / name).write_bytes(data)
        logos[tid] = {"url": url, "file": name, "v": hashlib.sha1(data).hexdigest()[:8]}


def load() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return {"base": None, "weeks": {}, "days": {}, "players": {}}


def save(store: dict):
    DATA_FILE.parent.mkdir(exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, ensure_ascii=False))
    tmp.replace(DATA_FILE)


def merge_import(kind: str, data: dict) -> dict:
    store = load()
    if kind == "base":
        old = store.get("base")
        if old and old.get("league_id") != data.get("league_id"):
            store = {"base": None, "weeks": {}, "days": {}, "players": {}}   # different league -> start over
        store["base"] = data
        _sync_logos(store, data.get("league_id", ""), data.get("teams", []))
        for pid, p in data["players"].items():
            store["players"][pid] = {**store["players"].get(pid, {}), **{k: v for k, v in p.items() if k != "owner"}}
    elif kind == "meta":
        # light refresh of league basics (current week etc.) without touching rosters/averages
        if not store.get("base") or store["base"].get("league_id") != data.get("league_id"):
            raise ValueError("no base data for this league yet")
        store["base"].update({k: v for k, v in data.items() if k not in ("rosters", "players", "averages")})
        _sync_logos(store, data.get("league_id", ""), data.get("teams", []))
    elif kind == "draft":
        names = {t["name"]: t["id"] for t in (store.get("base") or {}).get("teams", [])}
        store["draft"] = [{"round": x["round"], "pick": x["pick"], "overall": x["overall"],
                           "player": x["player"]["id"], "team": names.get(x["team_name"]),
                           "team_name": x["team_name"]} for x in data["picks"]]
        for x in data["picks"]:
            store["players"][x["player"]["id"]] = {**x["player"], **store["players"].get(x["player"]["id"], {})}
    elif kind == "transactions":
        txs = store.setdefault("transactions", {})
        if data.get("complete"):
            store["tx_complete"] = True
        for row in data["rows"]:
            key = tx_key(row)
            txs[key] = {"key": key, "ts": row["ts"], "date": _tx_date(row["ts"]), "team": row["team"],
                        "moves": [{"player": m["player"]["id"], "action": m["action"], "source": m.get("source", "")}
                                  for m in row["moves"]]}
            for m in row["moves"]:
                store["players"][m["player"]["id"]] = {**m["player"], **store["players"].get(m["player"]["id"], {})}
    elif kind == "pool":
        # league-wide season averages (free agents included); replaces the previous pool
        store["pool"] = data["averages"]
        store["pool_at"] = data.get("synced_at")
        for pid, pl in data["players"].items():
            store["players"][pid] = {**store["players"].get(pid, {}), **pl}
    elif kind == "schedule":
        # data: {dates: ["11/16", ...], teams: {tid: [{player, slot, games: [bool]}]}}
        dates = [_near_date(d) for d in data["dates"]]
        sched = store.setdefault("schedule", {})          # nba team -> sorted game dates
        lineup = {}
        for tid, rows in data["teams"].items():
            lineup[tid] = [{"player": r["player"]["id"], "slot": r["slot"]} for r in rows]
            for r in rows:
                pid, nba = r["player"]["id"], r["player"].get("nba_team")
                store["players"][pid] = {**store["players"].get(pid, {}), **r["player"]}
                if nba:
                    keep = [d for d in sched.get(nba, []) if d < dates[0] or d > dates[-1]]
                    sched[nba] = sorted(set(keep) | {d for d, g in zip(dates, r["games"]) if g})
        store["lineup_now"] = lineup
        store["schedule_range"] = [dates[0], dates[-1]]
        store["schedule_at"] = data.get("synced_at")
    elif kind == "week":
        w = str(data["week"])
        # final = Yahoo's official totals were read after the week (and its stat corrections) was over
        store["weeks"][w] = {"pairs": data["pairs"], "dates": data["dates"], "official": data.get("official", {}),
                             "final": bool(data.get("final"))}
        for d, teams in data["days"].items():
            store["days"][d] = teams
        for pid, p in data["players"].items():
            store["players"][pid] = {**store["players"].get(pid, {}), **p}
    else:
        raise ValueError(f"unknown import kind {kind}")
    store["last_import"] = datetime.now(timezone.utc).isoformat()
    save(store)
    return store


def tx_key(row: dict) -> str:
    return f'{row["ts"]}|{row["team"]}|' + ",".join(sorted(
        (m["player"]["id"] if isinstance(m["player"], dict) else m["player"]) for m in row["moves"]))


_MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def _tx_date(ts: str, today: date | None = None) -> str:
    """'Nov 17, 3:47 am' -> ISO date. Yahoo prints no year: take the most recent
    such date that is not in the future."""
    today = today or date.today()
    mon, day = ts.split(",")[0].split()
    d = date(today.year, _MONTHS[mon], int(day))
    if d > today + timedelta(days=1):
        d = d.replace(year=today.year - 1)
    return d.isoformat()


def _near_date(md: str, today: date | None = None) -> str:
    """'11/16' -> ISO date in the year that puts it closest to today."""
    today = today or date.today()
    m, d = (int(x) for x in md.split("/"))
    cands = [date(y, m, d) for y in (today.year - 1, today.year, today.year + 1)]
    return min(cands, key=lambda c: abs((c - today).days)).isoformat()


def status(league_id: str | None = None) -> dict:
    store = load()
    base = store.get("base")
    if not base or (league_id and base.get("league_id") != league_id):
        return {"league_id": None, "dates": [], "weeks": [], "final_weeks": [], "synced_at": None,
                "has_draft": False, "tx_keys": [], "tx_complete": False, "pool_at": None}
    # weeks that never need to be read again: official totals are final and every day is stored
    final = sorted(int(w) for w, v in store["weeks"].items()
                   if v.get("final") and v["dates"] and all(d in store["days"] for d in v["dates"]))
    return {"league_id": base["league_id"], "dates": sorted(store["days"]),
            "weeks": sorted(int(w) for w in store["weeks"]), "final_weeks": final,
            "synced_at": base.get("synced_at"), "has_draft": bool(store.get("draft")),
            "tx_keys": sorted(store.get("transactions", {})), "tx_complete": bool(store.get("tx_complete")),
            "pool_at": store.get("pool_at")}
