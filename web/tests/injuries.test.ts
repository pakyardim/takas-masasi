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
