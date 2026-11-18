// A generic poster: purple header, optional stat tiles and bullet list, then one or
// more tables. Every tab describes its poster as data (PosterSpec) and this draws it.
import { C, circleLogo, fit, FONT, footer, header, rr, type Ctx, type Logos } from "./share";
import { store } from "./store";

export interface PCell {
  text?: string; sub?: string; color?: string; subColor?: string; bold?: boolean;
  bg?: string;          // rounded background behind the cell
  team?: string;        // team key: draws the picture before the text
  pill?: boolean;       // rank pill
  bar?: number;         // 0-100 bar under the text
}
export type Cell = string | number | PCell | null | undefined;
export interface PColumn { label: string; w: number; align?: "l" | "r" | "c" }
export interface PSection {
  heading?: string; note?: string; columns: PColumn[]; rows: Cell[][]; rowBg?: (string | undefined)[];
  /** a place-by-week line (1st at the top) drawn instead of the table */
  chart?: { n: number; points: { label: string; rank: number }[] };
}
export interface PTile { k: string; v: string; s?: string; tone?: "good" | "bad" | "plain" }
export interface PosterSpec {
  title: string; subtitle: string; footer: string; width?: number;
  /** team key: its picture goes into the header */
  logo?: string | null;
  tiles?: PTile[]; bullets?: { heading: string; items: string[] }; sections: PSection[];
}

export const TONE = { good: C.win, bad: C.lossText, muted: C.muted, brand: C.brand, flip: "#fff6d6" };
const M = 44, HEAD_H = 204, TH = 44, TILE_H = 112, PAD = 12, CHART_H = 260;
const norm = (c: Cell): PCell => (c == null ? { text: "–", color: C.muted } : typeof c === "object" ? c : { text: String(c) });
const rowH = (rows: Cell[][]) => (rows.some((r) => r.some((c) => typeof c === "object" && c !== null && (c.sub || c.bar != null))) ? 60 : 50);

export function drawPoster(spec: PosterSpec, logos: Logos = {}): HTMLCanvasElement {
  const W = spec.width ?? 1080;
  const inner = W - 2 * M;

  // ---- measure
  let H = HEAD_H + 28;
  if (spec.tiles?.length) H += TILE_H + 24;
  if (spec.bullets?.items.length) H += 34 + spec.bullets.items.length * 30 + 22;
  for (const s of spec.sections) H += (s.heading ? 46 : 0) + (s.chart ? CHART_H : TH + s.rows.length * rowH(s.rows)) + (s.note ? 30 : 0) + 26;
  const footY = H;
  H += 70;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
  header(ctx, W, HEAD_H, store.league.name, spec.title, spec.subtitle, spec.logo ? logos[spec.logo] : undefined);
  let y = HEAD_H + 28;

  // ---- tiles
  if (spec.tiles?.length) {
    const n = spec.tiles.length, tw = (inner - (n - 1) * 16) / n;
    spec.tiles.forEach((t, i) => {
      const x = M + i * (tw + 16);
      rr(ctx, x, y, tw, TILE_H, 16, t.tone === "good" ? C.winSoft : t.tone === "bad" ? C.loss : C.panel);
      ctx.textAlign = "left"; ctx.fillStyle = C.muted; ctx.font = `700 15px ${FONT}`;
      ctx.fillText(fit(ctx, t.k, tw - 40, 15, 700), x + 20, y + 26);
      ctx.fillStyle = t.tone === "good" ? C.win : t.tone === "bad" ? C.lossText : C.text;
      ctx.fillText(fit(ctx, t.v, tw - 40, 38, 900, 18), x + 20, y + 62);
      if (t.s) { ctx.fillStyle = C.muted; ctx.fillText(fit(ctx, t.s, tw - 40, 15, 500), x + 20, y + 94); }
    });
    y += TILE_H + 24;
  }

  // ---- bullets
  if (spec.bullets?.items.length) {
    ctx.textAlign = "left"; ctx.fillStyle = C.text; ctx.font = `800 19px ${FONT}`;
    ctx.fillText(spec.bullets.heading, M, y + 14);
    y += 34;
    for (const it of spec.bullets.items) {
      ctx.fillStyle = C.brand; ctx.beginPath(); ctx.arc(M + 8, y + 15, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, it, inner - 30, 18, 500, 12), M + 24, y + 15);
      y += 30;
    }
    y += 22;
  }

  // ---- tables
  for (const s of spec.sections) {
    if (s.heading) {
      ctx.textAlign = "left"; ctx.fillStyle = C.text; ctx.font = `900 22px ${FONT}`;
      ctx.fillText(s.heading, M, y + 20);
      y += 46;
    }
    if (s.chart) {
      drawRankChart(ctx, s.chart, M, y, inner, CHART_H);
      y += CHART_H;
      if (s.note) {
        ctx.textAlign = "left"; ctx.fillStyle = C.muted;
        ctx.fillText(fit(ctx, s.note, inner, 14, 500, 10), M, y + 18);
        y += 30;
      }
      y += 26;
      continue;
    }
    const total = s.columns.reduce((a, c) => a + c.w, 0);
    const xs: number[] = [], ws: number[] = [];
    let x = M;
    for (const c of s.columns) { xs.push(x); const w = (c.w / total) * inner; ws.push(w); x += w; }
    const align = (i: number) => s.columns[i].align ?? (i === 0 ? "l" : "r");
    const anchor = (i: number) => (align(i) === "l" ? xs[i] + PAD : align(i) === "r" ? xs[i] + ws[i] - PAD : xs[i] + ws[i] / 2);
    const setAlign = (ctx: Ctx, i: number) => { ctx.textAlign = align(i) === "l" ? "left" : align(i) === "r" ? "right" : "center"; };

    rr(ctx, M, y, inner, TH, 10, C.panel);
    s.columns.forEach((c, i) => {
      setAlign(ctx, i); ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, c.label, ws[i] - 2 * PAD + 8, 15, 800, 10), anchor(i), y + TH / 2);
    });
    y += TH;

    const rh = rowH(s.rows);
    s.rows.forEach((row, r) => {
      const bg = s.rowBg?.[r];
      if (bg) rr(ctx, M, y + 1, inner, rh - 2, 8, bg);
      else if (r % 2) rr(ctx, M, y, inner, rh, 8, "#fafbfc");
      row.forEach((raw, i) => {
        if (i >= s.columns.length) return;
        const c = norm(raw);
        const cy = y + rh / 2;
        let left = xs[i] + PAD, width = ws[i] - 2 * PAD;
        if (c.bg) rr(ctx, xs[i] + 3, y + 4, ws[i] - 6, rh - 8, 8, c.bg);
        if (c.pill) {
          const pw = 34;
          rr(ctx, xs[i] + ws[i] / 2 - pw / 2, cy - 14, pw, 28, 14, C.white, C.line, 2);
          ctx.textAlign = "center"; ctx.fillStyle = C.text; ctx.font = `800 15px ${FONT}`;
          ctx.fillText(c.text ?? "", xs[i] + ws[i] / 2, cy + 1);
          return;
        }
        if (c.team) {
          const lg = logos[c.team];
          if (lg) { circleLogo(ctx, lg, left + 18, cy, 18, C.line, 2); left += 46; width -= 46; }
        }
        const two = !!c.sub, ty = two ? cy - 10 : c.bar != null ? cy - 6 : cy;
        const a = c.team ? "l" : align(i);
        ctx.textAlign = a === "l" ? "left" : a === "r" ? "right" : "center";
        const ax = a === "l" ? left : a === "r" ? left + width : left + width / 2;
        ctx.fillStyle = c.color ?? C.text;
        ctx.fillText(fit(ctx, c.text ?? "", width, 19, c.bold || c.team ? 800 : 500, 11), ax, ty);
        if (two) {
          ctx.fillStyle = c.subColor ?? C.muted;
          ctx.fillText(fit(ctx, c.sub!, width, 13, 600, 9), ax, cy + 13);
        }
        if (c.bar != null) {
          const bw = Math.max(4, (Math.min(100, c.bar) / 100) * width);
          rr(ctx, a === "r" ? left + width - bw : left, cy + 12, bw, 5, 2.5, C.brand);
        }
      });
      y += rh;
    });
    if (s.note) {
      ctx.textAlign = "left"; ctx.fillStyle = C.muted;
      ctx.fillText(fit(ctx, s.note, inner, 14, 500, 10), M, y + 18);
      y += 30;
    }
    y += 26;
  }

  footer(ctx, W, footY, "");
  ctx.textAlign = "left"; ctx.fillStyle = C.muted;
  ctx.fillText(fit(ctx, spec.footer, inner - 170, 15, 500, 10), M, footY + 19);
  return canvas;
}

/** Place after each week: 1st at the top, one gridline per place, the last place labelled. */
function drawRankChart(ctx: Ctx, ch: NonNullable<PSection["chart"]>, x0: number, y0: number, w: number, h: number) {
  rr(ctx, x0, y0, w, h, 14, C.panel);
  const l = x0 + 56, r = x0 + w - 56, t = y0 + 24, b = y0 + h - 46;
  const pts = ch.points, last = pts.length - 1;
  const px = (i: number) => (pts.length === 1 ? (l + r) / 2 : l + (i / last) * (r - l));
  const py = (rank: number) => (ch.n > 1 ? t + ((rank - 1) / (ch.n - 1)) * (b - t) : (t + b) / 2);
  const step = ch.n > 12 ? 2 : 1;
  ctx.lineWidth = 1; ctx.strokeStyle = C.line;
  ctx.textAlign = "right"; ctx.fillStyle = C.muted; ctx.font = `600 14px ${FONT}`;
  for (let rank = 1; rank <= ch.n; rank++) {
    if (!(rank === 1 || rank === ch.n || (rank - 1) % step === 0)) continue;
    ctx.beginPath(); ctx.moveTo(l, py(rank)); ctx.lineTo(r, py(rank)); ctx.stroke();
    ctx.fillText(`${rank}.`, l - 14, py(rank));
  }
  const every = Math.max(1, Math.ceil(pts.length / 14));
  ctx.textAlign = "center";
  pts.forEach((p, i) => { if ((i % every === 0 && last - i >= every) || i === last) ctx.fillText(p.label, px(i), b + 26); });
  ctx.strokeStyle = C.brand; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(px(i), py(p.rank)) : ctx.moveTo(px(i), py(p.rank))));
  ctx.stroke();
  for (const [i, p] of pts.entries()) {
    ctx.beginPath(); ctx.arc(px(i), py(p.rank), 6, 0, Math.PI * 2);
    ctx.fillStyle = C.brand; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.white; ctx.stroke();
  }
  ctx.textAlign = "left"; ctx.fillStyle = C.text; ctx.font = `900 20px ${FONT}`;
  ctx.fillText(`${pts[last].rank}.`, px(last) + 14, py(pts[last].rank));
}
