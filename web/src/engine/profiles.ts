// Profiles: the numbers shown in the popup that opens when a player or team name is clicked.
//
// Only facts about what already happened (no forecasts, no advice). Everything reuses the
// yardsticks of the other pages: z-scores and "değer" (value over replacement) from the
// Draft/Transfers analysis, all-play and luck from the rankings, injuries from the injury report.

import type {
  AllPlay, DraftReport, GameRef, InjuryReport, LuckReport, MovesReport, PlayerProfile, Power, Res, Standings, StatLine, TeamProfile, WeekRef,
} from "../types";
import { cmpKey, tsKey, type Valuer } from "./analysis";
import { INACTIVE_SLOTS, playerZ } from "./core";
import type { LeagueData } from "./data";
import type { positionHistory } from "./rankings";

/** Fewer games than this: the player is left out of the league-wide ranks. */
export const MIN_GP = 5;
const IL_SLOTS = new Set(["IL", "IL+", "IR", "NA"]);

/** Reports the profiles read from; each may be missing (not synced yet). */
export interface Reports {
  draft: () => DraftReport | null;
  moves: () => MovesReport | null;
  injuries: () => InjuryReport | null;
  power: () => Power | null;
  standings: () => Standings | null;
  luck: () => LuckReport | null;
  allplay: (team: string) => AllPlay | null;
  positions: () => ReturnType<typeof positionHistory> | null;
}

const played = (line: StatLine | null | undefined): line is StatLine => !!line && Object.keys(line).length > 0;
/** 1 + how many values beat mine. */
const rankAmong = (mine: number, all: number[]) => 1 + all.filter((x) => x > mine + 1e-12).length;

// ---------------------------------------------------------------- player

export function playerProfile(data: LeagueData, v: Valuer, rep: Reports, key: string): PlayerProfile {
  const store = data.store;
  if (!store.players[key] && !v.avg[key]) throw new Error("Oyuncu bulunamadı.");
  const info = v.info(key);
  const lg = v.league;
  const avg = v.avg[key];
  const gp = avg?.GP ?? 0;

  // league-wide ranks: everyone known (rostered and free agents) with enough games
  const pool = Object.keys(v.z).filter((k) => (v.avg[k]?.GP ?? 0) >= MIN_GP);
  const zs = Object.fromEntries(pool.map((k) => [k, playerZ(v.avg[k], lg, v.model)]));
  const mine = gp ? playerZ(avg, lg, v.model) : null;
  const ranked = gp >= MIN_GP && mine;
  const cats = lg.categories.map((c) => {
    const value = !avg ? null : c.ratio ? (avg[c.ratio[1]] ? avg[c.ratio[0]] / avg[c.ratio[1]] : null) : avg[c.key] ?? 0;
    const z = mine?.[c.key] ?? 0;
    return { key: c.key, label: c.label, value, z, rank: ranked ? rankAmong(z, pool.map((k) => zs[k][c.key])) : null, of: pool.length };
  });
  const values = Object.keys(v.seasonValue);

  const periods = (["last30", "last14", "last7"] as const).flatMap((period) => {
    const a = data.base.averages[period]?.[key];
    return a?.GP ? [{ period, gp: a.GP, z: playerZ(a, lg, v.model).TOTAL }] : [];
  });
  const prevAvg = data.prevAverages()[key];
  const prev = prevAvg?.GP ? { season: store.prev_season?.season ?? "", gp: prevAvg.GP, z: playerZ(prevAvg, lg, v.model).TOTAL } : null;

  // every stored day he was on a league roster
  const teams: string[] = [];
  const fantasy = { teams, days: 0, games: 0, active_games: 0, active_value: 0, bench_games: 0, bench_pts: 0, best: null as GameRef | null };
  for (const d of Object.keys(store.days).sort()) {
    for (const [team, rows] of Object.entries(store.days[d])) {
      const r = rows.find((x) => x.player === key);
      if (!r) continue;
      fantasy.days += 1;
      if (!teams.includes(team)) teams.push(team);
      if (!played(r.line)) continue;
      const value = v.gameValue(r.line);
      const active = !INACTIVE_SLOTS.has(r.slot);
      fantasy.games += 1;
      if (active) { fantasy.active_games += 1; fantasy.active_value += value; }
      else if (!IL_SLOTS.has(r.slot)) { fantasy.bench_games += 1; fantasy.bench_pts += r.line.PTS ?? 0; }
      if (!fantasy.best || value > fantasy.best.value) fantasy.best = { date: d, team, line: r.line, value, active };
    }
  }

  const pick = (store.draft ?? []).find((p) => p.player === key);
  const pickRow = pick ? rep.draft()?.picks?.find((p) => p.overall === pick.overall) : undefined;
  const draft = pick ? {
    round: pick.round, overall: pick.overall, team: pick.team,
    team_name: (pick.team && data.base.teams.find((t) => t.id === pick.team)?.name) || pick.team_name,
    surplus: pickRow ? pickRow.surplus : null,
  } : null;

  const moves = Object.values(store.transactions ?? {})
    .flatMap((tx) => tx.moves.filter((m) => m.player === key).map((m) => ({ tx, m })))
    .sort((a, b) => cmpKey(tsKey(a.tx), tsKey(b.tx)))
    .map(({ tx, m }) => ({ date: tx.date, team: tx.team, action: m.action, source: m.source ?? "" }));

  const inj = rep.injuries()?.players?.find((p) => p.key === key);

  return {
    key, name: info.name, nba_team: info.nba_team, positions: info.positions, status: info.status, owner: info.owner ?? null,
    gp, z: mine ? mine.TOTAL : null,
    z_rank: ranked ? { rank: rankAmong(mine.TOTAL, pool.map((k) => zs[k].TOTAL)), of: pool.length } : null,
    value: key in v.seasonValue ? v.seasonValue[key] : null,
    value_rank: key in v.valueRank ? { rank: v.valueRank[key], of: values.length } : null,
    min_gp: MIN_GP, cats, periods, prev, fantasy, draft, moves,
    injury: inj ? { il: inj.il, missed: inj.missed, lost: inj.lost } : null,
  };
}

// ---------------------------------------------------------------- team

export function teamProfile(data: LeagueData, v: Valuer, rep: Reports, team: string): TeamProfile {
  const store = data.store;
  const meta = data.base.teams.find((t) => t.id === team);
  if (!meta) throw new Error("Takım bulunamadı.");
  const n = data.base.teams.length;
  const ref = (k: string) => ({ key: k, name: store.players[k]?.name ?? k });

  const pw = rep.power();
  const pt = pw?.available ? pw.teams.find((t) => t.team === team) : undefined;
  const power = pt ? { rank: pt.rank, power: pt.power, allplay_pct: pt.allplay_pct, form_pct: pt.form_pct, beat: pt.beat, beat_of: pt.beat_of } : null;

  const st = rep.standings();
  const sr = st?.available ? st.teams.find((t) => t.team === team) : undefined;
  const standings = sr ? {
    h2h_rank: sr.h2h.rank, record: sr.h2h.record, one_win_rank: sr.one_win.rank, roto_rank: sr.roto.rank, points_rank: sr.points.rank,
    cats: data.categories.filter((c) => sr.roto.cats[c.key]).map((c) => ({ key: c.key, label: c.label, rank: sr.roto.cats[c.key].rank, value: sr.roto.cats[c.key].value })),
  } : null;

  const lk = rep.luck();
  const li = lk?.available ? lk.season.findIndex((t) => t.team === team) : -1;
  const luck = lk && li >= 0 ? { luck: lk.season[li].luck, rank: li + 1 } : null;

  // completed weeks: the real result and how many teams that week would have beaten
  const ap = rep.allplay(team);
  const weeks: WeekRef[] = (ap?.weeks ?? []).filter((w) => w.complete).map((w) => {
    const real = w.rows.find((r) => r.team === w.real_opponent);
    return {
      week: w.week, opponent: w.real_opponent, result: real?.actual.result ?? null, score: real?.actual.score ?? null,
      beaten: w.rows.filter((r) => r.actual.result === "W").length, of: w.rows.length,
    };
  });
  const pickBy = (xs: WeekRef[], f: (w: WeekRef) => number) => xs.reduce<WeekRef | null>((b, w) => (!b || f(w) > f(b) ? w : b), null);
  const margin = (w: WeekRef) => (w.score ? w.score.W - w.score.L : 0);
  let streak: { result: Res; n: number } | null = null;
  for (const w of [...weeks].reverse()) {
    if (!w.result) break;
    if (!streak) streak = { result: w.result, n: 1 };
    else if (w.result === streak.result) streak.n += 1;
    else break;
  }

  // how the team used its roster: value produced in active slots, games left on the bench
  const used: Record<string, { games: number; value: number; bench: number; pts: number }> = {};
  for (const d of Object.keys(store.days)) {
    for (const r of store.days[d][team] ?? []) {
      const u = (used[r.player] ??= { games: 0, value: 0, bench: 0, pts: 0 });
      if (!played(r.line)) continue;
      if (!INACTIVE_SLOTS.has(r.slot)) { u.games += 1; u.value += v.gameValue(r.line); }
      else if (!IL_SLOTS.has(r.slot)) { u.bench += 1; u.pts += r.line.PTS ?? 0; }
    }
  }
  const usedKeys = Object.keys(used);
  const benchTop = usedKeys.filter((k) => used[k].bench).sort((a, b) => used[b].pts - used[a].pts)[0];
  const usage = {
    players: usedKeys.length,
    bench_games: usedKeys.reduce((a, k) => a + used[k].bench, 0),
    bench_pts: usedKeys.reduce((a, k) => a + used[k].pts, 0),
    top: usedKeys.filter((k) => used[k].games).sort((a, b) => used[b].value - used[a].value).slice(0, 3)
      .map((k) => ({ ...ref(k), games: used[k].games, value: used[k].value })),
    bench_top: benchTop ? { ...ref(benchTop), games: used[benchTop].bench, pts: used[benchTop].pts } : null,
  };
  const rosterBest = (data.base.rosters[team] ?? []).filter((k) => v.z[k] !== undefined).sort((a, b) => v.z[b] - v.z[a])[0];

  const dr = rep.draft();
  const di = dr?.available ? dr.teams.findIndex((t) => t.team === team) : -1;
  const dt = dr && di >= 0 ? dr.teams[di] : null;
  const pickRef = (p: NonNullable<typeof dt>["best"]) => (p ? { ...ref(p.player.key), overall: p.overall, surplus: p.surplus } : null);
  const draft = dt ? { rank: di + 1, total: dt.total, surplus: dt.surplus, kept: dt.kept, picks: dt.picks, best: pickRef(dt.best), worst: pickRef(dt.worst) } : null;

  const mv = rep.moves();
  const mi = mv?.available ? mv.teams.findIndex((t) => t.team === team) : -1;
  const mt = mv && mi >= 0 ? mv.teams[mi] : null;
  const moves = mv && mt ? {
    rank: mi + 1, adds: mt.adds, value: mt.value, trades: mv.trades.filter((t) => t.sides.some((s) => s.team === team)).length,
    best: mt.best ? { ...ref(mt.best.player.key), date: mt.best.date, value: mt.best.value } : null,
  } : null;

  const ir = rep.injuries();
  const ii = ir?.available ? ir.teams.findIndex((t) => t.team === team) : -1;
  const it = ir && ii >= 0 ? ir.teams[ii] : null;
  const hurt = ir?.players?.filter((p) => p.team === team && p.missed).sort((a, b) => b.missed - a.missed)[0];
  const injuries = it ? { rank: ii + 1, il: it.il, missed: it.missed, lost: it.lost, top: hurt ? { key: hurt.key, name: hurt.name, missed: hurt.missed } : null } : null;

  return {
    team, name: meta.name, teams: n, history: rep.positions()?.teams[team] ?? [], power, standings, luck, weeks, streak,
    best_week: pickBy(weeks, (w) => w.beaten), worst_week: pickBy(weeks, (w) => -w.beaten),
    biggest_win: pickBy(weeks.filter((w) => w.result === "W"), margin),
    closest_loss: pickBy(weeks.filter((w) => w.result === "L"), (w) => margin(w)),
    usage, roster_best: rosterBest ? { ...ref(rosterBest), z: v.z[rosterBest] } : null,
    draft, moves, injuries,
  };
}
