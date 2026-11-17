"""Power rankings and alternative standings on synced league data.

Power rankings combine three things on a 0-100 scale:
  45%  all-play: category win rate if every team played every other team each week
  25%  form: the same, last 2 completed weeks only
  30%  roster: summed z-score of the best healthy players today
"Luck" is the real category win rate minus the all-play rate.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from . import engine

OUT_STATUSES = {"O", "INJ", "OFS", "SUSP", "NA", "IL"}
W_ALLPLAY, W_FORM, W_ROSTER = 0.45, 0.25, 0.30


def today_et() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


class Context:
    """Everything derived once from the store: values and today's lineups."""

    def __init__(self, provider):
        self.p = provider
        self.store = provider.store
        self.league = provider.league()
        self.teams = [t["key"] for t in self.league["teams"]]
        self.names = {t["key"]: t["name"] for t in self.league["teams"]}
        self.slots = provider.active_slots()
        self.today = today_et()

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
        self.lineup = self.store.get("lineup_now") or {t: [{"player": pl, "slot": "BN"} for pl in ps]
                                                       for t, ps in provider.rosters().items()}

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


# ---------------------------------------------------------------- alternative standings

# Yahoo's default head-to-head points values (public league default)
DEFAULT_POINTS = {"PTS": 1.0, "REB": 1.2, "AST": 1.5, "ST": 3.0, "BLK": 3.0, "TO": -1.0}


def _rank(values: dict, reverse: bool = True) -> dict:
    """team -> rank (1 = best). Equal values share the better rank."""
    order = sorted(values, key=values.get, reverse=reverse)
    out, prev, prev_rank = {}, None, 0
    for i, t in enumerate(order, 1):
        if prev is not None and abs(values[t] - prev) < 1e-12:
            out[t] = prev_rank
        else:
            out[t], prev_rank = i, i
        prev = values[t]
    return out


def standings(provider) -> dict:
    """The same season under other scoring formats.

    h2h      Head-to-Head Each Category (the league's real format): every category is a win or loss.
    one_win  Head-to-Head One Win: one result per week, for the side that wins more categories.
    roto     Rotisserie: season totals; in each category the best team gets N points, the worst 1
             (ties share the points); the points are summed.
    points   Points league with Yahoo's default values: total fantasy points, and the weekly record.
    Records use completed weeks; season totals (roto, points) run through the last synced day."""
    ctx = Context(provider)
    lg, teams = ctx.league, ctx.teams
    if lg["scoring"] != "categories":
        return {"available": False}
    done = set(_completed_weeks(ctx))
    weeks = sorted(int(w) for w, v in ctx.store["weeks"].items()
                   if v.get("dates") and any(d in ctx.store["days"] for d in v["dates"]))
    if not weeks:
        return {"available": False}
    pts_lg = {"scoring": "points", "modifiers": DEFAULT_POINTS, "categories": []}

    season = {t: {} for t in teams}
    h2h = {t: [0, 0, 0] for t in teams}
    one = {t: [0, 0, 0] for t in teams}
    ptsrec = {t: [0, 0, 0] for t in teams}
    idx = {"W": 0, "L": 1, "T": 2}
    flip = {"W": "L", "L": "W", "T": "T"}
    for w in weeks:
        wk = provider.week(w, teams)
        totals = {t: engine.team_week_totals(wk, t, [], {})[0] for t in teams}
        for t in teams:
            season[t] = engine.add_lines([season[t], totals[t]])
        if w not in done:
            continue
        for a, b in ctx.store["weeks"][str(w)]["pairs"]:
            res = engine.head_to_head(totals[a], totals[b], lg)
            sc = res["score"]
            for i, k in enumerate(("W", "L", "T")):
                h2h[a][i] += sc[k]
                h2h[b][i] += sc[flip[k]]
            one[a][idx[res["result"]]] += 1
            one[b][idx[flip[res["result"]]]] += 1
            pr = engine.head_to_head(totals[a], totals[b], pts_lg)["result"]
            ptsrec[a][idx[pr]] += 1
            ptsrec[b][idx[flip[pr]]] += 1

    # rotisserie
    n = len(teams)
    cat_vals = {t: engine.category_values(season[t], lg) for t in teams}
    roto_pts = {t: 0.0 for t in teams}
    roto_cats = {t: {} for t in teams}
    for c in lg["categories"]:
        k = c["key"]
        vals = {t: (cat_vals[t][k] if cat_vals[t][k] is not None else (-1e18 if c["higher"] else 1e18)) for t in teams}
        order = sorted(teams, key=vals.get, reverse=c["higher"])          # best first
        i = 0
        while i < n:
            j = i
            while j + 1 < n and abs(vals[order[j + 1]] - vals[order[i]]) < 1e-12:
                j += 1
            share = sum(n - pos for pos in range(i, j + 1)) / (j - i + 1)   # tied teams share the points
            for t in order[i:j + 1]:
                roto_cats[t][k] = {"value": cat_vals[t][k], "points": share, "rank": i + 1}
                roto_pts[t] += share
            i = j + 1

    fpts = {t: engine.fantasy_points(season[t], pts_lg) for t in teams}
    r_h2h = _rank({t: _pct(*h2h[t]) for t in teams})
    r_one = _rank({t: _pct(*one[t]) for t in teams})
    r_roto = _rank(roto_pts)
    r_fpts = _rank(fpts)
    r_ptsrec = _rank({t: _pct(*ptsrec[t]) for t in teams})
    rows = [{"team": t, "name": ctx.names[t],
             "h2h": {"record": h2h[t], "pct": _pct(*h2h[t]), "rank": r_h2h[t]},
             "one_win": {"record": one[t], "pct": _pct(*one[t]), "rank": r_one[t]},
             "roto": {"points": roto_pts[t], "rank": r_roto[t], "cats": roto_cats[t]},
             "points": {"total": fpts[t], "rank": r_fpts[t], "record": ptsrec[t], "record_rank": r_ptsrec[t]}}
            for t in teams]
    rows.sort(key=lambda r: (r["h2h"]["rank"], r["roto"]["rank"]))
    return {"available": True, "teams": rows, "n": n, "weeks_done": sorted(done), "weeks_total": weeks,
            "last_day": max(ctx.store["days"]), "point_values": DEFAULT_POINTS}
