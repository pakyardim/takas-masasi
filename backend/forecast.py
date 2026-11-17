"""Matchup projections and power rankings on synced league data.

Projection (per matchup, per week):
  what is already played this week (stored days)
  + a simulation of every remaining game of every available player.

  - Who plays: today's rosters. Players in an IL slot or listed as out are left
    out. On each remaining day the team starts its best players who have an NBA
    game, up to the number of active slots (positions are not checked).
  - What a game looks like: a real box score drawn at random from the player's
    last 15 games in the league data (keeps a player's hot/cold nights and the
    link between his categories). Players with fewer than 3 logged games use
    their season average line.
  - 3000 simulated weeks give each category's win probability, the expected
    totals, and how often each side wins the matchup.

Power rankings combine three things on a 0-100 scale:
  45%  all-play: category win rate if every team played every other team each week
  25%  form: the same, last 2 completed weeks only
  30%  roster: summed z-score of the best healthy players today
"Luck" is the real category win rate minus the all-play rate.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from . import engine

SIMS = 3000
LOG_GAMES = 15
OUT_STATUSES = {"O", "INJ", "OFS", "SUSP", "NA", "IL"}
W_ALLPLAY, W_FORM, W_ROSTER = 0.45, 0.25, 0.30


def today_et() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


class Context:
    """Everything derived once from the store: stat layout, game logs, values, lineups."""

    def __init__(self, provider):
        self.p = provider
        self.store = provider.store
        self.league = provider.league()
        self.teams = [t["key"] for t in self.league["teams"]]
        self.names = {t["key"]: t["name"] for t in self.league["teams"]}
        self.slots = provider.active_slots()
        self.today = today_et()
        self.schedule = {k: set(v) for k, v in (self.store.get("schedule") or {}).items()}

        # stat vector layout: every component the categories need
        comps: list[str] = []
        for c in self.league["categories"]:
            for k in (c["ratio"] if c.get("ratio") else [c["key"]]):
                if k not in comps:
                    comps.append(k)
        self.comps = comps
        self.idx = {k: i for i, k in enumerate(comps)}

        # game logs: every box score of every player in the stored days, oldest first
        logs: dict[str, list] = {}
        for d in sorted(self.store["days"]):
            seen = set()
            for rows in self.store["days"][d].values():
                for r in rows:
                    if r["line"] and r["player"] not in seen:
                        seen.add(r["player"])
                        logs.setdefault(r["player"], []).append(self.vec(r["line"]))
        self.logs = logs

        # season averages (rostered first, then the league-wide pool) and z-scores
        season = provider.base["averages"].get("season", {})
        pool = self.store.get("pool", {})
        self.avg = {**{k: v for k, v in pool.items() if v}, **{k: v for k, v in season.items() if v}}
        rostered = {pl for ps in provider.rosters().values() for pl in ps}
        model_pool = {k: self.avg[k] for k in rostered if self.avg.get(k, {}).get("GP")}
        self.model = engine.build_z_model(model_pool, self.league) if model_pool else None
        self.z = {k: engine.player_z(v, self.league, self.model)["TOTAL"]
                  for k, v in self.avg.items() if v.get("GP")} if self.model else {}

        # today's lineups (fresher than the roster list); fall back to the stored rosters
        now = self.store.get("lineup_now") or {t: [{"player": pl, "slot": "BN"} for pl in ps]
                                               for t, ps in provider.rosters().items()}
        self.lineup = now

    def vec(self, line: dict) -> np.ndarray:
        return np.array([float(line.get(k) or 0.0) for k in self.comps])

    def info(self, pid: str) -> dict:
        return self.store["players"].get(pid, {})

    def available(self, team: str) -> list[str]:
        """Roster players expected to play: not in an IL slot, not listed as out."""
        out = []
        for e in self.lineup.get(team, []):
            if e["slot"] in ("IL", "IL+", "IR", "NA"):
                continue
            if (self.info(e["player"]).get("status") or "").upper() in OUT_STATUSES:
                continue
            out.append(e["player"])
        return out

    def plan(self, team: str, dates: list[str]) -> dict[str, int]:
        """player -> number of games he is expected to start over these dates."""
        games: dict[str, int] = {}
        for d in dates:
            playing = [pl for pl in self.available(team)
                       if d in self.schedule.get(self.info(pl).get("nba_team", ""), ())]
            playing.sort(key=lambda pl: self.z.get(pl, -99), reverse=True)
            for pl in playing[: self.slots]:
                games[pl] = games.get(pl, 0) + 1
        return games

    def sample_pool(self, pid: str) -> np.ndarray:
        """Rows to draw a simulated game from."""
        log = self.logs.get(pid, [])[-LOG_GAMES:]
        if len(log) >= 3:
            return np.array(log)
        avg = self.avg.get(pid)
        if avg and avg.get("GP"):
            return self.vec(avg)[None, :]
        return np.zeros((1, len(self.comps)))

    def cat_values(self, totals: np.ndarray) -> np.ndarray:
        """(sims, comps) -> (sims, categories)"""
        cols = []
        for c in self.league["categories"]:
            if c.get("ratio"):
                num, den = totals[:, self.idx[c["ratio"][0]]], totals[:, self.idx[c["ratio"][1]]]
                cols.append(np.divide(num, den, out=np.zeros_like(num), where=den > 0))
            else:
                cols.append(totals[:, self.idx[c["key"]]])
        return np.stack(cols, axis=1)


def _simulate(ctx: Context, team: str, base: np.ndarray, plan: dict[str, int], rng) -> np.ndarray:
    totals = np.tile(base, (SIMS, 1))
    for pid, g in plan.items():
        pool = ctx.sample_pool(pid)
        pick = rng.integers(0, len(pool), size=(SIMS, g))
        totals += pool[pick].sum(axis=1)
    return totals


def _week_report(ctx: Context, week: int, rng) -> dict | None:
    info = ctx.store["weeks"].get(str(week))
    if not info or not info.get("pairs") or not info.get("dates"):
        return None
    dates = info["dates"]
    stored = [d for d in dates if d in ctx.store["days"]]
    remaining = [d for d in dates if d not in ctx.store["days"]]
    rng_lo, rng_hi = ctx.store.get("schedule_range") or ["", ""]
    uncovered = [d for d in remaining if not (rng_lo <= d <= rng_hi)]      # no schedule data for these days
    wk = ctx.p.week(week, ctx.teams) if stored else {"days": []}

    higher = np.array([1.0 if c["higher"] else -1.0 for c in ctx.league["categories"]])
    matchups = []
    for a, b in info["pairs"]:
        side = {}
        for t in (a, b):
            so_far, _ = engine.team_week_totals(wk, t, [], {}) if stored else ({}, None)
            plan = ctx.plan(t, remaining)
            sims = _simulate(ctx, t, ctx.vec(so_far), plan, rng)
            side[t] = {"so_far": so_far, "plan": plan, "sims": sims, "cats": ctx.cat_values(sims)}
        diff = (side[a]["cats"] - side[b]["cats"]) * higher        # > 0: a wins the category
        a_w, b_w = (diff > 1e-9), (diff < -1e-9)
        wins_a, wins_b = a_w.sum(axis=1), b_w.sum(axis=1)
        mean_a = ctx.cat_values(side[a]["sims"].mean(axis=0, keepdims=True))[0]
        mean_b = ctx.cat_values(side[b]["sims"].mean(axis=0, keepdims=True))[0]

        cats, score = [], {"W": 0, "L": 0, "T": 0}
        for i, c in enumerate(ctx.league["categories"]):
            pa, pb = float(a_w[:, i].mean()), float(b_w[:, i].mean())
            # the projected winner of a category is the side that wins it more often
            res = "W" if pa > pb + 0.02 else "L" if pb > pa + 0.02 else "T"
            score[res] += 1
            cats.append({"key": c["key"], "a": float(mean_a[i]), "b": float(mean_b[i]),
                         "p_a": pa, "p_b": pb, "result": res})
        # headline: who wins more often, and the most common final score when they do
        ties = (~a_w & ~b_w).sum(axis=1)
        p_a, p_b = float((wins_a > wins_b).mean()), float((wins_b > wins_a).mean())
        fav = "a" if p_a >= p_b else "b"
        mask = (wins_a > wins_b) if fav == "a" else (wins_b > wins_a)
        if mask.any():
            combos, counts = np.unique(np.stack([wins_a[mask], wins_b[mask], ties[mask]], axis=1), axis=0, return_counts=True)
            wa, wb, tt = (int(x) for x in combos[counts.argmax()])
        else:
            wa, wb, tt = score["W"], score["L"], score["T"]
        likely = {"W": wa, "L": wb, "T": tt}
        now = engine.head_to_head(side[a]["so_far"], side[b]["so_far"], ctx.league) if stored else None

        def players(t):
            rows = [{"player": pl, "name": ctx.info(pl).get("name", pl), "games": g,
                     "few_games": len(ctx.logs.get(pl, [])) < 3} for pl, g in side[t]["plan"].items()]
            return sorted(rows, key=lambda r: (-r["games"], r["name"]))

        def sitting(t):
            avail = set(ctx.available(t))
            return [{"name": ctx.info(e["player"]).get("name", e["player"]),
                     "status": ctx.info(e["player"]).get("status") or e["slot"]}
                    for e in ctx.lineup.get(t, []) if e["player"] not in avail]

        matchups.append({
            "a": a, "b": b, "a_name": ctx.names.get(a, a), "b_name": ctx.names.get(b, b),
            "categories": cats, "score": likely, "favorite": fav,
            "result": "W" if fav == "a" else "L",
            "p_a": p_a, "p_b": p_b,
            "p_tie": float((wins_a == wins_b).mean()),
            "exp_a": float(wins_a.mean()), "exp_b": float(wins_b.mean()),
            "now": {"score": now["score"], "result": now["result"]} if now else None,
            "games_left": {"a": sum(side[a]["plan"].values()), "b": sum(side[b]["plan"].values())},
            "players": {"a": players(a), "b": players(b)},
            "out": {"a": sitting(a), "b": sitting(b)},
        })
    return {"week": week, "start": dates[0], "end": dates[-1], "days_played": len(stored),
            "days_left": len(remaining), "uncovered_dates": uncovered, "matchups": matchups}


def forecast(provider) -> dict:
    ctx = Context(provider)
    if not ctx.schedule:
        return {"available": False}
    rng = np.random.default_rng(56909)          # fixed seed: same data -> same numbers
    cur = provider.base["current_week"]
    weeks = [w for w in (_week_report(ctx, cur, rng), _week_report(ctx, cur + 1, rng)) if w]
    return {"available": True, "current_week": cur, "sims": SIMS, "active_slots": ctx.slots,
            "schedule_at": ctx.store.get("schedule_at"), "weeks": weeks}


# ---------------------------------------------------------------- power rankings

def _completed_weeks(ctx: Context) -> list[int]:
    out = []
    for w, v in ctx.store["weeks"].items():
        if v.get("dates") and v["dates"][-1] < ctx.today and all(d in ctx.store["days"] for d in v["dates"]):
            out.append(int(w))
    return sorted(out)


def _pct(w, l, t):
    n = w + l + t
    return (w + 0.5 * t) / n if n else 0.0


def power(provider) -> dict:
    ctx = Context(provider)
    weeks = _completed_weeks(ctx)
    if not weeks:
        return {"available": False}

    # per week: every team's totals, real result, and all-play record
    per_week = {}
    for w in weeks:
        wk = provider.week(w, ctx.teams)
        totals = {t: engine.team_week_totals(wk, t, [], {})[0] for t in ctx.teams}
        allplay = {t: [0, 0, 0] for t in ctx.teams}      # category W, L, T vs everyone
        beat = {t: 0 for t in ctx.teams}                  # matchups it would have won
        for i, a in enumerate(ctx.teams):
            for b in ctx.teams[i + 1:]:
                s = engine.head_to_head(totals[a], totals[b], ctx.league)
                sc = s["score"]
                allplay[a][0] += sc["W"]; allplay[a][1] += sc["L"]; allplay[a][2] += sc["T"]
                allplay[b][0] += sc["L"]; allplay[b][1] += sc["W"]; allplay[b][2] += sc["T"]
                beat[a] += s["result"] == "W"
                beat[b] += s["result"] == "L"
        real = {}
        for a, b in ctx.store["weeks"][str(w)]["pairs"]:
            sc = engine.head_to_head(totals[a], totals[b], ctx.league)["score"]
            real[a] = [sc["W"], sc["L"], sc["T"]]
            real[b] = [sc["L"], sc["W"], sc["T"]]
        per_week[w] = {"allplay": allplay, "beat": beat, "real": real}

    # roster strength today: summed z of the best available players
    roster = {}
    for t in ctx.teams:
        zs = sorted((ctx.z.get(pl, 0.0) for pl in ctx.available(t)), reverse=True)[: ctx.slots]
        roster[t] = float(sum(zs))
    lo, hi = min(roster.values()), max(roster.values())
    roster_norm = {t: (roster[t] - lo) / (hi - lo) if hi > lo else 0.5 for t in ctx.teams}

    def table(ws: list[int]) -> dict:
        rows = {}
        for t in ctx.teams:
            ap = [sum(per_week[w]["allplay"][t][i] for w in ws) for i in range(3)]
            form_ws = ws[-2:]
            fm = [sum(per_week[w]["allplay"][t][i] for w in form_ws) for i in range(3)]
            rl = [sum(per_week[w]["real"].get(t, [0, 0, 0])[i] for w in ws) for i in range(3)]
            score = 100 * (W_ALLPLAY * _pct(*ap) + W_FORM * _pct(*fm) + W_ROSTER * roster_norm[t])
            rows[t] = {"team": t, "name": ctx.names[t], "power": score,
                       "allplay": ap, "allplay_pct": _pct(*ap), "form_pct": _pct(*fm),
                       "record": rl, "record_pct": _pct(*rl), "luck": _pct(*rl) - _pct(*ap),
                       "beat": sum(per_week[w]["beat"][t] for w in ws),
                       "beat_of": len(ws) * (len(ctx.teams) - 1),
                       "roster": roster[t], "roster_norm": roster_norm[t]}
        order = sorted(rows.values(), key=lambda r: r["power"], reverse=True)
        for i, r in enumerate(order, 1):
            r["rank"] = i
        return rows

    now = table(weeks)
    prev = table(weeks[:-1]) if len(weeks) > 1 else None
    real_order = sorted(now.values(), key=lambda r: r["record_pct"], reverse=True)
    for i, r in enumerate(real_order, 1):
        r["standing"] = i
    out = sorted(now.values(), key=lambda r: r["rank"])
    for r in out:
        r["prev_rank"] = prev[r["team"]]["rank"] if prev else None
        r["weekly"] = [{"week": w, "allplay_pct": _pct(*per_week[w]["allplay"][r["team"]]),
                        "beat": per_week[w]["beat"][r["team"]]} for w in weeks]
    return {"available": True, "weeks": weeks, "teams": out,
            "weights": {"allplay": W_ALLPLAY, "form": W_FORM, "roster": W_ROSTER}}
