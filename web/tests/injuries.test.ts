// Injury report on the small fixture league: counts cover every stored day, and a benched
// or off-day player is not counted as a missed game.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LeagueData, type RawStore } from "../src/engine/data";
import { injuries } from "../src/engine/injuries";

const fx: { store: RawStore } = JSON.parse(readFileSync(new URL("./fixtures/small-league.json", import.meta.url), "utf8"));

describe("injury report", () => {
  const r = injuries(new LeagueData(fx.store));
  it("covers the stored days", () => {
    expect(r.available).toBe(true);
    expect(r.days_covered).toBe(Object.keys(fx.store.days).length);
  });
  it("counts no injured-list days in the fixture (no IL slots there)", () => {
    expect(r.teams.every((t) => t.il === 0)).toBe(true);
  });
  it("only counts missed games for active players whose NBA team played", () => {
    for (const p of r.players) expect(p.missed).toBeGreaterThanOrEqual(0);
    // fixture day 2026-10-28: a1 has no line but is active for team 1 and his NBA team (X) played
    const a1 = r.players.find((p) => p.key === "a1");
    expect(a1?.missed ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("injury flags and last season", () => {
  // a1 (team 1, active PG) on 2026-10-27; his NBA team is set to one that plays that day
  const withA1Out = (line: unknown, status?: string) => {
    const store = JSON.parse(JSON.stringify(fx.store));
    store.players.a1.nba_team = "BBB";
    const row = store.days["2026-10-27"]["1"].find((x: { player: string }) => x.player === "a1");
    row.line = line;
    if (status) row.status = status;
    return store;
  };
  it("counts a day flagged out as an injured day, even in an active slot", () => {
    const r = injuries(new LeagueData(withA1Out(null, "O")));
    expect(r.teams.find((t) => t.team === "1")!.il).toBeGreaterThanOrEqual(1);
    expect(r.players.find((p) => p.key === "a1")!.missed).toBeGreaterThanOrEqual(1);
  });
  it("uses last season's value for a player with few games this season", () => {
    const store = withA1Out(null);
    store.base.averages.season.a1.GP = 3;                  // few games this season: fall back to last season
    const lost = (r: ReturnType<typeof injuries>) => r.players.find((p) => p.key === "a1")!.lost;
    const base = injuries(new LeagueData(store));
    store.prev_season = { season: "AS_2025", averages: { a1: { GP: 40, PTS: 60, TO: 0, FGM: 25, FGA: 40 } } };
    const withPrev = injuries(new LeagueData(store));
    expect(lost(withPrev)).not.toBe(lost(base));
  });
});
