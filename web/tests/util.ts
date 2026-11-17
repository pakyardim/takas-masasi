// Shared by the regression tests: run one recorded request and compare JSON loosely.
import { LocalApi } from "../src/engine/api";
import { power, standings } from "../src/engine/rankings";

/** Differences between two JSON values, ignoring key order and float noise. */
export function diff(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 20) return out;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ${a} != ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
    else a.forEach((x, i) => diff(x, b[i], `${path}[${i}]`, out));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const A = a as Record<string, unknown>, B = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (IGNORE.has(k)) continue;
      if (!(k in A) || !(k in B)) {
        if ((A[k] ?? null) !== null || (B[k] ?? null) !== null) out.push(`${path}.${k}: missing on one side`);
      } else diff(A[k], B[k], `${path}.${k}`, out);
    }
  } else if ((a ?? null) !== (b ?? null)) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
}
// logo: now a data-file URL instead of an API path; modifiers/demo/manager: unused extras
const IGNORE = new Set(["logo"]);


export interface Case { method?: string; path: string; body: unknown; out: unknown }

/** Answer a recorded request with the TypeScript engine ("today" pinned to the recording date). */
export function answer(api: LocalApi, c: Case, today?: string): unknown {
  const url = new URL(c.path, "http://x");
  if (url.pathname === "/api/power") return power(api.data, today);
  if (url.pathname === "/api/standings") return standings(api.data, today);
  if (url.pathname === "/api/allplay") return api.allplay(url.searchParams.get("team")!, today);
  return api.call(c.path, c.body);
}

/** Search results: the two runtimes list players in a different order, so compare as sets. */
export const keys = (x: unknown) => (x as { key: string }[]).map((r) => r.key).sort();
