// Draws the "what if I had played everyone, every week" poster on a canvas.
// Pure drawing code: takes the /api/allplay response, returns a <canvas> (2x resolution).
import type { AllPlay, Res } from "./types";

type Ctx = CanvasRenderingContext2D;

const C = {
  brand: "#6001d2", brandDark: "#3b0086", text: "#232a31", muted: "#5b636a", line: "#e0e4e9",
  panel: "#f5f8fa", win: "#0f8a43", winSoft: "#e3f6ea", loss: "#fdecef", lossText: "#c2143a",
  tie: "#eef0f3", tieText: "#5b636a", gold: "#f5b301", goldSoft: "#fff4cc", white: "#ffffff",
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

export function drawAllPlayPoster(data: AllPlay, teamName: string): HTMLCanvasElement {
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
  ctx.fillText(fit(ctx, teamName, W - 2 * M, 76, 900, 30), M, 138);
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

  // ---- sweep banner
  if (sweeps.length) {
    const by = statsY + statsH + 22;
    rr(ctx, M, by, W - 2 * M, bannerH, 16, C.goldSoft, C.gold, 2);
    ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.font = `900 26px ${FONT}`;
    const wk = sweeps.map((w) => `${w.week}.`).join(", ");
    ctx.fillText(`👑  ${wk} haftada TÜM LİGİ YENDİ  👑`, W / 2, by + bannerH / 2 + 1);
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
    ctx.fillText(fit(ctx, t.name, NAME_W - 20, 21, 700), gx + 4, y + ROW_H / 2);
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
    ctx.fillText(`${sweep ? "👑 " : ""}${c.wins}/${nT}`, x + cw / 2, cy + ch / 2 + 1);
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
