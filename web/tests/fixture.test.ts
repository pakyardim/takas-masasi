// Regression test on a small made-up league. The expected answers were recorded from the
// original Python implementation before it was retired (tests/fixtures/small-league.json).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalApi } from "../src/engine/api";
import { LeagueData, type RawStore } from "../src/engine/data";
import { answer, diff, keys, type Case } from "./util";

const fx: { today: string; store: RawStore; cases: Case[] } =
  JSON.parse(readFileSync(new URL("./fixtures/small-league.json", import.meta.url), "utf8"));

describe("engine on the small fixture league", () => {
  const api = new LocalApi(new LeagueData(fx.store));
  it.each(fx.cases.map((c, i) => [`${i} ${c.path}${c.body ? " " + JSON.stringify(c.body).slice(0, 60) : ""}`, c] as const))("%s", (_n, c) => {
    const mine = answer(api, c, fx.today);
    if (c.path.startsWith("/api/search")) return expect(keys(mine)).toEqual(keys(c.out));
    expect(diff(mine, c.out)).toEqual([]);
  });

  it("refuses a league file without data", () => {
    expect(() => new LeagueData({ base: null, weeks: {}, days: {}, players: {} })).toThrow();
  });
});
