// Matchup luck on the small fixture league: every completed week has one row per side of
// each real matchup, values stay within [-1, 1], and each matchup's two sides mirror each other.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LeagueData, type RawStore } from "../src/engine/data";
import { luck } from "../src/engine/rankings";

const fx: { today: string; store: RawStore } = JSON.parse(readFileSync(new URL("./fixtures/small-league.json", import.meta.url), "utf8"));

describe("matchup luck", () => {
  const data = new LeagueData(fx.store);
  const r = luck(data, fx.today);

  it("reports completed weeks with one row per side of each matchup", () => {
    expect(r.available).toBe(true);
    for (const w of r.weeks) expect(r.byWeek[w]).toHaveLength(2 * data.matchups(w).length);
  });

  it("keeps every value in range and sorts each week luckiest first", () => {
    for (const rows of Object.values(r.byWeek)) {
      rows.forEach((x, i) => {
        expect(Math.abs(x.luck)).toBeLessThanOrEqual(1);
        if (i) expect(rows[i - 1].luck).toBeGreaterThanOrEqual(x.luck);
      });
    }
  });

  it("gives the two sides of a matchup opposite results", () => {
    const rows = r.byWeek[r.weeks[0]];
    const byTeam = Object.fromEntries(rows.map((x) => [x.team, x]));
    for (const [a, b] of data.matchups(r.weeks[0])) {
      const ra = byTeam[a].result, rb = byTeam[b].result;
      expect([ra, rb]).toSatisfy(([x, y]: string[]) => (x === "T" && y === "T") || (x === "W" && y === "L") || (x === "L" && y === "W"));
    }
  });
});
