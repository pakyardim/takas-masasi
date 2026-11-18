// Power rankings and alternative standings.
//
// Power rankings combine three things on a 0-100 scale:
//   45%  all-play: category win rate if every team played every other team each week
//   25%  form: the same, last 2 completed weeks only
//   30%  roster: summed z-score of the best healthy players today
// "Luck" is the real category win rate minus the all-play rate.

import type { Power, Score, Standings, StandingsTeam, StatLine } from "../types";
import { addLines, buildZModel, categoryValues, fantasyPoints, headToHead, playerZ, teamWeekTotals, type EngineLeague } from "./core";
import type { LeagueData } from "./data";

const OUT_STATUSES = new Set(["O", "INJ", "OFS", "SUSP", "NA", "IL"]);
const W_ALLPLAY = 0.45, W_FORM = 0.25, W_ROSTER = 0.3;
// Yahoo's default head-to-head points values (public league default)
export const DEFAULT_POINTS: Record<string, number> = { PTS: 1.0, REB: 1.2, AST: 1.5, ST: 3.0, BLK: 3.0, TO: -1.0 };

/** Today's date in US Eastern time (Yahoo's game dates). */
export const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

type Rec = [number, number, number];
const pct = (r: Rec) => { const n = r[0] + r[1] + r[2]; return n ? (r[0] + 0.5 * r[2]) / n : 0; };
const IDX = { W: 0, L: 1, T: 2 } as const;
const FLIP = { W: "L", L: "W", T: "T" } as const;

class Context {
  readonly league: EngineLeague;
  readonly teams: string[];
  readonly names: Record<string, string>;
  readonly slots: number;
  readonly today: string;
  readonly z: Record<string, number> = {};
  readonly lineup: Record<string, { player: string; slot: string }[]>;

  constructor(readonly data: LeagueData, today = todayET()) {
    this.league = data.engineLeague();
    this.teams = data.teamKeys();
    this.names = Object.fromEntries(data.base.teams.map((t) => [t.id, t.name]));
    this.slots = data.activeSlots();
    this.today = today;
    const has = (v: StatLine | undefined): v is StatLine => !!v && Object.keys(v).length > 0;
    const avg: Record<string, StatLine> = {};
    for (const [k, v] of Object.entries(data.store.pool ?? {})) if (has(v)) avg[k] = v;
    for (const [k, v] of Object.entries(data.base.averages.season ?? {})) if (has(v)) avg[k] = v;
    const rosters = data.rosters();
    const modelPool: Record<string, StatLine> = {};
    for (const ps of Object.values(rosters)) for (const p of ps) if (avg[p]?.GP) modelPool[p] = avg[p];
    if (Object.keys(modelPool).length) {
      const model = buildZModel(modelPool, this.league);
      for (const [k, v] of Object.entries(avg)) if (v.GP) this.z[k] = playerZ(v, this.league, model).TOTAL;
    }
    // today's lineups (fresher than the roster list); fall back to the stored rosters
    this.lineup = data.store.lineup_now && Object.keys(data.store.lineup_now).length
      ? data.store.lineup_now
      : Object.fromEntries(Object.entries(rosters).map(([t, ps]) => [t, ps.map((p) => ({ player: p, slot: "BN" }))]));
  }

  /** Roster players expected to play: not in an IL slot, not listed as out. */
  available(team: string): string[] {
    return (this.lineup[team] ?? [])
      .filter((e) => !["IL", "IL+", "IR", "NA"].includes(e.slot))
      .filter((e) => !OUT_STATUSES.has((this.data.store.players[e.player]?.status ?? "").toUpperCase()))
      .map((e) => e.player);
  }

  completedWeeks(): number[] {
    const out: number[] = [];
    for (const [w, v] of Object.entries(this.data.store.weeks)) {
      if (v.dates?.length && v.dates[v.dates.length - 1] < this.today && v.dates.every((d) => d in this.data.store.days)) out.push(+w);
    }
    return out.sort((a, b) => a - b);
  }
}

export function power(data: LeagueData, today?: string): Power {
  const ctx = new Context(data, today);
  const weeks = ctx.completedWeeks();
  if (!weeks.length) return { available: false } as Power;
  const teams = ctx.teams;

  // per week: every team's totals, real result, and all-play record
  const perWeek: Record<number, { allplay: Record<string, Rec>; beat: Record<string, number>; real: Record<string, Rec> }> = {};
  for (const w of weeks) {
    const wk = data.week(w, teams);
    const totals: Record<string, StatLine> = {};
    for (const t of teams) totals[t] = teamWeekTotals(wk, t, [], {})[0];
    const allplay: Record<string, Rec> = {}, beat: Record<string, number> = {};
    for (const t of teams) { allplay[t] = [0, 0, 0]; beat[t] = 0; }
    teams.forEach((a, i) => {
      for (const b of teams.slice(i + 1)) {
        const s = headToHead(totals[a], totals[b], ctx.league), sc = s.score!;
        allplay[a][0] += sc.W; allplay[a][1] += sc.L; allplay[a][2] += sc.T;
        allplay[b][0] += sc.L; allplay[b][1] += sc.W; allplay[b][2] += sc.T;
        if (s.result === "W") beat[a] += 1;
        if (s.result === "L") beat[b] += 1;
      }
    });
    const real: Record<string, Rec> = {};
    for (const [a, b] of data.store.weeks[String(w)].pairs) {
      const sc = headToHead(totals[a], totals[b], ctx.league).score!;
      real[a] = [sc.W, sc.L, sc.T];
      real[b] = [sc.L, sc.W, sc.T];
    }
    perWeek[w] = { allplay, beat, real };
  }

  // roster strength today: summed z of the best available players
  const roster: Record<string, number> = {};
  for (const t of teams) {
    roster[t] = ctx.available(t).map((p) => ctx.z[p] ?? 0).sort((a, b) => b - a).slice(0, ctx.slots).reduce((a, b) => a + b, 0);
  }
  const lo = Math.min(...Object.values(roster)), hi = Math.max(...Object.values(roster));
  const rosterNorm: Record<string, number> = {};
  for (const t of teams) rosterNorm[t] = hi > lo ? (roster[t] - lo) / (hi - lo) : 0.5;

  const sumRec = (ws: number[], pick: (w: number) => Rec | undefined): Rec =>
    [0, 1, 2].map((i) => ws.reduce((a, w) => a + (pick(w)?.[i] ?? 0), 0)) as Rec;
  type Row = Omit<Power["teams"][number], "prev_rank" | "standing"> & { record_pct: number; roster_norm: number };
  const table = (ws: number[]): Record<string, Row> => {
    const rows: Record<string, Row> = {};
    for (const t of teams) {
      const ap = sumRec(ws, (w) => perWeek[w].allplay[t]);
      const fm = sumRec(ws.slice(-2), (w) => perWeek[w].allplay[t]);
      const rl = sumRec(ws, (w) => perWeek[w].real[t]);
      rows[t] = {
        team: t, name: ctx.names[t], rank: 0,
        power: 100 * (W_ALLPLAY * pct(ap) + W_FORM * pct(fm) + W_ROSTER * rosterNorm[t]),
        allplay: ap, allplay_pct: pct(ap), form_pct: pct(fm), record: rl, record_pct: pct(rl), luck: pct(rl) - pct(ap),
        beat: ws.reduce((a, w) => a + perWeek[w].beat[t], 0), beat_of: ws.length * (teams.length - 1),
        roster: roster[t], roster_norm: rosterNorm[t],
      };
    }
    Object.values(rows).sort((a, b) => b.power - a.power).forEach((r, i) => { r.rank = i + 1; });
    return rows;
  };

  const now = table(weeks);
  const prev = weeks.length > 1 ? table(weeks.slice(0, -1)) : null;
  const standing: Record<string, number> = {};
  Object.values(now).sort((a, b) => b.record_pct - a.record_pct).forEach((r, i) => { standing[r.team] = i + 1; });
  const out = Object.values(now).sort((a, b) => a.rank - b.rank).map((r) => ({
    ...r, standing: standing[r.team], prev_rank: prev ? prev[r.team].rank : null,
    weekly: weeks.map((w) => ({ week: w, allplay_pct: pct(perWeek[w].allplay[r.team]), beat: perWeek[w].beat[r.team] })),
  }));
  return { available: true, weeks, teams: out, weights: { allplay: W_ALLPLAY, form: W_FORM, roster: W_ROSTER } } as Power;
}

/** team -> rank (1 = best). Equal values share the better rank. */
function rankOf(values: Record<string, number>): Record<string, number> {
  const order = Object.keys(values).sort((a, b) => values[b] - values[a]);
  const out: Record<string, number> = {};
  let prev: number | null = null, prevRank = 0;
  order.forEach((t, i) => {
    if (prev !== null && Math.abs(values[t] - prev) < 1e-12) out[t] = prevRank;
    else { out[t] = i + 1; prevRank = i + 1; }
    prev = values[t];
  });
  return out;
}

/** The same season under other scoring formats.
 *    h2h      Head-to-Head Each Category (the league's real format)
 *    one_win  Head-to-Head One Win: one result per week
 *    roto     Rotisserie: rank points per category on season totals (ties share points)
 *    points   Points league with Yahoo's default values
 *  Records use completed weeks; season totals run through the last synced day. */
export function standings(data: LeagueData, today?: string): Standings {
  const ctx = new Context(data, today);
  const lg = ctx.league, teams = ctx.teams;
  const done = new Set(ctx.completedWeeks());
  const weeks = Object.entries(data.store.weeks)
    .filter(([, v]) => v.dates?.length && v.dates.some((d) => d in data.store.days)).map(([w]) => +w).sort((a, b) => a - b);
  if (!weeks.length) return { available: false } as Standings;
  const ptsLg: EngineLeague = { scoring: "points", modifiers: DEFAULT_POINTS, categories: [] };

  const season: Record<string, StatLine> = {};
  const h2h: Record<string, Rec> = {}, one: Record<string, Rec> = {}, ptsrec: Record<string, Rec> = {};
  for (const t of teams) { season[t] = {}; h2h[t] = [0, 0, 0]; one[t] = [0, 0, 0]; ptsrec[t] = [0, 0, 0]; }
  for (const w of weeks) {
    const wk = data.week(w, teams);
    const totals: Record<string, StatLine> = {};
    for (const t of teams) { totals[t] = teamWeekTotals(wk, t, [], {})[0]; season[t] = addLines([season[t], totals[t]]); }
    if (!done.has(w)) continue;
    for (const [a, b] of data.store.weeks[String(w)].pairs) {
      const res = headToHead(totals[a], totals[b], lg), sc = res.score!;
      (["W", "L", "T"] as const).forEach((k, i) => { h2h[a][i] += sc[k]; h2h[b][i] += sc[FLIP[k]]; });
      one[a][IDX[res.result]] += 1;
      one[b][IDX[FLIP[res.result]]] += 1;
      const pr = headToHead(totals[a], totals[b], ptsLg).result;
      ptsrec[a][IDX[pr]] += 1;
      ptsrec[b][IDX[FLIP[pr]]] += 1;
    }
  }

  // rotisserie
  const n = teams.length;
  const catVals = Object.fromEntries(teams.map((t) => [t, categoryValues(season[t], lg)]));
  const rotoPts: Record<string, number> = {};
  const rotoCats: Record<string, StandingsTeam["roto"]["cats"]> = {};
  for (const t of teams) { rotoPts[t] = 0; rotoCats[t] = {}; }
  for (const c of lg.categories) {
    const vals: Record<string, number> = {};
    for (const t of teams) vals[t] = catVals[t][c.key] ?? (c.higher ? -1e18 : 1e18);
    const order = [...teams].sort((a, b) => (c.higher ? vals[b] - vals[a] : vals[a] - vals[b]));     // best first
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && Math.abs(vals[order[j + 1]] - vals[order[i]]) < 1e-12) j += 1;
      let share = 0;
      for (let pos = i; pos <= j; pos++) share += n - pos;
      share /= j - i + 1;                                   // tied teams share the points
      for (const t of order.slice(i, j + 1)) {
        rotoCats[t][c.key] = { value: catVals[t][c.key], points: share, rank: i + 1 };
        rotoPts[t] += share;
      }
      i = j + 1;
    }
  }

  const fpts = Object.fromEntries(teams.map((t) => [t, fantasyPoints(season[t], ptsLg)]));
  const pcts = (m: Record<string, Rec>) => Object.fromEntries(teams.map((t) => [t, pct(m[t])]));
  const rH2h = rankOf(pcts(h2h)), rOne = rankOf(pcts(one)), rRoto = rankOf(rotoPts), rFpts = rankOf(fpts), rPtsrec = rankOf(pcts(ptsrec));
  const rows: StandingsTeam[] = teams.map((t) => ({
    team: t, name: ctx.names[t],
    h2h: { record: h2h[t], pct: pct(h2h[t]), rank: rH2h[t] },
    one_win: { record: one[t], pct: pct(one[t]), rank: rOne[t] },
    roto: { points: rotoPts[t], rank: rRoto[t], cats: rotoCats[t] },
    points: { total: fpts[t], rank: rFpts[t], record: ptsrec[t], record_rank: rPtsrec[t] },
  }));
  rows.sort((a, b) => a.h2h.rank - b.h2h.rank || a.roto.rank - b.roto.rank);
  const days = Object.keys(data.store.days).sort();
  return { available: true, teams: rows, n, weeks_done: [...done].sort((a, b) => a - b), weeks_total: weeks,
           last_day: days[days.length - 1], point_values: DEFAULT_POINTS } as Standings;
}

// ---------------------------------------------------------------- matchup luck

export interface LuckRow { team: string; name: string; result: "W" | "L" | "T"; beaten: number; of: number; luck: number }

/** Matchup luck per completed week: the real result (win 1, tie 0.5, loss 0) minus the share of
 *  the league the team would have beaten that week (all-play). +1 is the most lucky a week can be. */
export function luck(data: LeagueData, today?: string): { available: boolean; weeks: number[]; byWeek: Record<number, LuckRow[]>; season: { team: string; name: string; wins: number; losses: number; ties: number; luck: number }[] } {
  const ctx = new Context(data, today);
  const weeks = ctx.completedWeeks();
  const teams = ctx.teams;
  if (!weeks.length) return { available: false, weeks: [], byWeek: {}, season: [] };
  const season: Record<string, { wins: number; losses: number; ties: number; luck: number }> = {};
  for (const t of teams) season[t] = { wins: 0, losses: 0, ties: 0, luck: 0 };
  const byWeek: Record<number, LuckRow[]> = {};
  const of = teams.length - 1;

  for (const w of weeks) {
    const wk = data.week(w, teams);
    const totals: Record<string, StatLine> = {};
    for (const t of teams) totals[t] = teamWeekTotals(wk, t, [], {})[0];
    const beat: Record<string, number> = Object.fromEntries(teams.map((t) => [t, 0]));
    teams.forEach((a, i) => {
      for (const b of teams.slice(i + 1)) {
        const r = headToHead(totals[a], totals[b], ctx.league).result;
        if (r === "W") beat[a] += 1;
        if (r === "L") beat[b] += 1;
      }
    });
    const rows: LuckRow[] = [];
    for (const [a, b] of data.store.weeks[String(w)].pairs) {
      const res = headToHead(totals[a], totals[b], ctx.league).result as "W" | "L" | "T";
      for (const [t, r] of [[a, res], [b, FLIP[res]]] as const) {
        const actual = r === "W" ? 1 : r === "T" ? 0.5 : 0;
        const l = actual - beat[t] / of;
        rows.push({ team: t, name: ctx.names[t], result: r, beaten: beat[t], of, luck: l });
        season[t].luck += l;
        if (r === "W") season[t].wins += 1; else if (r === "L") season[t].losses += 1; else season[t].ties += 1;
      }
    }
    byWeek[w] = rows.sort((x, y) => y.luck - x.luck);
  }
  const seasonRows = teams.map((t) => ({ team: t, name: ctx.names[t], ...season[t] })).sort((x, y) => y.luck - x.luck);
  return { available: true, weeks, byWeek, season: seasonRows };
}

// ---------------------------------------------------------------- league position, week by week

export interface PositionRow { week: number; rank: number; record: Rec; result: "W" | "L" | "T" | null; score: Score | null; opponent: string | null }

/** Place in the league's real standings (H2H categories, by win rate) after each completed week.
 *  Same records as `standings`, so the last row matches its rank. Equal win rates share a place. */
export function positionHistory(data: LeagueData, today?: string): { weeks: number[]; teams: Record<string, PositionRow[]> } {
  const ctx = new Context(data, today);
  const lg = ctx.league, teams = ctx.teams;
  const weeks = ctx.completedWeeks();
  const rec: Record<string, Rec> = Object.fromEntries(teams.map((t) => [t, [0, 0, 0] as Rec]));
  const out: Record<string, PositionRow[]> = Object.fromEntries(teams.map((t) => [t, []]));
  for (const w of weeks) {
    const wk = data.week(w, teams);
    const totals: Record<string, StatLine> = {};
    for (const t of teams) totals[t] = teamWeekTotals(wk, t, [], {})[0];
    const played: Record<string, { result: "W" | "L" | "T"; score: Score; opponent: string }> = {};
    for (const [a, b] of data.store.weeks[String(w)].pairs) {
      const res = headToHead(totals[a], totals[b], lg), sc = res.score!;
      (["W", "L", "T"] as const).forEach((k, i) => { rec[a][i] += sc[k]; rec[b][i] += sc[FLIP[k]]; });
      played[a] = { result: res.result, score: sc, opponent: b };
      played[b] = { result: FLIP[res.result], score: { W: sc.L, L: sc.W, T: sc.T }, opponent: a };
    }
    const ranks = rankOf(Object.fromEntries(teams.map((t) => [t, pct(rec[t])])));
    for (const t of teams) {
      const p = played[t];
      out[t].push({ week: w, rank: ranks[t], record: [...rec[t]] as Rec, result: p?.result ?? null, score: p?.score ?? null, opponent: p?.opponent ?? null });
    }
  }
  return { weeks, teams: out };
}
