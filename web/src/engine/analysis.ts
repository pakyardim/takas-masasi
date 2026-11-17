// Draft and transaction analysis.
//
// Everything is measured with one yardstick, "değer" (value over replacement):
//   per game:  the player's z-score total (same z-scores as the trade tab)
//              minus the z-score of a replacement-level player
//   value   =  that difference summed over games
// Replacement level = what the waiver wire offers: the average z-score of the twenty
// best players who are not on any roster (from the league-wide player list).
// A player who never plays is worth 0; a below-replacement player who plays is
// negative. Because z-scores are linear in the stats, summing single games gives
// the same number as (per-game z - replacement) x games.

import type { DraftPick, DraftReport, DraftTeam, MovesReport, Pickup, Player, StatLine, Stint } from "../types";
import { buildZModel, INACTIVE_SLOTS, playerZ, type EngineLeague, type ZModel } from "./core";
import type { LeagueData, RawStore, RawTx } from "./data";

const REPLACEMENT_POOL = 20;
const DAY = 86400000;
const shift = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);

/** Sortable [date, minutes] for a transaction; ts looks like "Oct 31, 4:57 pm". */
function tsKey(tx: { date: string; ts: string }): [string, number] {
  const m = tx.ts.match(/, (\d{1,2}):(\d{2}) (am|pm)$/);
  if (!m) return [tx.date, 0];
  return [tx.date, ((+m[1] % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + +m[2]];
}
const cmpKey = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);

export class Valuer {
  readonly store: RawStore;
  readonly league: EngineLeague;
  readonly rosters: Record<string, string[]>;
  readonly owner: Record<string, string> = {};
  readonly avg: Record<string, StatLine> = {};
  readonly model: ZModel;
  readonly z: Record<string, number> = {};
  readonly repl: number;
  readonly hasPool: boolean;
  readonly seasonValue: Record<string, number> = {};
  readonly valueRank: Record<string, number> = {};
  readonly dates: string[];
  private outs = new Map<string, [string, number][]>();
  private used = new Set<string>();      // "team|player|day" already credited to an earlier move

  constructor(data: LeagueData) {
    this.store = data.store;
    this.league = data.engineLeague();
    this.rosters = data.rosters();
    for (const [t, ps] of Object.entries(this.rosters)) for (const p of ps) this.owner[p] = t;
    const rostered = new Set(Object.keys(this.owner));
    const has = (v: StatLine | undefined): v is StatLine => !!v && Object.keys(v).length > 0;
    // season per-game averages of everyone we know (rostered players win over the pool copy)
    for (const [k, v] of Object.entries(this.store.pool ?? {})) if (has(v)) this.avg[k] = v;
    for (const [k, v] of Object.entries(data.base.averages.season ?? {})) if (has(v)) this.avg[k] = v;
    const modelPool: Record<string, StatLine> = {};
    for (const k of rostered) if (this.avg[k]?.GP) modelPool[k] = this.avg[k];
    const fallback: Record<string, StatLine> = {};
    for (const [k, v] of Object.entries(this.avg)) if (v.GP) fallback[k] = v;
    this.model = buildZModel(Object.keys(modelPool).length ? modelPool : fallback, this.league);
    for (const [k, v] of Object.entries(this.avg)) if (v.GP) this.z[k] = playerZ(v, this.league, this.model).TOTAL;

    // replacement level: what the waiver wire offers = mean z of the 20 best unrostered players
    const free = Object.entries(this.z).filter(([k]) => !rostered.has(k) && this.avg[k].GP >= 3).map(([, z]) => z).sort((a, b) => b - a);
    this.hasPool = free.length > 0;
    if (free.length) {
      const top = free.slice(0, REPLACEMENT_POOL);
      this.repl = top.reduce((a, b) => a + b, 0) / top.length;
    } else {   // no free-agent data yet: approximate with the 15th percentile of rostered players
      const ranked = Object.values(this.z).sort((a, b) => b - a);
      this.repl = ranked.length ? ranked[Math.floor(ranked.length * 0.85)] : 0;
    }
    // season-to-date value of every known player, and their rank by it
    for (const [k, z] of Object.entries(this.z)) this.seasonValue[k] = (z - this.repl) * this.avg[k].GP;
    Object.keys(this.seasonValue).sort((a, b) => this.seasonValue[b] - this.seasonValue[a]).forEach((k, i) => { this.valueRank[k] = i + 1; });
    this.dates = Object.keys(this.store.days).sort();

    // when did a player leave a team? (drop, or traded to someone else) -> bounds a stint
    const push = (team: string, pid: string, key: [string, number]) => {
      const k = `${team}|${pid}`;
      if (!this.outs.has(k)) this.outs.set(k, []);
      this.outs.get(k)!.push(key);
    };
    for (const tx of Object.values(this.store.transactions ?? {})) {
      for (const m of tx.moves) {
        if (m.action === "drop") push(tx.team, m.player, tsKey(tx));
        else if (m.action === "trade") for (const t of Object.keys(this.rosters)) if (t !== tx.team) push(t, m.player, tsKey(tx));
      }
    }
    for (const v of this.outs.values()) v.sort(cmpKey);
  }

  gameValue(line: StatLine): number { return playerZ(line, this.league, this.model).TOTAL - this.repl; }

  info(pid: string): Player {
    const p = this.store.players[pid] ?? {};
    return { key: pid, name: p.name ?? pid, nba_team: p.nba_team ?? "", positions: p.positions ?? [], status: p.status ?? "", owner: this.owner[pid] ?? null };
  }

  /** What a player produced for a team after a move (add / trade) until he left it.
   *  Starts at the first stored day on/after the move date - 1 (time zones) where he is on
   *  that roster, never before the team's previous drop of him, and ends when he leaves the
   *  roster or at the team's next drop/trade of him. Each day is credited to one move only.
   *  Call in chronological order. */
  stint(pid: string, team: string, tx: RawTx): Stint & { days: number; value_all: number } {
    const when = tsKey(tx);
    const outs = this.outs.get(`${team}|${pid}`) ?? [];
    let prevOut: [string, number] | null = null, nextOut: [string, number] | null = null;
    for (const o of outs) {
      if (cmpKey(o, when) <= 0) { if (!prevOut || cmpKey(o, prevOut) > 0) prevOut = o; }
      else if (!nextOut || cmpKey(o, nextOut) < 0) nextOut = o;
    }
    let start = shift(tx.date, -1);
    if (prevOut && prevOut[0] > start) start = prevOut[0];
    const giveUp = shift(tx.date, 3);
    const out = { days: 0, games: 0, active_games: 0, value: 0, value_all: 0, first: null as string | null, last: null as string | null, ongoing: false };
    let on = false;
    for (const d of this.dates) {
      if (d < start || this.used.has(`${team}|${pid}|${d}`)) continue;
      if (nextOut && d > nextOut[0]) break;
      const row = (this.store.days[d][team] ?? []).find((r) => r.player === pid);
      if (!row) {
        if (on || d > giveUp) break;      // left the roster / never showed up around that date
        continue;
      }
      on = true;
      this.used.add(`${team}|${pid}|${d}`);
      out.first = out.first ?? d;
      out.last = d;
      out.days += 1;
      if (row.line && Object.keys(row.line).length) {
        const v = this.gameValue(row.line);
        out.games += 1;
        out.value_all += v;
        if (!INACTIVE_SLOTS.has(row.slot)) { out.active_games += 1; out.value += v; }
      }
    }
    out.ongoing = on && this.dates.length > 0 && out.last === this.dates[this.dates.length - 1] && this.owner[pid] === team;
    return out;
  }
}

export function draftReport(data: LeagueData): DraftReport {
  const picks = data.store.draft ?? [];
  if (!picks.length) return { available: false } as DraftReport;
  const v = new Valuer(data);
  const names: Record<string, string> = Object.fromEntries(data.base.teams.map((t) => [t.id, t.name]));

  // What a draft slot "should" return: the drafted players' values sorted best-first,
  // smoothed over +-5 slots. Uses only this draft, so the league's surplus sums to ~0.
  const drafted = picks.map((x) => v.seasonValue[x.player] ?? 0).sort((a, b) => b - a);
  const expectedAt = (overall: number) => {
    const w = drafted.slice(Math.max(0, overall - 1 - 5), Math.min(drafted.length, overall + 5));
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
  };

  const rows: DraftPick[] = picks.map((x) => {
    const avg = v.avg[x.player];
    const value = v.seasonValue[x.player] ?? 0;
    const expected = expectedAt(x.overall);
    return {
      round: x.round, pick: x.pick, overall: x.overall, team: x.team, team_name: (x.team && names[x.team]) || x.team_name,
      player: v.info(x.player), known: avg !== undefined, gp: avg?.GP ?? 0, z: v.z[x.player] ?? null,
      value, rank: v.valueRank[x.player] ?? null, expected, surplus: value - expected, kept: v.owner[x.player] === x.team,
    };
  });
  const teams = new Map<string, DraftTeam>();
  for (const r of rows) {
    const id = r.team || r.team_name;
    if (!teams.has(id)) teams.set(id, { team: r.team, name: r.team_name, total: 0, surplus: 0, picks: 0, kept: 0, best: null, worst: null });
    const t = teams.get(id)!;
    t.total += r.value; t.surplus += r.surplus; t.picks += 1; t.kept += r.kept ? 1 : 0;
    if (r.gp && (t.best === null || r.surplus > t.best.surplus)) t.best = r;
    if (t.worst === null || r.surplus < t.worst.surplus) t.worst = r;
  }
  return {
    available: true, has_pool: v.hasPool, teams: [...teams.values()].sort((a, b) => b.total - a.total), picks: rows,
    unknown: rows.filter((r) => !r.known).length,
  } as DraftReport;
}

export function movesReport(data: LeagueData): MovesReport {
  const txs = Object.values(data.store.transactions ?? {}).sort((a, b) => cmpKey(tsKey(a), tsKey(b)));
  if (!txs.length) return { available: false } as MovesReport;
  const v = new Valuer(data);
  const names: Record<string, string> = Object.fromEntries(data.base.teams.map((t) => [t.id, t.name]));

  type TeamSum = MovesReport["teams"][number];
  type Side = MovesReport["trades"][number]["sides"][number];
  const pickups: Pickup[] = [];
  const teamSum = new Map<string, TeamSum>();
  const trades = new Map<string, { date: string; ts: string; sides: Map<string, Side> }>();
  for (const tx of txs) {
    for (const m of tx.moves) {
      if (m.action === "add") {
        const st = v.stint(m.player, tx.team, tx);
        const p = { date: tx.date, ts: tx.ts, team: tx.team, team_name: names[tx.team], player: v.info(m.player), source: m.source, ...st,
                    per_game: st.active_games ? st.value / st.active_games : null } as Pickup;
        pickups.push(p);
        if (!teamSum.has(tx.team)) teamSum.set(tx.team, { team: tx.team, name: names[tx.team], adds: 0, value: 0, best: null });
        const ts = teamSum.get(tx.team)!;
        ts.adds += 1; ts.value += st.value;
        if (ts.best === null || st.value > ts.best.value) ts.best = p;
      } else if (m.action === "trade") {
        if (!trades.has(tx.ts)) trades.set(tx.ts, { date: tx.date, ts: tx.ts, sides: new Map() });
        const tr = trades.get(tx.ts)!;
        if (!tr.sides.has(tx.team)) tr.sides.set(tx.team, { team: tx.team, name: names[tx.team], players: [], value: 0 });
        const side = tr.sides.get(tx.team)!;
        const st = v.stint(m.player, tx.team, tx);
        side.players.push({ player: v.info(m.player), ...st });
        side.value += st.value;
      }
    }
  }
  for (const t of Object.keys(names)) if (!teamSum.has(t)) teamSum.set(t, { team: t, name: names[t], adds: 0, value: 0, best: null });
  const tradeList = [...trades.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((tr) => ({ date: tr.date, ts: tr.ts, sides: [...tr.sides.values()].sort((a, b) => b.value - a.value) }));
  return {
    available: true, has_pool: v.hasPool, count: txs.length, first: txs[0].date, last: txs[txs.length - 1].date,
    pickups: [...pickups].sort((a, b) => b.value - a.value),
    teams: [...teamSum.values()].sort((a, b) => b.value - a.value),
    trades: tradeList,
  } as MovesReport;
}
