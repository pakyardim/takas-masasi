// The app's "API", computed in the browser from the league file. Each function returns
// exactly what the UI expects (see ../types.ts).
import type {
  AllPlay, Balance, DraftReport, Edit, GridCell, LeagueResponse, MovesReport, Player, Power, Standings, TradeFix, TradeResult, WeekData, WhatIfResult,
} from "../types";
import { draftReport, movesReport } from "./analysis";
import {
  buildZModel, evaluateTrade, fantasyPoints, headToHead, INACTIVE_SLOTS, playerZ, versusAll, whatIf,
  type EngineEdit, type ExtraStats, type Week,
} from "./core";
import type { LeagueData } from "./data";
import { power, standings, todayET } from "./rankings";

export interface TradeRequest extends Partial<TradeFix> { team_a: string; give_a: string[]; team_b: string; give_b: string[]; period?: string }
export interface WhatIfRequest { week: number; team: string; opponent: string; edits: Edit[] }

export class LocalApi {
  private cache = new Map<string, unknown>();
  constructor(readonly data: LeagueData) {}

  private memo<T>(key: string, fn: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as T;
  }

  league(): LeagueResponse {
    const rosters = this.data.rosters();
    return { league: this.data.league(), rosters, players: this.data.playerInfo(Object.values(rosters).flat()) };
  }

  search(q: string): Player[] {
    return q.trim().length < 2 ? [] : this.data.search(q);
  }

  // ---------------------------------------------------------------- trade
  trade(req: TradeRequest): TradeResult {
    if (!req.give_a.length && !req.give_b.length) throw new Error("En az bir oyuncu seç.");
    const d = this.data, lg = d.engineLeague();
    const period = req.period ?? "season";
    const rosters = d.rosters();
    const rostered = new Set(Object.values(rosters).flat());
    const free = d.freeAgents().filter((k) => !rostered.has(k));
    const keys = [...new Set([...rostered, ...req.give_a, ...req.give_b, ...free])].sort();
    const season = d.averages(keys, "season");
    const avgs = period === "season" ? season : d.averages(keys, period);
    // free agents only have season averages: fall back to them
    for (const k of free) if (!avgs[k]?.GP) avgs[k] = season[k] ?? { GP: 0 };
    // z-scores always use season averages of rostered players as the reference pool
    const pool = Object.fromEntries([...rostered].filter((k) => season[k]?.GP).map((k) => [k, season[k]]));
    const isPts = lg.scoring === "points";
    const zmodel = isPts ? null : buildZModel(pool, lg);
    const value = (k: string): number | null => {
      const avg = avgs[k];
      if (!avg?.GP) return null;
      return isPts ? fantasyPoints(avg, lg) : playerZ(avg, lg, zmodel!).TOTAL;
    };

    const cap = d.rosterCapacity(), il = d.ilPlayers();
    const freeRanked = free.filter((k) => (season[k]?.GP ?? 0) >= 3 && value(k) !== null).sort((a, b) => value(b)! - value(a)!);

    /** How many players the team must drop / may add, with suggestions. */
    const balance = (team: string, give: string[], receive: string[], dropsReq: string[] | undefined, addsReq: string[] | undefined, taken: Set<string>): Balance => {
      const ilNow = new Set(il[team] ?? []);
      const regular = rosters[team].filter((p) => !ilNow.has(p));
      const after = [...regular.filter((p) => !give.includes(p)), ...receive.filter((p) => !regular.includes(p))];
      const need = Math.max(0, after.length - cap);
      const freed = Math.max(0, give.length - receive.length);
      const room = Math.min(freed, Math.max(0, cap - after.length));
      // drop candidates: everyone on the roster after the trade, worst first. Players with no
      // games in the period (injured) go last: no data is not a reason to cut someone.
      const cands = [...after].sort((a, b) => {
        const va = value(a), vb = value(b);
        return Number(va === null) - Number(vb === null) || (va ?? 0) - (vb ?? 0);
      });
      const drops = dropsReq ? dropsReq.filter((k) => after.includes(k)).slice(0, need) : [];
      for (const k of cands) {
        if (drops.length >= need) break;
        if (!drops.includes(k)) drops.push(k);
      }
      const options = freeRanked.filter((k) => !taken.has(k)).slice(0, 25);
      const adds = addsReq ? addsReq.filter((k) => free.includes(k) && !taken.has(k)).slice(0, room) : options.slice(0, room);
      adds.forEach((k) => taken.add(k));
      return {
        team, need_drop: need, room, drops, adds,
        drop_options: cands.map((k) => ({ key: k, value: value(k) })),
        add_options: options.map((k) => ({ key: k, value: value(k) })),
        il: [...ilNow].sort(),
      };
    };
    const taken = new Set<string>();
    const balA = balance(req.team_a, req.give_a, req.give_b, req.drops_a, req.adds_a, taken);
    const balB = balance(req.team_b, req.give_b, req.give_a, req.drops_b, req.adds_b, taken);

    const result = evaluateTrade(lg, rosters, avgs, req.team_a, req.give_a, req.team_b, req.give_b, pool,
      { dropsA: balA.drops, dropsB: balB.drops, addsA: balA.adds, addsB: balB.adds });
    const infoKeys = new Set([...req.give_a, ...req.give_b]);
    for (const b of [balA, balB]) {
      for (const k of [...b.drops, ...b.adds, ...b.drop_options.map((o) => o.key), ...b.add_options.map((o) => o.key)]) infoKeys.add(k);
    }
    return {
      ...result,
      balance: { a: balA, b: balB, capacity: cap, has_free_agents: freeRanked.length > 0 },
      info: d.playerInfo([...infoKeys].sort()),
    };
  }

  // ---------------------------------------------------------------- what-if
  private weekAll(week: number): Week {
    return this.memo(`week:${week}`, () => this.data.week(week, this.data.teamKeys()));
  }

  private realOpponent(week: number, team: string): string | null {
    for (const m of this.data.matchups(week)) if (m.includes(team)) return m[0] === team ? m[1] : m[0];
    return null;
  }

  /** A team's week: result vs the chosen (default: real) opponent, daily lineup grid,
   *  and how the same week would have gone against every other team. */
  week(week: number, team: string, opponent?: string | null): WeekData {
    const d = this.data, lg = d.engineLeague();
    const wk = this.weekAll(week);
    const realOpp = this.realOpponent(week, team);
    const opp = opponent || realOpp;
    if (!opp || opp === team) throw new Error("Bu hafta eşleşme bulunamadı.");
    const res = whatIf(lg, wk, team, opp, []);

    const keys = new Set<string>();
    const usage: WeekData["usage"] = {};
    const grid: WeekData["grid"] = {};
    for (const t of [team, opp]) {
      const rows: Record<string, Record<string, GridCell>> = {};
      for (const day of wk.days) {
        for (const e of day.lineups[t] ?? []) {
          keys.add(e.player);
          const line = day.stats[e.player];
          const played = !!line && Object.keys(line).length > 0;
          const active = !INACTIVE_SLOTS.has(e.slot);
          const u = (usage[e.player] ??= { team: t, active_games: 0, bench_games: 0 });
          if (played) u[active ? "active_games" : "bench_games"] += 1;
          (rows[e.player] ??= {})[day.date] = { slot: e.slot, active, played, pts: played ? line!.PTS ?? null : null };
        }
      }
      grid[t] = rows;
    }

    let official = null;
    if (opp === realOpp) {
      const off = d.official(week);
      if (off[team] && off[opp]) official = headToHead(off[team], off[opp], lg);
    }
    const others = d.teamKeys().filter((t) => t !== team);
    return {
      week, start: wk.start!, end: wk.end!, dates: wk.days.map((x) => x.date),
      team, opponent: opp, real_opponent: realOpp,
      result: res.actual, official, players: d.playerInfo([...keys].sort()),
      usage, grid, versus: versusAll(lg, wk, team, others), active_slots: d.activeSlots(),
    };
  }

  whatif(req: WhatIfRequest): WhatIfResult {
    const d = this.data, lg = d.engineLeague();
    const wk = this.weekAll(req.week);
    const known = new Set<string>();
    for (const day of wk.days) for (const p of Object.keys(day.stats)) known.add(p);
    const edits: EngineEdit[] = req.edits.map((e) => {
      const type = e.type ?? "swap";
      if (type === "swap") {
        if (!e.out || !e.into) throw new Error("Değişiklikte çıkan ve giren oyuncu olmalı.");
        return { team: e.team, type, out: e.out, in: e.into, dates: e.dates ?? null };
      }
      if ((type === "bench" || type === "start") && e.player) return { team: e.team, type, player: e.player, dates: e.dates ?? null };
      throw new Error(`Geçersiz değişiklik: ${type}`);
    });
    const extra: ExtraStats = {};
    for (const e of edits) if (e.type === "swap" && e.in && !known.has(e.in)) extra[e.in] = d.playerWeekStats(e.in, req.week);
    const res = whatIf(lg, wk, req.team, req.opponent, edits, extra, d.activeSlots());
    const others = d.teamKeys().filter((t) => t !== req.team);
    return { ...res, info: d.playerInfo(Object.keys(res.players)), versus: versusAll(lg, wk, req.team, others, edits, extra) };
  }

  /** Every week of the season for one team: its score against every other team's week. */
  allplay(team: string, today = todayET()): AllPlay {
    const d = this.data, lgFull = d.league(), lg = d.engineLeague();
    const others = d.teamKeys().filter((t) => t !== team);
    if (others.length === d.teamKeys().length) throw new Error("Takım bulunamadı.");
    const weeks: AllPlay["weeks"] = [];
    for (const w of lgFull.weeks) {
      let wk: Week;
      try { wk = this.weekAll(w.week); } catch { continue; }
      const played = wk.days.some((day) => (day.lineups[team] ?? []).some((e) => { const l = day.stats[e.player]; return !!l && Object.keys(l).length > 0; }));
      if (!played) continue;
      weeks.push({ week: w.week, start: w.start, end: w.end, complete: w.end < today, real_opponent: this.realOpponent(w.week, team), rows: versusAll(lg, wk, team, others) });
    }
    return { team, league: lgFull.name, scoring: lgFull.scoring, teams: lgFull.teams.filter((t) => t.key !== team), weeks };
  }

  // ---------------------------------------------------------------- reports (computed once)
  draft(): DraftReport { return this.memo("draft", () => draftReport(this.data)); }
  moves(): MovesReport { return this.memo("moves", () => movesReport(this.data)); }
  power(): Power { return this.memo("power", () => power(this.data)); }
  standings(): Standings { return this.memo("standings", () => standings(this.data)); }

  /** Answer the same paths the old HTTP API had, so the UI code stays the same. */
  call(path: string, body?: unknown): unknown {
    const url = new URL(path, "http://local");
    const q = url.searchParams, p = url.pathname;
    const week = p.match(/^\/api\/week\/(\d+)$/);
    if (p === "/api/league") return this.league();
    if (p === "/api/search") return this.search(q.get("q") ?? "");
    if (p === "/api/trade") return this.trade(body as TradeRequest);
    if (week) return this.week(+week[1], q.get("team") ?? "", q.get("opponent"));
    if (p === "/api/whatif") return this.whatif(body as WhatIfRequest);
    if (p === "/api/allplay") return this.allplay(q.get("team") ?? "");
    if (p === "/api/draft") return this.draft();
    if (p === "/api/moves") return this.moves();
    if (p === "/api/power") return this.power();
    if (p === "/api/standings") return this.standings();
    throw new Error(`Bilinmeyen istek: ${p}`);
  }
}
