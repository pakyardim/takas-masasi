// Draws the "what if I had played everyone, every week" poster on a canvas.
// Pure drawing code: takes the /api/allplay response, returns a <canvas> (2x resolution).
import { store } from "./store";
import type { AllPlay, Res, TradeResult } from "./types";

type Ctx = CanvasRenderingContext2D;

const C = {
  brand: "#6001d2", brandDark: "#3b0086", text: "#232a31", muted: "#5b636a", line: "#e0e4e9",
  panel: "#f5f8fa", win: "#0f8a43", winSoft: "#e3f6ea", loss: "#fdecef", lossText: "#c2143a",
  tie: "#eef0f3", tieText: "#5b636a", gold: "#f5b301", white: "#ffffff", a: "#0063eb",
};
const FONT = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const dm = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;

function fit(ctx: Ctx, text: string, maxWidth: number, size: number, weight = 800, min = 14): string {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 1; } while (ctx.measureText(text).width > maxWidth && s > min);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill?: string | null, stroke?: string | null, lw = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

export type Logos = Record<string, HTMLImageElement>;

/** Load team pictures (same-origin, so the canvas stays exportable). Missing ones are skipped. */
export async function loadLogos(teams: string[]): Promise<Logos> {
  const out: Logos = {};
  await Promise.all(teams.map((t) => new Promise<void>((done) => {
    const url = store.teamLogo[t];
    if (!url) return done();
    const img = new Image();
    img.onload = () => { out[t] = img; done(); };
    img.onerror = () => done();
    img.src = url;
  })));
  return out;
}

/** Picture cropped to a circle ("cover"), with a ring. */
function circleLogo(ctx: Ctx, img: HTMLImageElement, cx: number, cy: number, r: number, ring: string, ringW: number) {
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = ring; ctx.lineWidth = ringW; ctx.stroke();
}

export function drawAllPlayPoster(data: AllPlay, teamName: string, logos: Logos = {}): HTMLCanvasElement {
  const weeks = data.weeks, teams = data.teams;
  const nW = weeks.length, nT = teams.length;
  const isPts = data.scoring === "points";

  // ---- numbers
  const col = weeks.map((w) => {
    const res = w.rows.map((r) => r.actual.result);
    return { wins: res.filter((x) => x === "W").length, losses: res.filter((x) => x === "L").length, ties: res.filter((x) => x === "T").length };
  });
  const tot = col.reduce((a, c) => ({ W: a.W + c.wins, L: a.L + c.losses, T: a.T + c.ties }), { W: 0, L: 0, T: 0 });
  const real: Record<Res, number> = { W: 0, L: 0, T: 0 };
  weeks.forEach((w) => { const r = w.rows.find((x) => x.team === w.real_opponent); if (r && w.complete) real[r.actual.result]++; });
  const sweeps = weeks.filter((_, i) => col[i].wins === nT);
  const best = col.reduce((bi, c, i) => (c.wins > col[bi].wins ? i : bi), 0);
  const rec = (o: Record<Res, number>) => `${o.W}G ${o.L}M${o.T ? ` ${o.T}B` : ""}`;

  // ---- geometry (logical px; canvas is 2x)
  const M = 44, NAME_W = 300, TOT_W = 118, GAP = 8, ROW_H = 62, HEAD_H = 268;
  const cellW = Math.max(74, Math.min(132, (1080 - 2 * M - NAME_W - TOT_W) / Math.max(nW, 1)));
  const gridW = NAME_W + nW * cellW + TOT_W;
  const W = Math.max(1080, gridW + 2 * M);
  const gx = (W - gridW) / 2;
  const statsY = HEAD_H + 28, statsH = 118;
  const bannerH = sweeps.length ? 64 : 0;
  const gridY = statsY + statsH + 26 + (bannerH ? bannerH + 18 : 0);
  const colHeadH = 58;
  const footY = gridY + colHeadH + nT * ROW_H + ROW_H + 26;
  const H = footY + 74;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.textBaseline = "middle";

  // ---- background + header
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, HEAD_H);
  g.addColorStop(0, C.brand); g.addColorStop(1, C.brandDark);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HEAD_H);
  // soft decorative rings
  ctx.globalAlpha = 0.09; ctx.strokeStyle = C.white; ctx.lineWidth = 38;
  ctx.beginPath(); ctx.arc(W - 90, 40, 190, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W - 90, 40, 300, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = C.white; ctx.textAlign = "left";
  ctx.font = `italic 900 24px ${FONT}`; ctx.fillText("takasmasası", M, 50);
  ctx.globalAlpha = 0.8; ctx.font = `600 17px ${FONT}`;
  ctx.fillText(fit(ctx, data.league, W - 2 * M - 180, 17, 600), M + 158, 51);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.white;
  const head = logos[data.team];
  const nameX = head ? M + 104 + 24 : M;
  if (head) circleLogo(ctx, head, M + 52, 136, 52, "rgba(255,255,255,.9)", 4);
  ctx.fillStyle = C.white; ctx.textAlign = "left";
  ctx.fillText(fit(ctx, teamName, W - M - nameX, 76, 900, 30), nameX, 138);
  ctx.globalAlpha = 0.92; ctx.font = `600 25px ${FONT}`;
  ctx.fillText("Her hafta ligdeki herkesle oynasaydım, kaç kaç biterdi?", M, 212);
  ctx.globalAlpha = 1;

  // ---- stat tiles
  const tiles = [
    { k: "Herkese karşı", v: rec(tot), s: `${tot.W + tot.L + tot.T} eşleşme` },
    { k: "Gerçek fikstür", v: rec(real), s: "oynanan maçlar" },
    { k: "En iyi hafta", v: `${col[best].wins}/${nT}`, s: `${weeks[best].week}. haftada yenerdi` },
  ];
  const tw = (W - 2 * M - 2 * 16) / 3;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + 16);
    ctx.shadowColor = "rgba(35,42,49,.14)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    rr(ctx, x, statsY, tw, statsH, 16, C.white);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.textAlign = "left";
    ctx.fillStyle = C.muted; ctx.font = `700 16px ${FONT}`; ctx.fillText(t.k, x + 20, statsY + 26);
    ctx.fillStyle = C.text; ctx.fillText(fit(ctx, t.v, tw - 40, 40, 900), x + 20, statsY + 64);
    ctx.fillStyle = C.muted; ctx.font = `500 15px ${FONT}`; ctx.fillText(t.s, x + 20, statsY + 98);
  });

  // ---- sweep banner: a dark bar with a gold score chip
  if (sweeps.length) {
    const by = statsY + statsH + 22;
    rr(ctx, M, by, W - 2 * M, bannerH, 14, C.text);
    rr(ctx, M, by, 8, bannerH, 4, C.gold);                       // gold edge
    const chipW = 86, chipH = 36, cx = M + 28, cy = by + (bannerH - chipH) / 2;
    rr(ctx, cx, cy, chipW, chipH, chipH / 2, C.gold);
    ctx.textAlign = "center"; ctx.fillStyle = C.text; ctx.font = `900 21px ${FONT}`;
    ctx.fillText(`${nT}/${nT}`, cx + chipW / 2, by + bannerH / 2 + 1);
    const wk = sweeps.map((w) => `${w.week}.`).join(", ");
    ctx.textAlign = "left"; ctx.fillStyle = C.white;
    ctx.fillText(fit(ctx, `${wk} haftada ligdeki herkesi yendi`, W - 2 * M - chipW - 250, 25, 800), cx + chipW + 18, by + bannerH / 2 + 1);
    ctx.textAlign = "right"; ctx.fillStyle = C.gold; ctx.font = `700 14px ${FONT}`;
    ctx.fillText(sweeps.length > 1 ? `${sweeps.length} KUSURSUZ HAFTA` : "KUSURSUZ HAFTA", W - M - 24, by + bannerH / 2 + 1);
  }

  // ---- grid: column headers
  ctx.textAlign = "center";
  weeks.forEach((w, i) => {
    const cx = gx + NAME_W + i * cellW + cellW / 2;
    ctx.fillStyle = C.text; ctx.font = `800 19px ${FONT}`; ctx.fillText(`${w.week}. hafta`, cx, gridY + 18);
    ctx.fillStyle = w.complete ? C.muted : C.brand; ctx.font = `600 13px ${FONT}`;
    ctx.fillText(w.complete ? `${dm(w.start)} – ${dm(w.end)}` : "devam ediyor", cx, gridY + 40);
  });
  ctx.fillStyle = C.text; ctx.font = `800 19px ${FONT}`;
  ctx.fillText("Toplam", gx + NAME_W + nW * cellW + TOT_W / 2, gridY + 28);

  // ---- grid: rows
  teams.forEach((t, r) => {
    const y = gridY + colHeadH + r * ROW_H;
    if (r % 2 === 0) rr(ctx, gx - 12, y, gridW + 24, ROW_H, 12, C.panel);
    ctx.textAlign = "left"; ctx.fillStyle = C.text;
    const lg = logos[t.key];
    if (lg) circleLogo(ctx, lg, gx + 22, y + ROW_H / 2, 19, C.line, 2);
    ctx.textAlign = "left"; ctx.fillStyle = C.text;
    ctx.fillText(fit(ctx, t.name, NAME_W - (lg ? 68 : 20), 21, 700), gx + (lg ? 52 : 4), y + ROW_H / 2);
    const vs: Record<Res, number> = { W: 0, L: 0, T: 0 };
    weeks.forEach((w, i) => {
      const row = w.rows.find((x) => x.team === t.key);
      if (!row) return;
      const a = row.actual, res = a.result;
      vs[res]++;
      const x = gx + NAME_W + i * cellW + GAP / 2, cw = cellW - GAP, ch = ROW_H - 14, cy = y + 7;
      const isReal = w.real_opponent === t.key;
      rr(ctx, x, cy, cw, ch, 10, res === "W" ? C.win : res === "L" ? C.loss : C.tie);
      if (isReal) rr(ctx, x - 3, cy - 3, cw + 6, ch + 6, 13, null, C.text, 3);
      ctx.textAlign = "center";
      ctx.fillStyle = res === "W" ? C.white : res === "L" ? C.lossText : C.tieText;
      ctx.font = `${res === "W" ? 900 : 700} 23px ${FONT}`;
      const sc = a.score ?? { W: 0, L: 0, T: 0 };
      const label = isPts ? `${(a.a_points ?? 0).toFixed(0)}-${(a.b_points ?? 0).toFixed(0)}` : `${sc.W}-${sc.L}${sc.T ? `-${sc.T}` : ""}`;
      ctx.fillText(fit(ctx, label, cw - 8, 23, res === "W" ? 900 : 700, 12), x + cw / 2, cy + ch / 2 + 1);
    });
    ctx.textAlign = "center"; ctx.fillStyle = vs.W > vs.L ? C.win : vs.L > vs.W ? C.lossText : C.muted;
    ctx.font = `800 21px ${FONT}`;
    ctx.fillText(`${vs.W}-${vs.L}${vs.T ? `-${vs.T}` : ""}`, gx + NAME_W + nW * cellW + TOT_W / 2, y + ROW_H / 2);
  });

  // ---- grid: bottom row (teams beaten per week)
  const by = gridY + colHeadH + nT * ROW_H + 6;
  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(gx - 12, by - 3); ctx.lineTo(gx + gridW + 12, by - 3); ctx.stroke();
  ctx.textAlign = "left"; ctx.fillStyle = C.text; ctx.font = `800 20px ${FONT}`;
  ctx.fillText("Yendiği takım", gx + 4, by + ROW_H / 2);
  col.forEach((c, i) => {
    const x = gx + NAME_W + i * cellW + GAP / 2, cw = cellW - GAP, ch = ROW_H - 14, cy = by + 7;
    const sweep = c.wins === nT;
    rr(ctx, x, cy, cw, ch, 10, sweep ? C.gold : c.wins > nT / 2 ? C.winSoft : C.white, sweep ? null : C.line, 2);
    ctx.textAlign = "center"; ctx.fillStyle = sweep ? C.text : c.wins > nT / 2 ? C.win : C.text;
    ctx.font = `900 22px ${FONT}`;
    ctx.fillText(`${c.wins}/${nT}`, x + cw / 2, cy + ch / 2 + 1);
  });
  ctx.fillStyle = C.brand; ctx.font = `900 22px ${FONT}`;
  ctx.fillText(`${tot.W}/${tot.W + tot.L + tot.T}`, gx + NAME_W + nW * cellW + TOT_W / 2, by + ROW_H / 2);

  // ---- footer
  ctx.textAlign = "left"; ctx.fillStyle = C.muted; ctx.font = `500 15px ${FONT}`;
  rr(ctx, M, footY + 9, 26, 18, 5, null, C.text, 3);
  ctx.fillText(`o haftanın gerçek rakibi   ·   skor: kazanılan – kaybedilen ${isPts ? "puan" : "kategori"}`, M + 38, footY + 19);
  const d = new Date();
  ctx.textAlign = "right"; ctx.fillStyle = C.brand; ctx.font = `italic 900 17px ${FONT}`;
  ctx.fillText("takasmasası", W - M, footY + 19);
  ctx.fillStyle = C.muted; ctx.font = `500 13px ${FONT}`;
  ctx.fillText(`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, W - M, footY + 42);
  return canvas;
}

// ================================================================ trade poster
const signedTxt = (v: number, d: number) => (v > 0 ? "+" : "") + v.toFixed(d);

function header(ctx: Ctx, W: number, H: number, league: string, title: string, subtitle: string) {
  const M = 44;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.brand); g.addColorStop(1, C.brandDark);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.09; ctx.strokeStyle = C.white; ctx.lineWidth = 38;
  ctx.beginPath(); ctx.arc(W - 90, 40, 190, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W - 90, 40, 300, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.white; ctx.textAlign = "left";
  ctx.font = `italic 900 24px ${FONT}`; ctx.fillText("takasmasası", M, 50);
  ctx.globalAlpha = 0.8;
  ctx.fillText(fit(ctx, league, W - 2 * M - 180, 17, 600), M + 158, 51);
  ctx.globalAlpha = 1;
  ctx.font = `900 60px ${FONT}`; ctx.fillText(title, M, 122);
  ctx.globalAlpha = 0.92; ctx.font = `600 22px ${FONT}`; ctx.fillText(subtitle, M, 172);
  ctx.globalAlpha = 1;
}

function footer(ctx: Ctx, W: number, y: number, note: string) {
  const M = 44, d = new Date();
  ctx.textAlign = "left"; ctx.fillStyle = C.muted; ctx.font = `500 15px ${FONT}`;
  ctx.fillText(note, M, y + 19);
  ctx.textAlign = "right"; ctx.fillStyle = C.brand; ctx.font = `italic 900 17px ${FONT}`;
  ctx.fillText("takasmasası", W - M, y + 19);
  ctx.fillStyle = C.muted; ctx.font = `500 13px ${FONT}`;
  ctx.fillText(`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, W - M, y + 42);
}

interface Section { label: string; color: string; players: string[] }

/** One image for a trade: what each side gives (and must drop / can add), each side's
 *  net value, and the per-category change with league rank before -> after. */
export function drawTradePoster(r: TradeResult, giveA: string[], giveB: string[], period: string, logos: Logos = {}): HTMLCanvasElement {
  const isPts = r.scoring === "points";
  const d = isPts ? 1 : 2;
  const teams = { a: r.teams.a, b: r.teams.b };
  const name = (t: string) => store.teamName[t] ?? t;
  const value = (k: string) => (isPts ? r.players[k]?.fpts : r.players[k]?.z?.TOTAL) ?? null;
  const sections = (side: "a" | "b"): Section[] => {
    const give = side === "a" ? giveA : giveB;
    const drops = side === "a" ? r.moves.drops_a : r.moves.drops_b;
    const adds = side === "a" ? r.moves.adds_a : r.moves.adds_b;
    return [
      { label: "VERİR", color: C.muted, players: give },
      { label: "YER AÇMAK İÇİN BIRAKIR", color: C.lossText, players: drops },
      { label: "AÇILAN YERE EKLER", color: C.win, players: adds },
    ].filter((s) => s.players.length);
  };
  const secA = sections("a"), secB = sections("b");

  // ---- geometry (logical px; canvas is 2x)
  const W = 1080, M = 44, HEAD_H = 204, GAP = 60, PROW = 56, SEC_H = 34;
  const PW = (W - 2 * M - GAP) / 2;
  const panelH = (s: Section[]) => 100 + s.reduce((h, x) => h + SEC_H + x.players.length * PROW, 0) + 12;
  const PH = Math.max(panelH(secA), panelH(secB));
  const y0 = HEAD_H + 28;
  const y1 = y0 + PH + 18, TILE_H = 112;
  const y2 = y1 + TILE_H + 30, TH = 46, ROW = 48;
  const footY = y2 + TH + r.categories.length * ROW + 24;
  const H = footY + 70;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
  header(ctx, W, HEAD_H, store.league.name, "Takas Analizi", `${period} · maç başı değerler`);

  // ---- the two sides
  const panel = (side: "a" | "b", x: number, secs: Section[]) => {
    const t = teams[side];
    ctx.shadowColor = "rgba(35,42,49,.14)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    rr(ctx, x, y0, PW, PH, 16, C.white);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    rr(ctx, x, y0, PW, 6, 3, side === "a" ? C.a : C.brand);
    const lg = logos[t];
    if (lg) circleLogo(ctx, lg, x + 50, y0 + 52, 30, C.line, 2);
    ctx.textAlign = "left"; ctx.fillStyle = C.text;
    ctx.fillText(fit(ctx, name(t), PW - (lg ? 116 : 40), 27, 900, 16), x + (lg ? 94 : 20), y0 + 52);
    let y = y0 + 96;
    for (const s of secs) {
      ctx.fillStyle = s.color; ctx.font = `800 13px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(s.label, x + 20, y + SEC_H / 2);
      y += SEC_H;
      for (const k of s.players) {
        const p = store.players[k];
        const v = value(k);
        rr(ctx, x + 12, y + 3, PW - 24, PROW - 6, 10, C.panel);
        ctx.textAlign = "left"; ctx.fillStyle = C.text;
        ctx.fillText(fit(ctx, p?.name ?? k, PW - 150, 20, 700, 13), x + 26, y + 20);
        ctx.fillStyle = C.muted; ctx.font = `600 13px ${FONT}`;
        const sub = p ? [p.nba_team, (p.positions || []).join(",")].filter(Boolean).join(" - ") : "";
        ctx.fillText(sub + (p?.status ? `  ·  ${p.status}` : ""), x + 26, y + 41);
        ctx.textAlign = "right"; ctx.font = `800 20px ${FONT}`;
        ctx.fillStyle = v == null ? C.muted : v > 0 ? C.win : v < 0 ? C.lossText : C.text;
        ctx.fillText(v == null ? "–" : signedTxt(v, d), x + PW - 26, y + PROW / 2);
        y += PROW;
      }
    }
  };
  panel("a", M, secA);
  panel("b", M + PW + GAP, secB);

  // swap arrows between the panels
  const cx = W / 2, cy = y0 + 52;
  ctx.strokeStyle = C.brand; ctx.fillStyle = C.brand; ctx.lineWidth = 4; ctx.lineCap = "round";
  const arrow = (y: number, dir: 1 | -1) => {
    const x1 = cx - 18 * dir, x2 = cx + 18 * dir;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2 + 4 * dir, y); ctx.lineTo(x2 - 8 * dir, y - 8); ctx.lineTo(x2 - 8 * dir, y + 8); ctx.closePath(); ctx.fill();
  };
  arrow(cy - 9, 1); arrow(cy + 9, -1);

  // ---- net value tiles
  const uneven = r.moves.drops_a.length + r.moves.drops_b.length + r.moves.adds_a.length + r.moves.adds_b.length > 0;
  const tile = (side: "a" | "b", x: number) => {
    const net = side === "a" ? r.a_net_value : r.b_net_value;
    const key = side === "a" ? "better_for_a" : "better_for_b";
    const up = r.categories.filter((c) => c[key] === "W").length, down = r.categories.filter((c) => c[key] === "L").length;
    rr(ctx, x, y1, PW, TILE_H, 16, net > 0 ? C.winSoft : net < 0 ? C.loss : C.tie);
    ctx.textAlign = "left"; ctx.fillStyle = C.muted; ctx.font = `700 15px ${FONT}`;
    ctx.fillText(`Net ${isPts ? "FPTS / maç" : "değer (z-skor)"}${uneven ? " · bırakılan ve eklenen dahil" : ""}`, x + 20, y1 + 26);
    ctx.fillStyle = net > 0 ? C.win : net < 0 ? C.lossText : C.text; ctx.font = `900 44px ${FONT}`;
    ctx.fillText(signedTxt(net, d), x + 20, y1 + 68);
    if (!isPts) {
      ctx.textAlign = "right"; ctx.fillStyle = C.text; ctx.font = `700 17px ${FONT}`;
      ctx.fillText(`${up} kategori iyileşir`, x + PW - 20, y1 + 56);
      ctx.fillText(`${down} kategori kötüleşir`, x + PW - 20, y1 + 82);
    }
  };
  tile("a", M); tile("b", M + PW + GAP);

  // ---- categories: change of each team's own per-game total, and league rank before -> after
  const CW = 150, sideW = (W - 2 * M - CW) / 2, netW = sideW * 0.46;
  const colX = { aNet: M + netW / 2, aRank: M + netW + (sideW - netW) / 2, cat: W / 2,
                 bNet: W / 2 + CW / 2 + netW / 2, bRank: W / 2 + CW / 2 + netW + (sideW - netW) / 2 };
  rr(ctx, M, y2, W - 2 * M, TH, 10, C.panel);
  ctx.textAlign = "center"; ctx.fillStyle = C.text;
  ctx.fillText(fit(ctx, name(teams.a), netW + (sideW - netW) - 20, 17, 800), M + sideW / 2, y2 + 14);
  ctx.fillText(fit(ctx, name(teams.b), sideW - 20, 17, 800), W / 2 + CW / 2 + sideW / 2, y2 + 14);
  ctx.fillStyle = C.muted; ctx.font = `600 12px ${FONT}`;
  for (const x of [colX.aNet, colX.bNet]) ctx.fillText("net değişim", x, y2 + 33);
  for (const x of [colX.aRank, colX.bRank]) ctx.fillText(`lig sırası (${r.league_size} takım)`, x, y2 + 33);
  ctx.fillStyle = C.text; ctx.font = `800 15px ${FONT}`; ctx.fillText("Kategori", colX.cat, y2 + TH / 2);

  const impact = (t: string, k: string) => r.team_impact[t]?.find((x) => x.key === k);
  r.categories.forEach((c, i) => {
    const y = y2 + TH + i * ROW;
    if (i % 2) rr(ctx, M, y, W - 2 * M, ROW, 8, "#fafbfc");
    const ratio = !!store.league.categories.find((x) => x.key === c.key)?.ratio;
    ctx.textAlign = "center"; ctx.fillStyle = C.text; ctx.font = `800 19px ${FONT}`;
    ctx.fillText(c.label, colX.cat, y + ROW / 2);
    const side = (net: number | null, res: Res, t: string, xNet: number, xRank: number) => {
      ctx.font = `800 20px ${FONT}`;
      ctx.fillStyle = res === "W" ? C.win : res === "L" ? C.lossText : C.muted;
      ctx.fillText(net == null ? "–" : signedTxt(net, ratio ? 3 : 1), xNet, y + ROW / 2);
      const im = impact(t, c.key);
      if (!im) return;
      const dr = im.rank_before - im.rank_after;
      ctx.font = `${dr ? 800 : 600} 18px ${FONT}`;
      ctx.fillStyle = dr > 0 ? C.win : dr < 0 ? C.lossText : C.muted;
      ctx.fillText(`${im.rank_before}.  →  ${im.rank_after}.${dr > 0 ? `  ▲${dr}` : dr < 0 ? `  ▼${-dr}` : ""}`, xRank, y + ROW / 2);
    };
    side(c.a_net, c.better_for_a, teams.a, colX.aNet, colX.aRank);
    side(c.b_net, c.better_for_b, teams.b, colX.bNet, colX.bRank);
  });
  // divider under the category column
  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  for (const x of [W / 2 - CW / 2, W / 2 + CW / 2]) {
    ctx.beginPath(); ctx.moveTo(x, y2 + TH + 6); ctx.lineTo(x, y2 + TH + r.categories.length * ROW - 6); ctx.stroke();
  }

  footer(ctx, W, footY, isPts ? "Oyuncu değeri: maç başı fantasy puanı" : "Oyuncu değeri: maç başı z-skor toplamı · net değişim: takımın kendi toplamındaki fark");
  return canvas;
}
