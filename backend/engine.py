"""Pure statistics engine: trade comparison and "what if" matchup replays.

Everything here works on plain dicts so it is independent of where the data
comes from (Yahoo or the demo provider).

Stat lines use internal keys: PTS, REB, AST, ST, BLK, TO, 3PTM, 3PTA,
FGM, FGA, FTM, FTA, GP ...

A league looks like:
    {
      "scoring": "categories" | "points",
      "categories": [
          {"key": "FG%", "label": "FG%", "higher": True, "ratio": ["FGM", "FGA"]},
          {"key": "PTS", "label": "PTS", "higher": True},
          {"key": "TO",  "label": "TO",  "higher": False},
      ],
      "modifiers": {"PTS": 1, "REB": 1.2, ...}   # points leagues only
    }
"""
from __future__ import annotations

import copy
import math
from statistics import mean, pstdev

INACTIVE_SLOTS = {"BN", "IL", "IL+", "IR", "NA"}


# ---------------------------------------------------------------- basics

def add_lines(lines) -> dict:
    """Sum any number of stat lines (missing keys count as 0)."""
    total: dict[str, float] = {}
    for line in lines:
        if not line:
            continue
        for k, v in line.items():
            if isinstance(v, (int, float)):
                total[k] = total.get(k, 0.0) + v
    return total


def category_values(totals: dict, league: dict) -> dict:
    """Turn summed components into category values (ratio cats become %)."""
    out = {}
    for cat in league["categories"]:
        if cat.get("ratio"):
            num, den = cat["ratio"]
            d = totals.get(den, 0.0)
            out[cat["key"]] = (totals.get(num, 0.0) / d) if d else None
        else:
            out[cat["key"]] = totals.get(cat["key"], 0.0)
    return out


def fantasy_points(totals: dict, league: dict) -> float:
    return sum(totals.get(stat, 0.0) * pts for stat, pts in league.get("modifiers", {}).items())


def compare_cat(a, b, higher: bool) -> str:
    """Result of one category from A's point of view: W / L / T."""
    if a is None and b is None:
        return "T"
    if a is None:
        return "L"
    if b is None:
        return "W"
    if math.isclose(a, b, abs_tol=1e-9):
        return "T"
    return "W" if (a > b) == higher else "L"


def head_to_head(a_totals: dict, b_totals: dict, league: dict) -> dict:
    """Full matchup result between two summed stat lines."""
    if league["scoring"] == "points":
        pa, pb = fantasy_points(a_totals, league), fantasy_points(b_totals, league)
        res = compare_cat(pa, pb, True)
        return {"a_points": pa, "b_points": pb, "result": res}

    a_vals, b_vals = category_values(a_totals, league), category_values(b_totals, league)
    cats, score = [], {"W": 0, "L": 0, "T": 0}
    for cat in league["categories"]:
        r = compare_cat(a_vals[cat["key"]], b_vals[cat["key"]], cat["higher"])
        score[r] += 1
        cats.append({"key": cat["key"], "a": a_vals[cat["key"]], "b": b_vals[cat["key"]], "result": r})
    overall = "W" if score["W"] > score["L"] else "L" if score["L"] > score["W"] else "T"
    return {"categories": cats, "score": score, "result": overall}


# ---------------------------------------------------------------- trade analysis

def _cat_raw_value(avg: dict, cat: dict, league_rates: dict) -> float:
    """Per-player raw value for z-scoring. Ratio cats use volume-weighted impact:
    (makes - league_rate * attempts), so a 60% shooter on 2 FGA matters less
    than a 50% shooter on 20 FGA."""
    if cat.get("ratio"):
        num, den = cat["ratio"]
        return avg.get(num, 0.0) - league_rates[cat["key"]] * avg.get(den, 0.0)
    return avg.get(cat["key"], 0.0)


def build_z_model(pool: dict[str, dict], league: dict) -> dict:
    """Mean/std per category over a player pool (usually all rostered players)."""
    league_rates = {}
    for cat in league["categories"]:
        if cat.get("ratio"):
            num, den = cat["ratio"]
            tn = sum(p.get(num, 0.0) for p in pool.values())
            td = sum(p.get(den, 0.0) for p in pool.values())
            league_rates[cat["key"]] = tn / td if td else 0.0
    stats = {}
    for cat in league["categories"]:
        vals = [_cat_raw_value(p, cat, league_rates) for p in pool.values()]
        sd = pstdev(vals) if len(vals) > 1 else 0.0
        stats[cat["key"]] = (mean(vals) if vals else 0.0, sd or 1.0)
    return {"rates": league_rates, "stats": stats}


def player_z(avg: dict, league: dict, model: dict) -> dict:
    out = {}
    for cat in league["categories"]:
        mu, sd = model["stats"][cat["key"]]
        z = (_cat_raw_value(avg, cat, model["rates"]) - mu) / sd
        out[cat["key"]] = z if cat["higher"] else -z
    out["TOTAL"] = sum(out.values())
    return out


def _team_strengths(rosters: dict[str, list[str]], avgs: dict[str, dict], league: dict) -> dict:
    """Per-game sum of each roster -> category value (or fantasy points)."""
    out = {}
    for team, players in rosters.items():
        totals = add_lines(avgs.get(p) for p in players)
        if league["scoring"] == "points":
            out[team] = {"FPTS": fantasy_points(totals, league)}
        else:
            out[team] = category_values(totals, league)
    return out


def _ranks(strengths: dict, league: dict) -> dict:
    """team -> {cat: rank (1 = best)}"""
    cats = [{"key": "FPTS", "higher": True}] if league["scoring"] == "points" else league["categories"]
    ranks = {t: {} for t in strengths}
    for cat in cats:
        k = cat["key"]
        filler = -math.inf if cat["higher"] else math.inf
        ordered = sorted(
            strengths,
            key=lambda t: strengths[t][k] if strengths[t][k] is not None else filler,
            reverse=cat["higher"],
        )
        for i, t in enumerate(ordered, 1):
            ranks[t][k] = i
    return ranks


def evaluate_trade(league: dict, rosters: dict[str, list[str]], avgs: dict[str, dict],
                   team_a: str, give_a: list[str], team_b: str, give_b: list[str],
                   pool: dict[str, dict] | None = None) -> dict:
    """Compare two trade packages purely statistically.

    avgs: per-game averages (for the chosen period) of at least every rostered player.
    pool: averages used to build z-scores (defaults to avgs).
    """
    pool = pool or avgs
    is_points = league["scoring"] == "points"

    def package(players):
        totals = add_lines(avgs.get(p) for p in players)
        if is_points:
            vals = {"FPTS": fantasy_points(totals, league)}
        else:
            vals = category_values(totals, league)
        return totals, vals

    a_tot, a_vals = package(give_a)
    b_tot, b_vals = package(give_b)

    rows = []
    cats = [{"key": "FPTS", "label": "FPTS", "higher": True}] if is_points else league["categories"]
    for cat in cats:
        k = cat["key"]
        av, bv = a_vals[k], b_vals[k]
        diff = None if av is None or bv is None else bv - av   # what team A gains per game
        rows.append({"key": k, "label": cat.get("label", k), "higher": cat["higher"],
                     "a_gives": av, "b_gives": bv, "a_net": diff,
                     "better_for_a": compare_cat(bv, av, cat["higher"])})

    players = {}
    zmodel = None if is_points else build_z_model(pool, league)
    for p in give_a + give_b:
        avg = avgs.get(p, {})
        entry = {"avg": avg}
        if is_points:
            entry["fpts"] = fantasy_points(avg, league)
        else:
            entry["z"] = player_z(avg, league, zmodel)
        players[p] = entry

    def total_value(pl):
        if is_points:
            return sum(players[p]["fpts"] for p in pl)
        return sum(players[p]["z"]["TOTAL"] for p in pl)

    # roster impact
    after = copy.deepcopy(rosters)
    after[team_a] = [p for p in after[team_a] if p not in give_a] + list(give_b)
    after[team_b] = [p for p in after[team_b] if p not in give_b] + list(give_a)
    s_before, s_after = _team_strengths(rosters, avgs, league), _team_strengths(after, avgs, league)
    r_before, r_after = _ranks(s_before, league), _ranks(s_after, league)

    def impact(team):
        return [{"key": c["key"], "label": c.get("label", c["key"]),
                 "before": s_before[team][c["key"]], "after": s_after[team][c["key"]],
                 "rank_before": r_before[team][c["key"]], "rank_after": r_after[team][c["key"]]}
                for c in cats]

    a_val, b_val = total_value(give_a), total_value(give_b)
    return {
        "scoring": league["scoring"],
        "value_metric": "FPTS/G" if is_points else "z-score",
        "categories": rows,
        "players": players,
        "a_gives_value": a_val,
        "b_gives_value": b_val,
        "a_net_value": b_val - a_val,
        "roster_spots": {"a_net": len(give_a) - len(give_b), "b_net": len(give_b) - len(give_a)},
        "team_impact": {team_a: impact(team_a), team_b: impact(team_b)},
        "teams": {"a": team_a, "b": team_b},
        "league_size": len(rosters),
    }


# ---------------------------------------------------------------- what-if replay

def apply_edits(lineup: list[dict], edits: list[dict], day: str | None = None) -> list[dict]:
    """lineup: [{"player": key, "slot": "PG"}, ...] for one team on one day.

    Edit types (an edit with "dates" only applies on those dates):
      swap  {"out": p, "in": q}  q takes p's slot. If q is already on this lineup
                                 their slots are exchanged (bench decisions).
      bench {"player": p}        p is moved to the bench.
      start {"player": p}        p is moved into an active slot.
    """
    lineup = [dict(e) for e in lineup]
    for s in edits:
        if s.get("dates") and day not in s["dates"]:
            continue
        kind = s.get("type", "swap")
        if kind == "swap":
            out_e = next((e for e in lineup if e["player"] == s["out"]), None)
            if not out_e:
                continue
            in_e = next((e for e in lineup if e["player"] == s["in"]), None)
            if in_e:
                out_e["slot"], in_e["slot"] = in_e["slot"], out_e["slot"]
            else:
                out_e["player"] = s["in"]
        else:
            e = next((e for e in lineup if e["player"] == s["player"]), None)
            if e:
                e["slot"] = "BN" if kind == "bench" else "UTIL"
    return lineup


apply_swaps = apply_edits   # old name


def _stat_for(player, day, extra_stats):
    if player in day["stats"]:
        return day["stats"][player]
    return extra_stats.get(player, {}).get(day["date"])


def team_week_totals(week: dict, team: str, edits: list[dict], extra_stats: dict,
                     track: set[str] = frozenset(), overfull: list | None = None,
                     active_slots: int | None = None) -> tuple[dict, dict]:
    """Sum the stats of a team's active players over the week, after edits.
    Returns (totals, per_player_totals for players in `track`).
    If `overfull` is given, dates where more players played in active slots than
    `active_slots` allows are appended to it."""
    lines, tracked = [], {p: [] for p in track}
    for day in week["days"]:
        lineup = apply_edits(day["lineups"].get(team, []), edits, day["date"])
        played = 0
        for e in lineup:
            if e["slot"] in INACTIVE_SLOTS:
                continue
            line = _stat_for(e["player"], day, extra_stats)
            if line:
                played += 1
                lines.append(line)
                if e["player"] in tracked:
                    tracked[e["player"]].append(line)
        if overfull is not None and active_slots and played > active_slots:
            overfull.append({"team": team, "date": day["date"], "played": played, "slots": active_slots})
    # GP = games counted in an active slot (daily lines from Yahoo carry no GP of their own)
    return add_lines(lines), {p: {**add_lines(ls), "GP": len(ls)} if ls else {} for p, ls in tracked.items()}


def _edit_players(edits):
    out = set()
    for s in edits:
        out |= {s[k] for k in ("out", "in", "player") if s.get(k)}
    return out


def what_if(league: dict, week: dict, team_a: str, team_b: str,
            edits: list[dict], extra_stats: dict | None = None, active_slots: int | None = None) -> dict:
    """Replay a week's matchup between any two teams.
    edits: [{"team": key, "type": "swap"|"bench"|"start", ...}] (see apply_edits)."""
    extra_stats = extra_stats or {}
    track = _edit_players(edits)
    warnings: list = []

    def run(ed, warn=None):
        ta, pa = team_week_totals(week, team_a, [s for s in ed if s["team"] == team_a], extra_stats, track,
                                  warn, active_slots)
        tb, pb = team_week_totals(week, team_b, [s for s in ed if s["team"] == team_b], extra_stats, track,
                                  warn, active_slots)
        return ta, tb, {"a": pa, "b": pb}

    a0, b0, contrib0 = run([])
    a1, b1, contrib = run(edits, warnings)
    actual, hypo = head_to_head(a0, b0, league), head_to_head(a1, b1, league)

    if league["scoring"] != "points":
        for c0, c1 in zip(actual["categories"], hypo["categories"]):
            c1["changed"] = c0["result"] != c1["result"]

    # Contribution of each edited player in active slots (actual vs hypothetical)
    players = {}
    for p in track:
        before = add_lines([contrib0["a"].get(p), contrib0["b"].get(p)])
        after = add_lines([contrib["a"].get(p), contrib["b"].get(p)])
        players[p] = {"actual": before, "hypothetical": after}

    return {
        "scoring": league["scoring"],
        "actual": actual,
        "hypothetical": hypo,
        "flipped": actual["result"] != hypo["result"],
        "players": players,
        "warnings": warnings,
    }


def versus_all(league: dict, week: dict, team: str, others: list[str],
               edits: list[dict] | None = None, extra_stats: dict | None = None) -> list[dict]:
    """The team's week against every other team's week ("what if I had played X instead?").
    Only the team's own edits are applied; opponents keep their real week."""
    extra_stats = extra_stats or {}
    mine = [s for s in (edits or []) if s["team"] == team]
    t0, _ = team_week_totals(week, team, [], extra_stats)
    t1, _ = team_week_totals(week, team, mine, extra_stats) if mine else (t0, None)
    out = []
    for o in others:
        to, _ = team_week_totals(week, o, [], extra_stats)
        row = {"team": o, "actual": _brief(head_to_head(t0, to, league))}
        if mine:
            row["hypothetical"] = _brief(head_to_head(t1, to, league))
        out.append(row)
    return out


def _brief(res: dict) -> dict:
    if "score" in res:
        return {"score": res["score"], "result": res["result"]}
    return {"a_points": res["a_points"], "b_points": res["b_points"], "result": res["result"]}
