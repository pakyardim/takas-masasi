// Compares the TypeScript engine with answers recorded from the previous Python backend
// on a real league file. The recording holds private league data, so it is not in the
// repository: point GOLDEN_DIR at a folder with golden.json + league.snapshot.json
// (and GOLDEN_TODAY at the US-Eastern date of the recording) to run it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalApi } from "../src/engine/api";
import { LeagueData } from "../src/engine/data";
import { answer, diff, keys, type Case } from "./util";

const dir = process.env.GOLDEN_DIR;
const today = process.env.GOLDEN_TODAY;

describe.skipIf(!dir)("TypeScript engine reproduces the Python backend on real data", () => {
  const cases: Case[] = dir ? JSON.parse(readFileSync(`${dir}/golden.json`, "utf8")) : [];
  const api = dir ? new LocalApi(new LeagueData(JSON.parse(readFileSync(`${dir}/league.snapshot.json`, "utf8")))) : null!;

  it.each(cases.map((c, i) => [`${i} ${c.path}${c.body ? " " + JSON.stringify(c.body).slice(0, 70) : ""}`, c] as const))("%s", (_name, c) => {
    const mine = answer(api, c, today);
    if (c.path.startsWith("/api/search")) {
      if ((c.out as unknown[]).length < 15) expect(keys(mine)).toEqual(keys(c.out));
      return;
    }
    expect(diff(mine, c.out)).toEqual([]);
  });
});
