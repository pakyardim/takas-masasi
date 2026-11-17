// Shapes of the JSON the FastAPI backend returns.

export type Res = "W" | "L" | "T";
export type StatLine = Record<string, number>;

export interface Category { key: string; label: string; higher: boolean; ratio?: [string, string] }
export interface Team { key: string; name: string; manager?: string; logo?: string | null }
export interface WeekInfo { week: number; start: string; end: string }

export interface League {
  key: string; name: string; scoring: "categories" | "points";
  categories: Category[]; current_week: number; my_team: string;
  teams: Team[]; weeks: WeekInfo[]; demo: boolean; synced_at?: string | null;
}

export interface Player {
  key: string; name: string; nba_team: string; positions: string[]; status: string; owner?: string | null;
}
export type Players = Record<string, Player>;

export interface LeagueResponse { league: League; rosters: Record<string, string[]>; players: Players }

export interface Score { W: number; L: number; T: number }
export interface CatResult { key: string; a: number | null; b: number | null; result: Res; changed?: boolean }
export interface Matchup {
  categories?: CatResult[]; score?: Score; result: Res; a_points?: number; b_points?: number;
}
export interface Brief { score?: Score; result: Res; a_points?: number; b_points?: number }

// ---- trade
export interface TradeCat {
  key: string; label: string; higher: boolean;
  a_gives: number | null; b_gives: number | null; a_net: number | null; b_net: number | null;
  better_for_a: Res; better_for_b: Res;
}
export interface TradePlayer { avg: StatLine; z?: Record<string, number>; fpts?: number }
export interface ImpactRow { key: string; label: string; before: number | null; after: number | null; rank_before: number; rank_after: number }
export interface Option { key: string; value: number | null }
export interface Balance {
  team: string; need_drop: number; room: number; drops: string[]; adds: string[];
  drop_options: Option[]; add_options: Option[]; il: string[];
}
export interface TradeResult {
  scoring: "categories" | "points"; categories: TradeCat[]; players: Record<string, TradePlayer>;
  a_gives_value: number; b_gives_value: number; a_net_value: number; b_net_value: number;
  moves: { drops_a: string[]; drops_b: string[]; adds_a: string[]; adds_b: string[] };
  team_impact: Record<string, ImpactRow[]>; teams: { a: string; b: string }; league_size: number;
  balance: { a: Balance; b: Balance; capacity: number; has_free_agents: boolean };
  info: Players;
}
export interface TradeFix { drops_a: string[]; drops_b: string[]; adds_a: string[]; adds_b: string[] }

// ---- what-if
export interface GridCell { slot: string; active: boolean; played: boolean; pts: number | null }
export interface VersusRow { team: string; actual: Brief; hypothetical?: Brief }
export interface WeekData {
  week: number; start: string; end: string; dates: string[];
  team: string; opponent: string; real_opponent: string | null;
  result: Matchup; official: Matchup | null; players: Players;
  usage: Record<string, { team: string; active_games: number; bench_games: number }>;
  grid: Record<string, Record<string, Record<string, GridCell>>>;
  versus: VersusRow[]; active_slots: number;
}
export interface Edit { team: string; type: "swap" | "bench" | "start"; out?: string; into?: string; player?: string; dates?: string[] }
export interface WhatIfResult {
  scoring: "categories" | "points"; actual: Matchup; hypothetical: Matchup; flipped: boolean;
  players: Record<string, { actual: StatLine; hypothetical: StatLine }>;
  warnings: { team: string; date: string; played: number; slots: number }[];
  info: Players; versus: VersusRow[];
}
export interface AllPlay {
  team: string; league: string; scoring: "categories" | "points"; teams: Team[];
  weeks: { week: number; start: string; end: string; complete: boolean; real_opponent: string | null; rows: VersusRow[] }[];
}

// ---- power / standings
export interface PowerTeam {
  team: string; name: string; rank: number; prev_rank: number | null; power: number;
  allplay: [number, number, number]; allplay_pct: number; form_pct: number; roster: number;
  record: [number, number, number]; standing: number; luck: number; beat: number; beat_of: number;
}
export interface Power { available: boolean; weeks: number[]; teams: PowerTeam[]; weights: { allplay: number; form: number; roster: number } }

type Rec = [number, number, number];
export interface StandingsTeam {
  team: string; name: string;
  h2h: { record: Rec; pct: number; rank: number };
  one_win: { record: Rec; pct: number; rank: number };
  roto: { points: number; rank: number; cats: Record<string, { value: number | null; points: number; rank: number }> };
  points: { total: number; rank: number; record: Rec; record_rank: number };
}
export interface Standings { available: boolean; teams: StandingsTeam[]; n: number; weeks_done: number[]; last_day: string; point_values: Record<string, number> }

// ---- draft / transfers
export interface DraftPick {
  round: number; pick: number; overall: number; team: string | null; team_name: string; player: Player;
  known: boolean; gp: number; z: number | null; value: number; rank: number | null; expected: number; surplus: number; kept: boolean;
}
export interface DraftTeam { team: string | null; name: string; total: number; surplus: number; picks: number; kept: number; best: DraftPick | null; worst: DraftPick | null }
export interface DraftReport { available: boolean; has_pool: boolean; teams: DraftTeam[]; picks: DraftPick[] }

export interface Stint { games: number; active_games: number; value: number; first: string | null; last: string | null; ongoing: boolean }
export interface Pickup extends Stint { date: string; team: string; team_name: string; player: Player; per_game: number | null }
export interface MovesReport {
  available: boolean; count: number; first: string; last: string; pickups: Pickup[];
  teams: { team: string; name: string; adds: number; value: number; best: Pickup | null }[];
  trades: { date: string; sides: { team: string; name: string; value: number; players: (Stint & { player: Player })[] }[] }[];
}

// ---- matchup luck
export interface LuckRow { team: string; name: string; result: Res; beaten: number; of: number; luck: number }
export interface LuckReport {
  available: boolean; weeks: number[]; byWeek: Record<number, LuckRow[]>;
  season: { team: string; name: string; wins: number; losses: number; ties: number; luck: number }[];
}
