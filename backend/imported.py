"""Provider backed by data the browser extension scraped from Yahoo pages.

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

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "league.json"

RATIOS = {"FG%": ["FGM", "FGA"], "FT%": ["FTM", "FTA"], "3PT%": ["3PTM", "3PTA"]}
LOWER_IS_BETTER = {"TO", "PF"}
LABELS = {"ST": "STL"}


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
        for pid, p in data["players"].items():
            store["players"][pid] = {**store["players"].get(pid, {}), **{k: v for k, v in p.items() if k != "owner"}}
    elif kind == "meta":
        # light refresh of league basics (current week etc.) without touching rosters/averages
        if not store.get("base") or store["base"].get("league_id") != data.get("league_id"):
            raise ValueError("no base data for this league yet")
        store["base"].update({k: v for k, v in data.items() if k not in ("rosters", "players", "averages")})
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
    save(store)
    return store


def status(league_id: str | None = None) -> dict:
    store = load()
    base = store.get("base")
    if not base or (league_id and base.get("league_id") != league_id):
        return {"league_id": None, "dates": [], "weeks": [], "final_weeks": [], "synced_at": None}
    # weeks that never need to be read again: official totals are final and every day is stored
    final = sorted(int(w) for w, v in store["weeks"].items()
                   if v.get("final") and v["dates"] and all(d in store["days"] for d in v["dates"]))
    return {"league_id": base["league_id"], "dates": sorted(store["days"]),
            "weeks": sorted(int(w) for w in store["weeks"]), "final_weeks": final,
            "synced_at": base.get("synced_at")}


class ImportedProvider:
    is_demo = False

    def __init__(self):
        self.store = load()
        if not self.store.get("base"):
            raise RuntimeError("Henüz veri yok. Eklentiyle senkronize et.")
        self.base = self.store["base"]
        if "Points" in (self.base.get("scoring_type") or ""):
            raise RuntimeError("Puan bazlı ligler eklenti modunda henüz desteklenmiyor.")

    def league(self) -> dict:
        cats = [{"key": c, "label": LABELS.get(c, c), "higher": c not in LOWER_IS_BETTER,
                 **({"ratio": RATIOS[c]} if c in RATIOS else {})} for c in self.base["categories"]]
        weeks = [{"week": int(w), "start": v["dates"][0], "end": v["dates"][-1]}
                 for w, v in sorted(self.store["weeks"].items(), key=lambda x: int(x[0])) if v["dates"]]
        return {"key": self.base["league_id"], "name": self.base["name"], "scoring": "categories",
                "categories": cats, "modifiers": {}, "current_week": self.base["current_week"],
                "my_team": self.base["my_team"],
                "teams": [{"key": t["id"], "name": t["name"], "manager": ""} for t in self.base["teams"]],
                "weeks": weeks, "demo": False, "synced_at": self.base.get("synced_at")}

    def rosters(self) -> dict:
        return {t: list(ps) for t, ps in self.base["rosters"].items()}

    def player_info(self, keys) -> dict:
        owners = {p: t for t, ps in self.base["rosters"].items() for p in ps}
        out = {}
        for k in keys:
            p = self.store["players"].get(k)
            if p:
                out[k] = {"key": k, "name": p.get("name", k), "nba_team": p.get("nba_team", ""),
                          "positions": p.get("positions", []), "status": p.get("status", ""),
                          "owner": owners.get(k)}
        return out

    def averages(self, keys, period: str = "season") -> dict:
        src = self.base["averages"].get(period, {})
        return {k: dict(src.get(k) or {"GP": 0}) for k in keys}

    def matchups(self, week: int) -> list[list[str]]:
        return self.store["weeks"].get(str(week), {}).get("pairs", [])

    def official(self, week: int) -> dict:
        return self.store["weeks"].get(str(week), {}).get("official", {})

    def week(self, week: int, teams: list[str]) -> dict:
        info = self.store["weeks"].get(str(week))
        if not info:
            raise KeyError(f"{week}. hafta senkronize edilmemiş.")
        days = []
        for d in info["dates"]:
            day = self.store["days"].get(d, {})
            lineups, stats = {}, {}
            for t in teams:
                rows = day.get(t, [])
                lineups[t] = [{"player": r["player"], "slot": r["slot"]} for r in rows]
                for r in rows:
                    stats[r["player"]] = r["line"]
            days.append({"date": d, "lineups": lineups, "stats": stats})
        return {"week": week, "start": info["dates"][0], "end": info["dates"][-1], "days": days}

    def player_week_stats(self, key: str, week: int) -> dict:
        """Only available for days the player was on some league roster."""
        info = self.store["weeks"].get(str(week), {})
        out = {}
        for d in info.get("dates", []):
            out[d] = None
            for rows in self.store["days"].get(d, {}).values():
                hit = next((r for r in rows if r["player"] == key), None)
                if hit:
                    out[d] = hit["line"]
                    break
        return out

    def search(self, query: str, limit: int = 15) -> list[dict]:
        q = query.lower().strip()
        hits = [k for k, p in self.store["players"].items() if q in p.get("name", "").lower()]
        return list(self.player_info(hits[:limit]).values())
