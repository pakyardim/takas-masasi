// Player and team popups on the small fixture league: the numbers agree with the raw days
// and with the other reports.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalApi } from "../src/engine/api";
import { LeagueData, type RawStore } from "../src/engine/data";
import { positionHistory, standings } from "../src/engine/rankings";
import type { PlayerProfile, TeamProfile } from "../src/types";

const fx: { today: string; store: RawStore } = JSON.parse(readFileSync(new URL("./fixtures/small-league.json", import.meta.url), "utf8"));
const api = new LocalApi(new LeagueData(fx.store));
const played = (l: unknown) => !!l && Object.keys(l as object).length > 0;

describe("player profile", () => {
  const p = api.call("/api/player?key=a1") as PlayerProfile;
  it("names the player and his team", () => {
    expect(p.name).toBe("Pa1");
    expect(p.owner).toBe("1");
  });
  it("counts the games he played on a league roster", () => {
    let games = 0, days = 0;
    for (const day of Object.values(fx.store.days)) for (const rows of Object.values(day)) {
      const r = rows.find((x) => x.player === "a1");
      if (r) { days += 1; if (played(r.line)) games += 1; }
    }
    expect(p.fantasy.days).toBe(days);
    expect(p.fantasy.games).toBe(games);
    expect(p.fantasy.active_games + p.fantasy.bench_games).toBeLessThanOrEqual(games);
    if (games) expect(p.fantasy.best).not.toBeNull();
  });
  it("has one row per category", () => {
    expect(p.cats.map((c) => c.key)).toEqual(fx.store.base!.categories);
  });
  it("lists his draft pick and transactions when there are any", () => {
    const pick = fx.store.draft?.find((x) => x.player === "a1");
    expect(p.draft?.overall ?? null).toBe(pick?.overall ?? null);
    const n = Object.values(fx.store.transactions ?? {}).reduce((a, tx) => a + tx.moves.filter((m) => m.player === "a1").length, 0);
    expect(p.moves.length).toBe(n);
  });
  it("refuses an unknown player", () => {
    expect(() => api.call("/api/player?key=nobody")).toThrow();
  });
});

describe("team profile", () => {
  const t = api.call("/api/team?team=1") as TeamProfile;
  it("names the team", () => {
    expect(t.name).toBe("A");
    expect(t.teams).toBe(fx.store.base!.teams.length);
  });
  it("orders the best and worst week", () => {
    if (t.best_week && t.worst_week) expect(t.best_week.beaten).toBeGreaterThanOrEqual(t.worst_week.beaten);
    if (t.streak) expect(t.streak.n).toBeGreaterThanOrEqual(1);
  });
  it("counts every player the team used", () => {
    const seen = new Set<string>();
    for (const day of Object.values(fx.store.days)) for (const r of day["1"] ?? []) seen.add(r.player);
    expect(t.usage.players).toBe(seen.size);
    expect(t.usage.top.length).toBeLessThanOrEqual(3);
  });
  it("refuses an unknown team", () => {
    expect(() => api.call("/api/team?team=99")).toThrow();
  });
});

describe("league position by week", () => {
  const h = positionHistory(api.data, fx.today);
  const st = standings(api.data, fx.today);
  it("has one row per completed week for every team", () => {
    for (const rows of Object.values(h.teams)) expect(rows.map((r) => r.week)).toEqual(h.weeks);
  });
  it("ends at the place the standings page shows", () => {
    if (!h.weeks.length) return;
    for (const t of st.teams) expect(h.teams[t.team].at(-1)!.rank).toBe(t.h2h.rank);
  });
  it("adds up the weekly category scores into the record", () => {
    for (const rows of Object.values(h.teams)) {
      let w = 0, l = 0, ties = 0;
      for (const r of rows) {
        w += r.score?.W ?? 0; l += r.score?.L ?? 0; ties += r.score?.T ?? 0;
        expect(r.record).toEqual([w, l, ties]);
      }
    }
  });
});
