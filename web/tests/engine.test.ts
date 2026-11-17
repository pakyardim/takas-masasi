// Unit tests of the pure statistics (ported from the Python test suite).
import { describe, expect, it } from "vitest";
import { addLines, categoryValues, evaluateTrade, headToHead, versusAll, whatIf, type EngineLeague, type Week } from "../src/engine/core";

const LEAGUE: EngineLeague = {
  scoring: "categories",
  categories: [
    { key: "FG%", label: "FG%", higher: true, ratio: ["FGM", "FGA"] },
    { key: "PTS", label: "PTS", higher: true },
    { key: "TO", label: "TO", higher: false },
  ],
};
const cat = <T extends { key: string }>(rows: T[] | undefined, key: string) => rows!.find((c) => c.key === key)!;

// one day: team A starts p1 and benches p2; team B starts p3
const week = (): Week => ({
  days: [{
    date: "2026-11-02",
    lineups: { A: [{ player: "p1", slot: "PG" }, { player: "p2", slot: "BN" }], B: [{ player: "p3", slot: "C" }] },
    stats: {
      p1: { PTS: 10, TO: 1, FGM: 4, FGA: 10 }, p2: { PTS: 30, TO: 1, FGM: 12, FGA: 20 }, p3: { PTS: 20, TO: 3, FGM: 8, FGA: 16 },
    },
  }],
});

describe("basics", () => {
  it("weights percentages by volume", () => {
    const tot = addLines([{ FGM: 1, FGA: 2 }, { FGM: 9, FGA: 18 }, { FGM: 0, FGA: 0 }]);
    expect(categoryValues(tot, LEAGUE)["FG%"]).toBe(0.5);
  });
  it("counts fewer turnovers as a win", () => {
    const r = headToHead({ PTS: 100, TO: 10, FGM: 40, FGA: 80 }, { PTS: 90, TO: 12, FGM: 40, FGA: 100 }, LEAGUE);
    expect(r.score).toEqual({ W: 3, L: 0, T: 0 });
  });
  it("scores a points league", () => {
    const lg: EngineLeague = { scoring: "points", categories: [], modifiers: { PTS: 1, TO: -1 } };
    const r = headToHead({ PTS: 50, TO: 5 }, { PTS: 48, TO: 1 }, lg);
    expect(r.result).toBe("L");
    expect(r.a_points).toBe(45);
  });
});

describe("what-if", () => {
  it("flips the result when the benched player starts instead", () => {
    const res = whatIf(LEAGUE, week(), "A", "B", [{ team: "A", out: "p1", in: "p2" }]);
    expect(res.actual.result).toBe("L");          // 10 pts, .400 vs 20 pts, .500: A wins TO only
    expect(res.hypothetical.result).toBe("W");    // p2 (30 pts, .600) takes p1's active slot
    expect(res.flipped).toBe(true);
    expect(res.players.p2.hypothetical.PTS).toBe(30);
    expect(res.players.p1.hypothetical).toEqual({});
  });
  it("uses extra stats for a player from outside the matchup", () => {
    const extra = { fa: { "2026-11-02": { PTS: 5, TO: 0, FGM: 2, FGA: 5 } } };
    const res = whatIf(LEAGUE, week(), "A", "B", [{ team: "A", out: "p1", in: "fa" }], extra);
    expect(res.players.fa.hypothetical.PTS).toBe(5);
  });
  it("benches a player on one day only", () => {
    const wk = week();
    wk.days.push({ date: "2026-11-03", lineups: { A: [{ player: "p1", slot: "PG" }], B: [{ player: "p3", slot: "C" }] },
                   stats: { p1: { PTS: 50, TO: 9, FGM: 20, FGA: 30 }, p3: null } });
    const res = whatIf(LEAGUE, wk, "A", "B", [{ team: "A", type: "bench", player: "p1", dates: ["2026-11-03"] }]);
    expect(cat(res.actual.categories, "PTS").a).toBe(60);
    expect(cat(res.hypothetical.categories, "PTS").a).toBe(10);
    expect(res.players.p1.actual.GP).toBe(2);
    expect(res.players.p1.hypothetical.GP).toBe(1);
  });
  it("starts a bench player and warns when too many play", () => {
    const res = whatIf(LEAGUE, week(), "A", "B", [{ team: "A", type: "start", player: "p2", dates: ["2026-11-02"] }], {}, 1);
    expect(cat(res.hypothetical.categories, "PTS").a).toBe(40);
    expect(res.warnings).toEqual([{ team: "A", date: "2026-11-02", played: 2, slots: 1 }]);
  });
  it("replays the week against every other team", () => {
    const wk = week();
    wk.days[0].lineups.C = [{ player: "p4", slot: "C" }];
    wk.days[0].stats.p4 = { PTS: 5, TO: 5, FGM: 1, FGA: 10 };
    expect(versusAll(LEAGUE, wk, "A", ["B", "C"]).map((r) => r.actual.result)).toEqual(["L", "W"]);
    expect(versusAll(LEAGUE, wk, "A", ["B"], [{ team: "A", out: "p1", in: "p2" }])[0].hypothetical!.result).toBe("W");
  });
});

describe("trade evaluation", () => {
  it("computes net change and league ranks", () => {
    const rosters = { A: ["p1", "p2"], B: ["p3"], C: ["p4"] };
    const avgs = {
      p1: { PTS: 10, TO: 1, FGM: 4, FGA: 10, GP: 5 }, p2: { PTS: 12, TO: 2, FGM: 5, FGA: 10, GP: 5 },
      p3: { PTS: 25, TO: 3, FGM: 9, FGA: 18, GP: 5 }, p4: { PTS: 15, TO: 2, FGM: 6, FGA: 12, GP: 5 },
    };
    const r = evaluateTrade(LEAGUE, rosters, avgs, "A", ["p1"], "B", ["p3"]);
    expect(cat(r.categories, "PTS").a_net).toBe(15);
    expect(cat(r.categories, "PTS").better_for_a).toBe("W");
    expect(cat(r.categories, "TO").better_for_a).toBe("L");
    const pts = cat(r.team_impact.A, "PTS");
    expect([pts.before, pts.after, pts.rank_after]).toEqual([22, 37, 1]);
    expect(r.roster_spots.a_net).toBe(0);
  });
  it("includes forced drops and free-agent adds in an uneven trade", () => {
    const rosters = { A: ["p1", "p2"], B: ["p3", "p4"] };
    const avgs = {
      p1: { PTS: 30, TO: 3, FGM: 10, FGA: 20, GP: 5 }, p2: { PTS: 5, TO: 1, FGM: 2, FGA: 5, GP: 5 },
      p3: { PTS: 14, TO: 2, FGM: 5, FGA: 10, GP: 5 }, p4: { PTS: 12, TO: 2, FGM: 5, FGA: 10, GP: 5 },
      fa: { PTS: 8, TO: 1, FGM: 3, FGA: 8, GP: 5 },
    };
    const { fa: _fa, ...pool } = avgs;
    // A gives its star for two players and must drop p2; B fills the open spot with a free agent
    const r = evaluateTrade(LEAGUE, rosters, avgs, "A", ["p1"], "B", ["p3", "p4"], pool, { dropsA: ["p2"], addsB: ["fa"] });
    const pts = cat(r.categories, "PTS");
    expect(pts.a_net).toBe(14 + 12 - (30 + 5));          // received - (given + dropped)
    expect(pts.b_net).toBe(30 + 8 - (14 + 12));          // (received + added) - given
    expect([pts.better_for_a, pts.better_for_b]).toEqual(["L", "W"]);
    expect(cat(r.team_impact.A, "PTS").after).toBe(26);
    const z = (p: string) => r.players[p].z!.TOTAL;
    expect(r.a_net_value).toBeCloseTo(z("p3") + z("p4") - z("p1") - z("p2"), 9);
    expect(r.b_net_value).toBeCloseTo(z("p1") + z("fa") - z("p3") - z("p4"), 9);
  });
});
