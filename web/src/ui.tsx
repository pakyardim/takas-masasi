// Small shared building blocks.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { cls, signed, store } from "./store";

/** Yahoo-style player cell: name in link blue, injury tag in red, "NYK - PG,SG" underneath. */
export function PlayerLabel({ k }: { k: string }) {
  const p = store.players[k];
  const sub = p ? [p.nba_team, (p.positions || []).join(",")].filter(Boolean).join(" - ") : "";
  return (
    <>
      <span class="pl-name">{p?.name || k}</span>
      {p?.status ? <span class="inj">{p.status}</span> : null}
      {sub ? <span class="pl-sub">{sub}</span> : null}
    </>
  );
}

/** Round team picture (falls back to the team's initial). */
export function TeamLogo({ team, size = 24 }: { team: string; size?: number }) {
  const url = store.teamLogo[team];
  if (url) return <img class="tlogo" src={url} width={size} height={size} alt="" loading="lazy" />;
  return <span class="tlogo ph" style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>{(store.teamName[team] ?? "?").slice(0, 1)}</span>;
}

/** Team picture + name, as one inline unit. */
export function TeamName({ team, name, plain }: { team?: string | null; name?: string; plain?: boolean }) {
  const label = name ?? (team ? store.teamName[team] : "") ?? "";
  if (!team) return <span class={plain ? "" : "pl-name"}>{label}</span>;
  return <span class="tname"><TeamLogo team={team} /><span class={plain ? "" : "pl-name"}>{label}</span></span>;
}

/** Page title with an optional action (e.g. the poster button) on the right. */
export function PageHead({ title, sub, children }: { title: string; sub: string; children?: ComponentChildren }) {
  return (
    <>
      <div class="title-row"><h2 class="page-title">{title}</h2>{children}</div>
      <p class="muted" style="margin:0 0 14px">{sub}</p>
    </>
  );
}

export const Val = ({ x, d = 1 }: { x: number; d?: number }) => <b class={cls(x)}>{signed(x, d)}</b>;
export const RankPill = ({ n }: { n: number | string }) => <span class="rank-pill">{n}</span>;
export const SideTag = ({ side, mini }: { side: "a" | "b"; mini?: boolean }) =>
  <span class={`side-tag ${side} ${mini ? "mini" : ""}`}>{side.toUpperCase()}</span>;

export function Card({ title, children, class: c = "" }: { title?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return <div class={`card ${c}`}>{title ? <h3>{title}</h3> : null}{children}</div>;
}
export const Empty = ({ children }: { children: ComponentChildren }) => <div class="card empty">{children}</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div class="error">{msg}</div>;

export function TableWrap({ children, class: c = "", id }: { children: ComponentChildren; class?: string; id?: string }) {
  return <div class="table-wrap" id={id}><table class={c}>{children}</table></div>;
}

/** Load something once when the component mounts. */
export function useLoad<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((d) => alive && setData(d)).catch((e) => alive && setError(String(e.message || e)));
    return () => { alive = false; };
  }, []);
  return { data, error };
}

export const NeedSync = ({ what, ver }: { what: string; ver: string }) => (
  <Empty>{what} için gereken veri henüz yok. Eklentiyi (sürüm {ver}+) yeniden yükleyip <b>Senkronize et</b>'e bas.</Empty>
);

export const TeamOptions = ({ exclude, mark }: { exclude?: string; mark?: Record<string, string> }) => (
  <>
    {store.league.teams.filter((t) => t.key !== exclude).map((t) => (
      <option value={t.key} key={t.key}>{t.name}{mark?.[t.key] ?? ""}</option>
    ))}
  </>
);
