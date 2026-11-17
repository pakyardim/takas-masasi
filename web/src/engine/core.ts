// Pure statistics: category comparison, z-scores, trade evaluation and week replays.
// Works on plain objects, independent of where the data comes from.
//
// Stat lines use keys like PTS, REB, AST, ST, BLK, TO, 3PTM, FGM, FGA, FTM, FTA, GP.

import type { Brief, Category, Matchup, Res, StatLine } from "../types";

export interface EngineLeague {
  scoring: "categories" | "points";
  categories: Category[];
  modifiers?: Record<string, number>;
}
export type Line = StatLine | null | undefined;
export interface LineupEntry { player: string; slot: string }
export interface WeekDay { date: string; lineups: Record<string, LineupEntry[]>; stats: Record<string, Line> }
export interface Week { week?: number; start?: string; end?: string; days: WeekDay[] }
export interface EngineEdit { team: string; type?: "swap" | "bench" | "start"; out?: string; in?: string; player?: string; dates?: string[] | null }
export type CatValues = Record<string, number | null>;

export const INACTIVE_SLOTS = new Set(["BN", "IL", "IL+", "IR", "NA"]);

// ---------------------------------------------------------------- basics

/** Sum any number of stat lines (missing keys count as 0). */
export function addLines(lines: Iterable<Line>): StatLine {
  const total: StatLine = {};
  for (const line of lines) {
    if (!line) continue;
    for (const k in line) {
      const v = line[k];
      if (typeof v === "number") total[k] = (total[k] ?? 0) + v;
    }
  }
  return total;
}

/** Turn summed components into category values (ratio categories become a percentage). */
export function categoryValues(totals: StatLine, league: EngineLeague): CatValues {
  const out: CatValues = {};
  for (const cat of league.categories) {
    if (cat.ratio) {
      const [num, den] = cat.ratio;
      const d = totals[den] ?? 0;
      out[cat.key] = d ? (totals[num] ?? 0) / d : null;
    } else {
      out[cat.key] = totals[cat.key] ?? 0;
    }
  }
  return out;
}

export function fantasyPoints(totals: StatLine, league: EngineLeague): number {
  let s = 0;
  for (const [stat, pts] of Object.entries(league.modifiers ?? {})) s += (totals[stat] ?? 0) * pts;
  return s;
}

const isClose = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 1e-9);

/** Result of one category from A's point of view. */
export function compareCat(a: number | null | undefined, b: number | null | undefined, higher: boolean): Res {
  if (a == null && b == null) return "T";
  if (a == null) return "L";
  if (b == null) return "W";
  if (isClose(a, b)) return "T";
  return (a > b) === higher ? "W" : "L";
}

/** Full matchup result between two summed stat lines. */
export function headToHead(aTotals: StatLine, bTotals: StatLine, league: EngineLeague): Matchup {
  if (league.scoring === "points") {
    const pa = fantasyPoints(aTotals, league), pb = fantasyPoints(bTotals, league);
    return { a_points: pa, b_points: pb, result: compareCat(pa, pb, true) };
  }
  const av = categoryValues(aTotals, league), bv = categoryValues(bTotals, league);
  const score = { W: 0, L: 0, T: 0 };
  const categories = league.categories.map((cat) => {
    const r = compareCat(av[cat.key], bv[cat.key], cat.higher);
    score[r] += 1;
    return { key: cat.key, a: av[cat.key], b: bv[cat.key], result: r };
  });
  return { categories, score, result: score.W > score.L ? "W" : score.L > score.W ? "L" : "T" };
}

// ---------------------------------------------------------------- z-scores

export interface ZModel { rates: Record<string, number>; stats: Record<string, [number, number]> }

/** Per-player raw value for z-scoring. Ratio categories use volume-weighted impact
 *  (makes - league rate x attempts), so 60% on 2 attempts matters less than 50% on 20. */
function catRawValue(avg: StatLine, cat: Category, rates: Record<string, number>): number {
  if (cat.ratio) return (avg[cat.ratio[0]] ?? 0) - rates[cat.key] * (avg[cat.ratio[1]] ?? 0);
  return avg[cat.key] ?? 0;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Mean and (population) standard deviation per category over a player pool. */
export function buildZModel(pool: Record<string, StatLine>, league: EngineLeague): ZModel {
  const players = Object.values(pool);
  const rates: Record<string, number> = {};
  for (const cat of league.categories) {
    if (!cat.ratio) continue;
    const tn = sum(players.map((p) => p[cat.ratio![0]] ?? 0)), td = sum(players.map((p) => p[cat.ratio![1]] ?? 0));
    rates[cat.key] = td ? tn / td : 0;
  }
  const stats: Record<string, [number, number]> = {};
  for (const cat of league.categories) {
    const vals = players.map((p) => catRawValue(p, cat, rates));
    const mu = vals.length ? sum(vals) / vals.length : 0;
    const sd = vals.length > 1 ? Math.sqrt(sum(vals.map((v) => (v - mu) ** 2)) / vals.length) : 0;
    // a spread of ~0 (everyone identical) would turn float noise into huge z-scores
    stats[cat.key] = [mu, sd > 1e-9 ? sd : 1];
  }
  return { rates, stats };
}

export function playerZ(avg: StatLine, league: EngineLeague, model: ZModel): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const cat of league.categories) {
    const [mu, sd] = model.stats[cat.key];
    const z = (catRawValue(avg, cat, model.rates) - mu) / sd;
    out[cat.key] = cat.higher ? z : -z;
    total += out[cat.key];
  }
  out.TOTAL = total;
  return out;
}

// ---------------------------------------------------------------- trade analysis

const FPTS: Category = { key: "FPTS", label: "FPTS", higher: true };

/** Per-game sum of each roster -> category value (or fantasy points). */
function teamStrengths(rosters: Record<string, string[]>, avgs: Record<string, StatLine>, league: EngineLeague): Record<string, CatValues> {
  const out: Record<string, CatValues> = {};
  for (const [team, players] of Object.entries(rosters)) {
    const totals = addLines(players.map((p) => avgs[p]));
    out[team] = league.scoring === "points" ? { FPTS: fantasyPoints(totals, league) } : categoryValues(totals, league);
  }
  return out;
}

/** team -> {category: rank (1 = best)} */
function ranks(strengths: Record<string, CatValues>, league: EngineLeague): Record<string, Record<string, number>> {
  const cats = league.scoring === "points" ? [FPTS] : league.categories;
  const out: Record<string, Record<string, number>> = {};
  const teams = Object.keys(strengths);
  for (const t of teams) out[t] = {};
  for (const cat of cats) {
    const filler = cat.higher ? -Infinity : Infinity;
    const val = (t: string) => strengths[t][cat.key] ?? filler;
    const ordered = [...teams].sort((x, y) => (cat.higher ? val(y) - val(x) : val(x) - val(y)) || 0);
    ordered.forEach((t, i) => { out[t][cat.key] = i + 1; });
  }
  return out;
}

export interface TradeEval {
  scoring: "categories" | "points"; value_metric: string;
  categories: { key: string; label: string; higher: boolean; a_gives: number | null; b_gives: number | null; a_net: number | null; b_net: number | null; better_for_a: Res; better_for_b: Res }[];
  players: Record<string, { avg: StatLine; z?: Record<string, number>; fpts?: number }>;
  a_gives_value: number; b_gives_value: number; a_net_value: number; b_net_value: number;
  roster_spots: { a_net: number; b_net: number };
  moves: { drops_a: string[]; drops_b: string[]; adds_a: string[]; adds_b: string[] };
  team_impact: Record<string, { key: string; label: string; before: number | null; after: number | null; rank_before: number; rank_after: number }[]>;
  teams: { a: string; b: string }; league_size: number;
}

/** Compare two trade packages purely statistically.
 *  A team's net = (received + added) - (given + dropped). */
export function evaluateTrade(
  league: EngineLeague, rosters: Record<string, string[]>, avgs: Record<string, StatLine>,
  teamA: string, giveA: string[], teamB: string, giveB: string[], pool?: Record<string, StatLine>,
  opts: { dropsA?: string[]; dropsB?: string[]; addsA?: string[]; addsB?: string[] } = {},
): TradeEval {
  pool = pool ?? avgs;
  const isPts = league.scoring === "points";
  const dropsA = opts.dropsA ?? [], dropsB = opts.dropsB ?? [], addsA = opts.addsA ?? [], addsB = opts.addsB ?? [];
  const cats = isPts ? [FPTS] : league.categories;

  const pkg = (players: string[]): CatValues => {
    const totals = addLines(players.map((p) => avgs[p]));
    return isPts ? { FPTS: fantasyPoints(totals, league) } : categoryValues(totals, league);
  };
  const aVals = pkg(giveA), bVals = pkg(giveB);

  const zmodel = isPts ? null : buildZModel(pool, league);
  const players: TradeEval["players"] = {};
  for (const p of [...giveA, ...giveB, ...dropsA, ...dropsB, ...addsA, ...addsB]) {
    const avg = avgs[p] ?? {};
    players[p] = isPts ? { avg, fpts: fantasyPoints(avg, league) } : { avg, z: playerZ(avg, league, zmodel!) };
  }
  const totalValue = (pl: string[]) => sum(pl.map((p) => (isPts ? players[p].fpts! : players[p].z!.TOTAL)));

  // rosters after the trade, the forced drops and the pickups
  const after: Record<string, string[]> = {};
  for (const [t, ps] of Object.entries(rosters)) after[t] = [...ps];
  const goneA = new Set([...giveA, ...dropsA]), goneB = new Set([...giveB, ...dropsB]);
  after[teamA] = [...after[teamA], ...giveB].filter((p) => !goneA.has(p)).concat(addsA);
  after[teamB] = [...after[teamB], ...giveA].filter((p) => !goneB.has(p)).concat(addsB);
  const sBefore = teamStrengths(rosters, avgs, league), sAfter = teamStrengths(after, avgs, league);
  const rBefore = ranks(sBefore, league), rAfter = ranks(sAfter, league);

  const impact = (team: string) => cats.map((c) => ({
    key: c.key, label: c.label ?? c.key, before: sBefore[team][c.key], after: sAfter[team][c.key],
    rank_before: rBefore[team][c.key], rank_after: rAfter[team][c.key],
  }));
  const net = (team: string, k: string) => {
    const b = sBefore[team][k], a = sAfter[team][k];
    return a == null || b == null ? null : a - b;
  };
  // net = change of the team's own per-game total (for % categories: of the team's percentage)
  const categories = cats.map((cat) => ({
    key: cat.key, label: cat.label ?? cat.key, higher: cat.higher,
    a_gives: aVals[cat.key], b_gives: bVals[cat.key], a_net: net(teamA, cat.key), b_net: net(teamB, cat.key),
    better_for_a: compareCat(sAfter[teamA][cat.key], sBefore[teamA][cat.key], cat.higher),
    better_for_b: compareCat(sAfter[teamB][cat.key], sBefore[teamB][cat.key], cat.higher),
  }));

  const aVal = totalValue(giveA), bVal = totalValue(giveB);
  return {
    scoring: league.scoring, value_metric: isPts ? "FPTS/G" : "z-score",
    categories, players,
    a_gives_value: aVal, b_gives_value: bVal,
    a_net_value: bVal + totalValue(addsA) - aVal - totalValue(dropsA),
    b_net_value: aVal + totalValue(addsB) - bVal - totalValue(dropsB),
    roster_spots: { a_net: giveA.length - giveB.length, b_net: giveB.length - giveA.length },
    moves: { drops_a: dropsA, drops_b: dropsB, adds_a: addsA, adds_b: addsB },
    team_impact: { [teamA]: impact(teamA), [teamB]: impact(teamB) },
    teams: { a: teamA, b: teamB }, league_size: Object.keys(rosters).length,
  };
}

// ---------------------------------------------------------------- what-if replay

/** Apply scenario edits to one team's lineup on one day.
 *    swap  {out, in}   "in" takes "out"'s slot; if "in" is already on this lineup their
 *                      slots are exchanged (bench decisions)
 *    bench {player}    moved to the bench
 *    start {player}    moved into an active slot
 *  An edit with "dates" only applies on those dates. */
export function applyEdits(lineup: LineupEntry[], edits: EngineEdit[], day?: string): LineupEntry[] {
  const out = lineup.map((e) => ({ ...e }));
  for (const s of edits) {
    if (s.dates?.length && !s.dates.includes(day ?? "")) continue;
    const kind = s.type ?? "swap";
    if (kind === "swap") {
      const outE = out.find((e) => e.player === s.out);
      if (!outE) continue;
      const inE = out.find((e) => e.player === s.in);
      if (inE) [outE.slot, inE.slot] = [inE.slot, outE.slot];
      else outE.player = s.in!;
    } else {
      const e = out.find((x) => x.player === s.player);
      if (e) e.slot = kind === "bench" ? "BN" : "UTIL";
    }
  }
  return out;
}

export type ExtraStats = Record<string, Record<string, Line>>;
export interface Overfull { team: string; date: string; played: number; slots: number }

const statFor = (player: string, day: WeekDay, extra: ExtraStats): Line =>
  player in day.stats ? day.stats[player] : extra[player]?.[day.date];

/** Sum the stats of a team's active players over the week, after edits.
 *  Returns [totals, per-player totals for players in `track`]. */
export function teamWeekTotals(
  week: Week, team: string, edits: EngineEdit[], extra: ExtraStats,
  track: Iterable<string> = [], overfull?: Overfull[], activeSlots?: number,
): [StatLine, Record<string, StatLine>] {
  const lines: StatLine[] = [];
  const tracked: Record<string, StatLine[]> = {};
  for (const p of track) tracked[p] = [];
  for (const day of week.days) {
    const lineup = applyEdits(day.lineups[team] ?? [], edits, day.date);
    let played = 0;
    for (const e of lineup) {
      if (INACTIVE_SLOTS.has(e.slot)) continue;
      const line = statFor(e.player, day, extra);
      if (line && Object.keys(line).length) {
        played += 1;
        lines.push(line);
        if (e.player in tracked) tracked[e.player].push(line);
      }
    }
    if (overfull && activeSlots && played > activeSlots) overfull.push({ team, date: day.date, played, slots: activeSlots });
  }
  // GP = games counted in an active slot (daily lines carry no GP of their own)
  const per: Record<string, StatLine> = {};
  for (const [p, ls] of Object.entries(tracked)) per[p] = ls.length ? { ...addLines(ls), GP: ls.length } : {};
  return [addLines(lines), per];
}

const editPlayers = (edits: EngineEdit[]) => {
  const out = new Set<string>();
  for (const s of edits) for (const k of [s.out, s.in, s.player]) if (k) out.add(k);
  return out;
};

export interface WhatIf {
  scoring: "categories" | "points"; actual: Matchup; hypothetical: Matchup; flipped: boolean;
  players: Record<string, { actual: StatLine; hypothetical: StatLine }>; warnings: Overfull[];
}

/** Replay a week's matchup between any two teams. */
export function whatIf(league: EngineLeague, week: Week, teamA: string, teamB: string, edits: EngineEdit[],
                       extra: ExtraStats = {}, activeSlots?: number): WhatIf {
  const track = editPlayers(edits);
  const warnings: Overfull[] = [];
  const run = (ed: EngineEdit[], warn?: Overfull[]) => {
    const [ta, pa] = teamWeekTotals(week, teamA, ed.filter((s) => s.team === teamA), extra, track, warn, activeSlots);
    const [tb, pb] = teamWeekTotals(week, teamB, ed.filter((s) => s.team === teamB), extra, track, warn, activeSlots);
    return { ta, tb, pa, pb };
  };
  const r0 = run([]), r1 = run(edits, warnings);
  const actual = headToHead(r0.ta, r0.tb, league), hypothetical = headToHead(r1.ta, r1.tb, league);
  if (league.scoring !== "points") {
    hypothetical.categories!.forEach((c, i) => { c.changed = actual.categories![i].result !== c.result; });
  }
  // contribution of each edited player in active slots (actual vs hypothetical)
  const players: WhatIf["players"] = {};
  for (const p of track) {
    players[p] = { actual: addLines([r0.pa[p], r0.pb[p]]), hypothetical: addLines([r1.pa[p], r1.pb[p]]) };
  }
  return { scoring: league.scoring, actual, hypothetical, flipped: actual.result !== hypothetical.result, players, warnings };
}

const brief = (res: Matchup): Brief =>
  res.score ? { score: res.score, result: res.result } : { a_points: res.a_points, b_points: res.b_points, result: res.result };

/** The team's week against every other team's week. Only the team's own edits are
 *  applied; opponents keep their real week. */
export function versusAll(league: EngineLeague, week: Week, team: string, others: string[],
                          edits: EngineEdit[] = [], extra: ExtraStats = {}): { team: string; actual: Brief; hypothetical?: Brief }[] {
  const mine = edits.filter((s) => s.team === team);
  const [t0] = teamWeekTotals(week, team, [], extra);
  const t1 = mine.length ? teamWeekTotals(week, team, mine, extra)[0] : t0;
  return others.map((o) => {
    const [to] = teamWeekTotals(week, o, [], extra);
    const row: { team: string; actual: Brief; hypothetical?: Brief } = { team: o, actual: brief(headToHead(t0, to, league)) };
    if (mine.length) row.hypothetical = brief(headToHead(t1, to, league));
    return row;
  });
}
