// A team's place in the standings after each completed week (1st place at the top).
// Drawn at the container's real width so labels keep their size on phones.
import { useEffect, useRef, useState } from "preact/hooks";
import { rec, RES, store } from "./store";
import type { PositionPoint } from "./types";
import { TableWrap } from "./ui";

const H = 220, L = 34, R = 34, T = 14, B = 28;
const scoreText = (p: PositionPoint) => (p.score ? `${p.score.W}-${p.score.L}${p.score.T ? "-" + p.score.T : ""}` : "");

export function RankChart({ n, points }: { n: number; points: PositionPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [act, setAct] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = W - L - R, ih = H - T - B;
  const x = (i: number) => L + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (r: number) => T + (n > 1 ? ((r - 1) / (n - 1)) * ih : ih / 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" ");
  const rankStep = n > 12 ? 2 : 1;
  const ranks = Array.from({ length: n }, (_, i) => i + 1).filter((r) => r === 1 || r === n || (r - 1) % rankStep === 0);
  const weekStep = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(iw / 44))));
  const colW = points.length > 1 ? iw / (points.length - 1) : iw;
  const last = points.length - 1;
  const a = act != null ? points[act] : null;

  return (
    <>
      <div class="rank-chart" ref={box} onPointerLeave={() => setAct(null)}>
        <svg width={W} height={H} role="img"
          aria-label={`Hafta hafta lig sırası: ${points.map((p) => `${p.week}. hafta ${p.rank}.`).join(", ")}`}>
          {ranks.map((r) => (
            <g key={r}>
              <line class="grid" x1={L} x2={W - R} y1={y(r)} y2={y(r)} />
              <text class="tick" x={L - 8} y={y(r)} text-anchor="end" dominant-baseline="middle">{r}.</text>
            </g>
          ))}
          {points.map((p, i) => (i % weekStep === 0 || i === last) && (i === last || last - i >= weekStep) ? (
            <text key={p.week} class="tick" x={x(i)} y={H - 8} text-anchor="middle">{p.week}. hf</text>
          ) : null)}
          {a && <line class="cross" x1={x(act!)} x2={x(act!)} y1={T - 6} y2={T + ih + 6} />}
          <path class="line" d={line} />
          {points.map((p, i) => <circle key={p.week} class="dot" cx={x(i)} cy={y(p.rank)} r={act === i ? 6 : 4} />)}
          <text class="end" x={x(last) + 10} y={y(points[last].rank)} dominant-baseline="middle">{points[last].rank}.</text>
          {points.map((p, i) => (
            <rect key={p.week} class="hit" x={x(i) - colW / 2} y={0} width={colW} height={H} tabIndex={0}
              aria-label={`${p.week}. hafta sonunda ${p.rank}. sıra`}
              onPointerEnter={() => setAct(i)} onPointerDown={() => setAct(i)} onFocus={() => setAct(i)} onBlur={() => setAct(null)} />
          ))}
        </svg>
        {a && (
          <div class="chart-tip" style={{ left: `${Math.min(Math.max(x(act!), 80), W - 80)}px`, top: y(a.rank) < H / 2 ? `${H - B - 62}px` : "6px" }}>
            <div class="muted small">{a.week}. hafta sonu</div>
            <div><b>{a.rank}. sıra</b> <span class="muted small">{rec(a.record)}</span></div>
            {a.result && <div class="small">{RES[a.result]} {scoreText(a)} · {store.teamName[a.opponent ?? ""] ?? ""}</div>}
          </div>
        )}
      </div>
      <details class="ptable">
        <summary>Tablo olarak</summary>
        <TableWrap>
          <thead><tr><th class="l">Hafta</th><th>Sıra</th><th>Kategori rekoru</th><th class="l">O haftanın maçı</th></tr></thead>
          <tbody>{points.map((p) => (
            <tr key={p.week}>
              <td class="l">{p.week}. hafta</td><td><b>{p.rank}.</b></td><td>{rec(p.record)}</td>
              <td class="l">{p.result ? `${RES[p.result]} ${scoreText(p)} · ${store.teamName[p.opponent ?? ""] ?? ""}` : "–"}</td>
            </tr>
          ))}</tbody>
        </TableWrap>
      </details>
    </>
  );
}
