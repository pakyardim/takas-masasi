"""Draft and transaction analysis on synced league data.

Everything is measured with one yardstick, "değer" (value over replacement):

    per game:  z-score total of the player (same z-scores as the trade tab)
               minus the z-score of a replacement-level player
    value   =  that difference summed over games

Replacement level = what the waiver wire offers: the average z-score of the five
best players who are not on any roster (from the league-wide player list).
A player who never plays is worth 0; a below-replacement player who plays is
negative. Because z-scores are linear in the stats, summing single games gives
the same number as (per-game z - replacement) x games.
"""
from __future__ import annotations

from datetime import date, timedelta

from . import engine


class Valuer:
    def __init__(self, provider):
        self.p = provider
        self.store = provider.store
        self.league = provider.league()
        self.rosters = provider.rosters()
        self.owner = {pl: t for t, ps in self.rosters.items() for pl in ps}
        rostered = set(self.owner)
        pool = self.store.get("pool", {})
        season = provider.base["averages"].get("season", {})
        # season per-game averages of everyone we know (rostered players win over the pool copy)
        self.avg = {**{k: v for k, v in pool.items() if v}, **{k: v for k, v in season.items() if v}}
        model_pool = {k: self.avg[k] for k in rostered if self.avg.get(k, {}).get("GP")}
        self.model = engine.build_z_model(model_pool or {k: v for k, v in self.avg.items() if v.get("GP")}, self.league)
        self.z = {k: engine.player_z(v, self.league, self.model)["TOTAL"] for k, v in self.avg.items() if v.get("GP")}
        # replacement level: what the waiver wire offers = mean z of the 5 best unrostered players
        free = sorted((z for k, z in self.z.items() if k not in rostered and self.avg[k]["GP"] >= 3), reverse=True)
        self.has_pool = bool(free)
        if free:
            top = free[:5]
            self.repl = sum(top) / len(top)
        else:   # no free-agent data yet: approximate with the 15th percentile of rostered players
            ranked = sorted(self.z.values(), reverse=True)
            self.repl = ranked[int(len(ranked) * 0.85)] if ranked else 0.0
        # season-to-date value of every known player, and their rank by it
        self.season_value = {k: (z - self.repl) * self.avg[k]["GP"] for k, z in self.z.items()}
        order = sorted(self.season_value, key=self.season_value.get, reverse=True)
        self.value_rank = {k: i + 1 for i, k in enumerate(order)}
        self.dates = sorted(self.store["days"])

    def game_value(self, line: dict) -> float:
        return engine.player_z(line, self.league, self.model)["TOTAL"] - self.repl

    def info(self, pid: str) -> dict:
        p = self.store["players"].get(pid, {})
        return {"key": pid, "name": p.get("name", pid), "nba_team": p.get("nba_team", ""),
                "positions": p.get("positions", []), "status": p.get("status", ""), "owner": self.owner.get(pid)}

    def stint(self, pid: str, team: str, from_date: str) -> dict:
        """What a player produced for a team from (about) a date until he left it.
        Starts at the first stored day on/after from_date-1 where he is on that roster."""
        start = (date.fromisoformat(from_date) - timedelta(days=1)).isoformat()
        out = {"days": 0, "games": 0, "active_games": 0, "value": 0.0, "value_all": 0.0,
               "first": None, "last": None, "ongoing": False}
        on = False
        for d in self.dates:
            if d < start:
                continue
            row = next((r for r in self.store["days"][d].get(team, []) if r["player"] == pid), None)
            if not row:
                if on:
                    break
                if d > (date.fromisoformat(from_date) + timedelta(days=3)).isoformat():
                    break          # never showed up on this roster around that date
                continue
            on = True
            out["first"] = out["first"] or d
            out["last"] = d
            out["days"] += 1
            if row["line"]:
                v = self.game_value(row["line"])
                out["games"] += 1
                out["value_all"] += v
                if row["slot"] not in engine.INACTIVE_SLOTS:
                    out["active_games"] += 1
                    out["value"] += v
        out["ongoing"] = bool(on and self.dates and out["last"] == self.dates[-1] and self.owner.get(pid) == team)
        return out


def draft_report(provider) -> dict:
    store = provider.store
    picks = store.get("draft") or []
    if not picks:
        return {"available": False}
    v = Valuer(provider)
    names = {t["id"]: t["name"] for t in provider.base["teams"]}
    by_value = sorted(v.season_value.values(), reverse=True)
    rows = []
    for x in picks:
        pid = x["player"]
        avg = v.avg.get(pid)
        value = v.season_value.get(pid, 0.0)
        rank = v.value_rank.get(pid)
        # what that draft slot "should" return: the value of the player ranked there today
        expected = by_value[x["overall"] - 1] if x["overall"] <= len(by_value) else 0.0
        rows.append({
            "round": x["round"], "pick": x["pick"], "overall": x["overall"],
            "team": x["team"], "team_name": names.get(x["team"], x["team_name"]),
            "player": v.info(pid), "known": avg is not None, "gp": (avg or {}).get("GP", 0),
            "z": v.z.get(pid), "value": value, "rank": rank,
            "expected": expected, "surplus": value - expected,
            "kept": v.owner.get(pid) == x["team"],
        })
    teams = {}
    for r in rows:
        t = teams.setdefault(r["team"] or r["team_name"], {"team": r["team"], "name": r["team_name"], "total": 0.0,
                                                           "surplus": 0.0, "picks": 0, "kept": 0,
                                                           "best": None, "worst": None})
        t["total"] += r["value"]
        t["surplus"] += r["surplus"]
        t["picks"] += 1
        t["kept"] += r["kept"]
        if r["gp"] and (t["best"] is None or r["surplus"] > t["best"]["surplus"]):
            t["best"] = r
        if t["worst"] is None or r["surplus"] < t["worst"]["surplus"]:
            t["worst"] = r
    ranking = sorted(teams.values(), key=lambda t: t["total"], reverse=True)
    return {"available": True, "has_pool": v.has_pool, "teams": ranking, "picks": rows,
            "unknown": sum(1 for r in rows if not r["known"])}


def moves_report(provider) -> dict:
    store = provider.store
    txs = sorted((store.get("transactions") or {}).values(), key=lambda t: (t["date"], t["ts"]))
    if not txs:
        return {"available": False}
    v = Valuer(provider)
    names = {t["id"]: t["name"] for t in provider.base["teams"]}

    pickups, team_sum = [], {}
    trades: dict[str, dict] = {}
    for tx in txs:
        for m in tx["moves"]:
            if m["action"] == "add":
                st = v.stint(m["player"], tx["team"], tx["date"])
                pickups.append({"date": tx["date"], "ts": tx["ts"], "team": tx["team"], "team_name": names.get(tx["team"]),
                                "player": v.info(m["player"]), "source": m["source"], **st,
                                "per_game": st["value"] / st["active_games"] if st["active_games"] else None})
                ts = team_sum.setdefault(tx["team"], {"team": tx["team"], "name": names.get(tx["team"]),
                                                      "adds": 0, "value": 0.0, "best": None})
                ts["adds"] += 1
                ts["value"] += st["value"]
                if ts["best"] is None or st["value"] > ts["best"]["value"]:
                    ts["best"] = pickups[-1]
            elif m["action"] == "trade":
                tr = trades.setdefault(tx["ts"], {"date": tx["date"], "ts": tx["ts"], "sides": {}})
                side = tr["sides"].setdefault(tx["team"], {"team": tx["team"], "name": names.get(tx["team"]),
                                                           "players": [], "value": 0.0})
                st = v.stint(m["player"], tx["team"], tx["date"])
                side["players"].append({"player": v.info(m["player"]), **st})
                side["value"] += st["value"]

    for t in names:
        team_sum.setdefault(t, {"team": t, "name": names[t], "adds": 0, "value": 0.0, "best": None})
    trade_list = []
    for tr in sorted(trades.values(), key=lambda t: t["date"], reverse=True):
        sides = sorted(tr["sides"].values(), key=lambda s: s["value"], reverse=True)
        trade_list.append({"date": tr["date"], "ts": tr["ts"], "sides": sides})
    return {
        "available": True, "has_pool": v.has_pool,
        "count": len(txs), "first": txs[0]["date"], "last": txs[-1]["date"],
        "pickups": sorted(pickups, key=lambda x: x["value"], reverse=True),
        "teams": sorted(team_sum.values(), key=lambda t: t["value"], reverse=True),
        "trades": trade_list,
    }
