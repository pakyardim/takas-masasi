// Injuries: who was out, how many games it cost, and how much production was lost.
//
// What the synced data can tell, day by day, for each rostered player:
//   - IL days:   the player sat in an injured-list slot (IL, IL+, IR, NA). Reliable.
//   - Missed:    the player was in an active slot, his NBA team played that day, and he has no
//                stat line. This also catches healthy rests and DNPs, so it is an upper bound on
//                injury games. Days when his NBA team did not play are not counted.
//   - Lost value: value over replacement (same yardstick as Draft/Transfers) for each missed game,
//                 using his season value per game.
// The NBA team's game days are inferred: a team played on a day if one of our players with that
// NBA team has a stat line that day. Teams with no player in our data that day count as off.
// Day-by-day injury status is not stored by the sync, so only the current status is shown.

import { INACTIVE_SLOTS, playerZ } from "./core";
import type { LeagueData } from "./data";
import { Valuer } from "./analysis";

const IL_SLOTS = new Set(["IL", "IL+", "IR", "NA"]);
// Yahoo's injury flags for a day. "Q" (questionable) is not counted as out.
const OUT_STATUS = new Set(["O", "INJ", "OFS", "SUSP"]);
/** Fewer games than this this season: the season value is too noisy, use last season's. */
const MIN_GAMES_THIS_SEASON = 10;

export interface InjuryCell { il: number; missed: number; lost: number }
export interface InjuryReport {
  available: boolean;
  days_covered: number;
  first_day: string | null;
  last_day: string | null;
  weeks: number[];
  teams: { team: string; name: string; il: number; missed: number; lost: number; byWeek: Record<number, InjuryCell> }[];
  players: { key: string; name: string; nba_team: string; team: string | null; team_name: string | null; il: number; missed: number; lost: number; status: string; byWeek: Record<number, InjuryCell> }[];
}

const empty = (): InjuryCell => ({ il: 0, missed: 0, lost: 0 });
type Bucket = InjuryCell & { team?: string | null; byWeek: Record<number, InjuryCell> };
const bucket = (bag: Record<string, Bucket>, key: string): Bucket => (bag[key] ??= { ...empty(), byWeek: {} });
const add = (b: Bucket, w: number, field: keyof InjuryCell, amount: number) => {
  b[field] += amount;
  (b.byWeek[w] ??= empty())[field] += amount;
};

export function injuries(data: LeagueData): InjuryReport {
  const store = data.store;
  const days = Object.keys(store.days).sort();
  if (!days.length) return { available: false, days_covered: 0, first_day: null, last_day: null, weeks: [], teams: [], players: [] };

  const v = new Valuer(data);
  const names: Record<string, string> = Object.fromEntries(data.base.teams.map((t) => [t.id, t.name]));
  const weekOf: Record<string, number> = {};
  for (const [w, info] of Object.entries(store.weeks)) for (const d of info.dates ?? []) weekOf[d] = +w;
  const nbaOf = (pid: string) => store.players[pid]?.nba_team ?? "";
  // last season's value per game, on this season's yardstick (same z model)
  const prevZ: Record<string, number> = {};
  for (const [k, avg] of Object.entries(data.prevAverages())) if (avg.GP) prevZ[k] = playerZ(avg, v.league, v.model).TOTAL;
  const perGame = (pid: string): number => {
    const gp = v.avg[pid]?.GP ?? 0;
    const z = gp < MIN_GAMES_THIS_SEASON && prevZ[pid] !== undefined ? prevZ[pid] : v.z[pid];
    return z !== undefined ? z - v.repl : 0;
  };
  const teamTotals: Record<string, Bucket> = {};
  const playerTotals: Record<string, Bucket> = {};

  for (const d of days) {
    const teamsToday = store.days[d];
    // NBA teams that played today: any of our players with that NBA team has a stat line
    const played = new Set<string>();
    for (const rows of Object.values(teamsToday)) for (const r of rows) if (r.line && Object.keys(r.line).length) played.add(nbaOf(r.player));
    const w = weekOf[d] ?? 0;
    for (const [team, rows] of Object.entries(teamsToday)) {
      for (const r of rows) {
        const pid = r.player;
        const inIL = IL_SLOTS.has(r.slot);
        // injured: on the injured list, or flagged out that day (even if still in an active slot)
        if (inIL || OUT_STATUS.has((r.status ?? "").toUpperCase())) {
          add(bucket(teamTotals, team), w, "il", 1);
          add(bucket(playerTotals, pid), w, "il", 1);
          bucket(playerTotals, pid).team = team;
        }
        if (inIL || INACTIVE_SLOTS.has(r.slot)) continue;
        const didPlay = !!r.line && Object.keys(r.line).length > 0;
        if (didPlay || !played.has(nbaOf(pid))) continue;
        const lost = perGame(pid);
        add(bucket(teamTotals, team), w, "missed", 1);
        add(bucket(teamTotals, team), w, "lost", lost);
        add(bucket(playerTotals, pid), w, "missed", 1);
        add(bucket(playerTotals, pid), w, "lost", lost);
        bucket(playerTotals, pid).team = team;
      }
    }
  }

  const weeks = Object.keys(store.weeks).map(Number).filter((w) => days.some((d) => weekOf[d] === w)).sort((a, b) => a - b);
  const teams = data.teamKeys().map((t) => {
    const b = teamTotals[t] ?? bucket({}, t);
    return { team: t, name: names[t] ?? t, il: b.il, missed: b.missed, lost: b.lost, byWeek: b.byWeek };
  }).sort((a, b) => b.lost - a.lost);
  const players = Object.entries(playerTotals)
    .map(([key, b]) => {
      const p = store.players[key] ?? {};
      return {
        key, name: p.name ?? key, nba_team: p.nba_team ?? "", positions: p.positions ?? [], team: b.team ?? null,
        team_name: b.team ? names[b.team] ?? b.team : null,
        il: b.il, missed: b.missed, lost: b.lost, status: p.status ?? "", byWeek: b.byWeek,
      };
    })
    .filter((p) => p.il || p.missed)
    .sort((a, b) => b.missed - a.missed || b.il - a.il);

  return {
    available: true, days_covered: days.length, first_day: days[0], last_day: days[days.length - 1],
    weeks, teams, players,
  };
}
