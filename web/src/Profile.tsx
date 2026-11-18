// The popup that opens when a player or team name is clicked: interesting numbers about them.
// Names inside the popup open the next profile; "←" goes back.
import { useEffect, useState } from "preact/hooks";
import { PosterButton } from "./PosterButton";
import { onProfile, type ProfileTarget } from "./profileBus";
import { playerFacts, playerSub, PROFILE_NOTE, teamFacts, teamSub, type Fact, type FactSection } from "./profileFacts";
import { playerPoster, teamPoster } from "./posters";
import { RankChart } from "./RankChart";
import { api, store } from "./store";
import type { PlayerProfile, TeamProfile } from "./types";
import { ErrorBox, ProfileLink, TableWrap, TeamLogo } from "./ui";

const same = (a: ProfileTarget, b: ProfileTarget) => a.kind === b.kind && a.key === b.key;

export function ProfileHost() {
  const [stack, setStack] = useState<ProfileTarget[]>([]);
  useEffect(() => onProfile((t) => setStack((s) => (s.length && same(s[s.length - 1], t) ? s : [...s, t]))), []);
  if (!stack.length) return null;
  const cur = stack[stack.length - 1];
  return <ProfileModal key={`${cur.kind}:${cur.key}`} target={cur} back={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : null} close={() => setStack([])} />;
}

type Loaded = { kind: "player"; p: PlayerProfile } | { kind: "team"; t: TeamProfile };

function ProfileModal({ target, back, close }: { target: ProfileTarget; back: (() => void) | null; close: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const path = target.kind === "player" ? `/api/player?key=${encodeURIComponent(target.key)}` : `/api/team?team=${encodeURIComponent(target.key)}`;
    api<PlayerProfile & TeamProfile>(path)
      .then((d) => setData(target.kind === "player" ? { kind: "player", p: d } : { kind: "team", t: d }))
      .catch((e) => setError(String(e.message || e)));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelectorAll(".modal").length > 1) return;   // the poster dialog closes first
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isTeam = target.kind === "team";
  const name = data?.kind === "player" ? data.p.name : data?.kind === "team" ? data.t.name
    : isTeam ? store.teamName[target.key] ?? target.key : store.players[target.key]?.name ?? target.key;
  const sub = data?.kind === "player" ? playerSub(data.p) : data?.kind === "team" ? teamSub(data.t) : "";
  const status = data?.kind === "player" ? data.p.status : "";
  const facts: FactSection[] = !data ? [] : data.kind === "player" ? playerFacts(data.p) : teamFacts(data.t);
  const poster = !data ? null : data.kind === "player" ? () => playerPoster(data.p) : () => teamPoster(data.t);

  return (
    <div class="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal-box profile-box" role="dialog" aria-modal="true" aria-label={name}>
        <div class="modal-head">
          <div class="profile-title">
            {back && <button class="ghost icon" title="Geri" onClick={back}>←</button>}
            {isTeam && <TeamLogo team={target.key} size={44} />}
            <div>
              <h3 style="margin:0">{name}{status ? <span class="inj">{status}</span> : null}</h3>
              <div class="muted small">{sub || (isTeam ? "Takım" : "Oyuncu")}</div>
            </div>
          </div>
          <div class="modal-actions">
            {poster && <PosterButton name={`${isTeam ? "takim" : "oyuncu"}-${name}`} make={poster} />}
            <button class="ghost" title="Kapat" onClick={close}>✕</button>
          </div>
        </div>
        <div class="profile-body">
          {error ? <ErrorBox msg={error} /> : !data ? <p class="muted">Yükleniyor…</p> : <>
            {facts.map((sec) => (
              <section class="psec" key={sec.title}>
                <h4>{sec.title}</h4>
                {sec.items.length > 0 && <div class="facts">{sec.items.map((f, i) => <FactTile key={i} f={f} />)}</div>}
                {sec.chart && <>
                  <RankChart n={sec.chart.n} points={sec.chart.points} />
                  <p class="muted small note">{sec.chart.note}</p>
                </>}
                {sec.table && (
                  <details class="ptable">
                    <summary>Tüm kategoriler</summary>
                    <TableWrap>
                      <thead><tr>{sec.table.columns.map((c, i) => <th key={i} class={i ? "" : "l"}>{c}</th>)}</tr></thead>
                      <tbody>{sec.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} class={j ? "" : "l"}>{c}</td>)}</tr>)}</tbody>
                    </TableWrap>
                  </details>
                )}
              </section>
            ))}
            <p class="muted small note">{PROFILE_NOTE}</p>
          </>}
        </div>
      </div>
    </div>
  );
}

function FactTile({ f }: { f: Fact }) {
  const cls = f.tone === "good" ? "pos" : f.tone === "bad" ? "neg" : "";
  const value = f.player ? <ProfileLink to={{ kind: "player", key: f.player }} class="pl-name">{f.v}</ProfileLink>
    : f.team ? <ProfileLink to={{ kind: "team", key: f.team }} class="tname"><TeamLogo team={f.team} size={20} /><span class="pl-name">{f.v}</span></ProfileLink>
    : <span class={cls}>{f.v}</span>;
  return (
    <div class="fact">
      <div class="k">{f.k}</div>
      <div class="v">{value}</div>
      {f.s ? <div class="s">{f.s}</div> : null}
    </div>
  );
}
