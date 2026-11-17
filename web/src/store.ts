// League-wide data loaded once at startup, plus a registry of every player any
// response has mentioned. Components read it while rendering; it is not reactive
// (responses register their players before the state that renders them is set).
import { LocalApi } from "./engine/api";
import { LeagueData, type RawStore } from "./engine/data";
import type { Category, League, Player, Players } from "./types";

export const store = {
  league: null as unknown as League,
  rosters: {} as Record<string, string[]>,
  players: {} as Players,
  teamName: {} as Record<string, string>,
  teamLogo: {} as Record<string, string | null | undefined>,
};

export function registerPlayers(more?: Players | Player[] | null) {
  if (!more) return;
  for (const p of Array.isArray(more) ? more : Object.values(more)) {
    if (p?.key) store.players[p.key] = { ...store.players[p.key], ...p };
  }
}

let local: LocalApi | null = null;

/** Load the league file and set up in-browser calculation. */
export async function loadLeague(dataUrl = "./data"): Promise<void> {
  const r = await fetch(`${dataUrl}/league.json`, { cache: "no-cache" });
  if (r.status === 404) throw new Error("NO_DATA");
  if (!r.ok) throw new Error(`Lig verisi yüklenemedi (${r.status}).`);
  local = new LocalApi(new LeagueData((await r.json()) as RawStore, dataUrl));
  const d = local.league();
  // "my team" is the viewer's choice (remembered in this browser); default: the team that synced
  const saved = localStorage.getItem(MY_TEAM_KEY);
  if (saved && d.league.teams.some((t) => t.key === saved)) d.league.my_team = saved;
  store.league = d.league; store.rosters = d.rosters; store.players = d.players;
  store.teamName = Object.fromEntries(d.league.teams.map((t) => [t.key, t.name]));
  store.teamLogo = Object.fromEntries(d.league.teams.map((t) => [t.key, t.logo]));
}

const MY_TEAM_KEY = "takas.myTeam";
export function setMyTeam(team: string) {
  localStorage.setItem(MY_TEAM_KEY, team);
  location.reload();          // every tab picks its defaults from "my team" when it starts
}

/** Ask the in-browser engine. Same paths and answers as the former HTTP API. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (!local) throw new Error("Lig verisi yüklenmedi.");
  return local.call(path, body) as T;
}

// ---------------------------------------------------------------- formatting
export const FPTS: Category = { key: "FPTS", label: "FPTS", higher: true };
export const cats = (): Category[] => (store.league.scoring === "points" ? [FPTS] : store.league.categories);
export const catByKey = (k: string) => store.league.categories.find((c) => c.key === k);

export function fmt(key: string, v: number | null | undefined, mode: "pg" | "total" = "pg"): string {
  if (v === null || v === undefined) return "–";
  if (catByKey(key)?.ratio) return v.toFixed(3).replace(/^0\./, ".");
  if (mode === "total") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return v.toFixed(1);
}
export const signed = (v: number, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d);
export const cls = (v: number) => (v > 0.0001 ? "pos" : v < -0.0001 ? "neg" : "");
export const pname = (k: string) => store.players[k]?.name || k;
export const pct = (x: number) => `%${Math.round(x * 100)}`;
export const RES = { W: "Galibiyet", L: "Mağlubiyet", T: "Beraberlik" } as const;
export const rec = (x: number[]) => `${x[0]}-${x[1]}${x[2] ? "-" + x[2] : ""}`;
export const num = (x: number, d = 0) => x.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

const at = (d: string) => new Date(d + "T12:00:00");
export const dayLabel = (d: string) => at(d).toLocaleDateString("tr-TR", { weekday: "short", day: "numeric" });
export const dayLong = (d: string) => at(d).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

export function scoreText(x: { score?: { W: number; L: number; T: number }; a_points?: number; b_points?: number }): string {
  if (x.score) return `${x.score.W}-${x.score.L}${x.score.T ? "-" + x.score.T : ""}`;
  return `${(x.a_points ?? 0).toFixed(1)}–${(x.b_points ?? 0).toFixed(1)}`;
}
