// Copies the synced league data (../data/league.json and ../data/logos) into dist/data,
// so the built site is complete on its own. Run by `npm run build:site`.
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";

const src = new URL("../../data/", import.meta.url), dst = new URL("../dist/data/", import.meta.url);
if (!existsSync(new URL("league.json", src))) {
  console.error("data/league.json bulunamadı. Önce eklentiyle senkronize et (ve yayınlamak için veriyi repoya ekle).");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(new URL("league.json", src), new URL("league.json", dst));
if (existsSync(new URL("logos/", src))) cpSync(new URL("logos/", src), new URL("logos/", dst), { recursive: true });
console.log(`data -> dist/data (${Math.round(statSync(new URL("league.json", dst)).size / 1024)} KB)`);
