// Read access to the synced league file (data/league.json), in the shapes the engine needs.
import type { Category, League, Player, Players, StatLine } from "../types";
import type { EngineLeague, Week } from "./core";

export interface DayRow { player: string; slot: string; line: StatLine | null; status?: string }
export interface RawPlayer { id?: string; name?: string; nba_team?: string; positions?: string[]; status?: string }
export interface RawWeek { pairs: [string, string][]; dates: string[]; official?: Record<string, StatLine>; final?: boolean }
export interface RawPick { round: number; pick: number; overall: number; player: string; team: string | null; team_name: string }
export interface RawTx { key: string; ts: string; date: string; team: string; moves: { player: string; action: "add" | "drop" | "trade"; source: string }[] }
export interface RawStore {
  base: {
    league_id: string; name: string; scoring_type?: string; categories: string[]; roster_positions?: string[];
    teams: { id: string; name: string; logo?: string | null }[]; my_team: string; current_week: number;
    rosters: Record<string, string[]>; averages: Record<string, Record<string, StatLine>>; synced_at?: string;
  } | null;
  weeks: Record<string, RawWeek>;
  days: Record<string, Record<string, DayRow[]>>;
  players: Record<string, RawPlayer>;
  draft?: RawPick[];
  transactions?: Record<string, RawTx>;
  pool?: Record<string, StatLine>;
  prev_season?: { season: string; averages: Record<string, StatLine>; synced_at?: string };
  lineup_now?: Record<string, { player: string; slot: string }[]>;
  logos?: Record<string, { url: string; file: string; v: string }>;
  last_import?: string;
}

const RATIOS: Record<string, [string, string]> = { "FG%": ["FGM", "FGA"], "FT%": ["FTM", "FTA"], "3PT%": ["3PTM", "3PTA"] };
const LOWER_IS_BETTER = new Set(["TO", "PF"]);
const LABELS: Record<string, string> = { ST: "STL" };
const IL_SLOTS = new Set(["IL", "IL+", "IR", "NA"]);

export class LeagueData {
  readonly store: RawStore;
  readonly base: NonNullable<RawStore["base"]>;
  /** Where the data files live (for team pictures). */
  readonly dataUrl: string;

  constructor(store: RawStore, dataUrl = "./data") {
    if (!store?.base) throw new Error("Henüz veri yok. Eklentiyle senkronize et.");
    if ((store.base.scoring_type ?? "").includes("Points")) throw new Error("Puan bazlı ligler henüz desteklenmiyor.");
    this.store = store;
    this.base = store.base;
    this.dataUrl = dataUrl;
  }

  get categories(): Category[] {
    return this.base.categories.map((c) => ({ key: c, label: LABELS[c] ?? c, higher: !LOWER_IS_BETTER.has(c), ...(RATIOS[c] ? { ratio: RATIOS[c] } : {}) }));
  }

  /** League as the engine sees it. */
  engineLeague(): EngineLeague {
    return { scoring: "categories", categories: this.categories, modifiers: {} };
  }

  logoUrl(team: string): string | null {
    const lg = this.store.logos?.[team];
    return lg ? `${this.dataUrl}/logos/${lg.file}?v=${lg.v}` : null;
  }

  league(): League & { modifiers: Record<string, number> } {
    const weeks = Object.entries(this.store.weeks)
      .map(([w, v]) => ({ w: +w, v }))
      .sort((a, b) => a.w - b.w)
      .filter(({ w, v }) => v.dates.length && w <= this.base.current_week)
      .map(({ w, v }) => ({ week: w, start: v.dates[0], end: v.dates[v.dates.length - 1] }));
    return {
      key: this.base.league_id, name: this.base.name, scoring: "categories", categories: this.categories, modifiers: {},
      current_week: this.base.current_week, my_team: this.base.my_team,
      teams: this.base.teams.map((t) => ({ key: t.id, name: t.name, manager: "", logo: this.logoUrl(t.id) })),
      weeks, demo: false, synced_at: this.store.last_import ?? this.base.synced_at,
    };
  }

  teamKeys(): string[] { return this.base.teams.map((t) => t.id); }

  activeSlots(): number {
    const n = (this.base.roster_positions ?? []).filter((x) => !["BN", "IL", "IL+", "IR", "NA"].includes(x.toUpperCase())).length;
    return n || 10;
  }

  /** Regular roster spots (everything except IL slots). */
  rosterCapacity(): number {
    const n = (this.base.roster_positions ?? []).filter((x) => !IL_SLOTS.has(x.toUpperCase())).length;
    return n || 13;
  }

  /** team -> players currently parked in an IL slot (they don't use a regular spot). */
  ilPlayers(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [t, rows] of Object.entries(this.store.lineup_now ?? {})) out[t] = rows.filter((e) => IL_SLOTS.has(e.slot)).map((e) => e.player);
    return out;
  }

  rosters(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [t, ps] of Object.entries(this.base.rosters)) out[t] = [...ps];
    return out;
  }

  private owners(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const [t, ps] of Object.entries(this.base.rosters)) for (const p of ps) o[p] = t;
    return o;
  }

  freeAgents(): string[] {
    const owned = this.owners();
    return Object.keys(this.store.pool ?? {}).filter((k) => !(k in owned));
  }

  playerInfo(keys: Iterable<string>): Players {
    const owners = this.owners();
    const out: Players = {};
    for (const k of keys) {
      const p = this.store.players[k];
      if (p) out[k] = { key: k, name: p.name ?? k, nba_team: p.nba_team ?? "", positions: p.positions ?? [], status: p.status ?? "", owner: owners[k] ?? null };
    }
    return out;
  }

  /** Per-game averages for a period; free agents only have season averages (from the pool). */
  averages(keys: Iterable<string>, period = "season"): Record<string, StatLine> {
    const src = this.base.averages[period] ?? {};
    const pool = period === "season" ? this.store.pool ?? {} : {};
    const out: Record<string, StatLine> = {};
    const filled = (x: StatLine | undefined) => (x && Object.keys(x).length ? x : undefined);
    for (const k of keys) out[k] = { ...(filled(src[k]) ?? filled(pool[k]) ?? { GP: 0 }) };
    return out;
  }

  /** Last season's per-game averages (roster players and the league pool), if synced. */
  prevAverages(): Record<string, StatLine> { return this.store.prev_season?.averages ?? {}; }

  matchups(week: number): [string, string][] { return this.store.weeks[String(week)]?.pairs ?? []; }
  official(week: number): Record<string, StatLine> { return this.store.weeks[String(week)]?.official ?? {}; }

  week(week: number, teams: string[]): Week {
    const info = this.store.weeks[String(week)];
    if (!info) throw new Error(`${week}. hafta senkronize edilmemiş.`);
    const days = info.dates.map((d) => {
      const day = this.store.days[d] ?? {};
      const lineups: Record<string, { player: string; slot: string }[]> = {};
      const stats: Record<string, StatLine | null> = {};
      for (const t of teams) {
        const rows = day[t] ?? [];
        lineups[t] = rows.map((r) => ({ player: r.player, slot: r.slot }));
        for (const r of rows) stats[r.player] = r.line;
      }
      return { date: d, lineups, stats };
    });
    return { week, start: info.dates[0], end: info.dates[info.dates.length - 1], days };
  }

  /** A player's daily lines in a week: only days he was on some league roster. */
  playerWeekStats(key: string, week: number): Record<string, StatLine | null> {
    const out: Record<string, StatLine | null> = {};
    for (const d of this.store.weeks[String(week)]?.dates ?? []) {
      out[d] = null;
      for (const rows of Object.values(this.store.days[d] ?? {})) {
        const hit = rows.find((r) => r.player === key);
        if (hit) { out[d] = hit.line; break; }
      }
    }
    return out;
  }

  search(query: string, limit = 15): Player[] {
    const q = query.toLowerCase().trim();
    const hits = Object.keys(this.store.players).filter((k) => (this.store.players[k].name ?? "").toLowerCase().includes(q));
    return Object.values(this.playerInfo(hits.slice(0, limit)));
  }
}
