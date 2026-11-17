import { useRef, useState } from "preact/hooks";
import { api, registerPlayers, signed, store } from "../store";
import type { DraftPick, DraftReport } from "../types";
import { Card, Empty, ErrorBox, NeedSync, PageHead, PlayerLabel, RankPill, TableWrap, TeamName, useLoad, Val } from "../ui";
import { PosterButton } from "../PosterButton";
import { draftPoster } from "../posters";

export const VALUE_NOTE = (
  <><b>Değer</b> = oyuncunun maç başı z-skoru eksi “yedek seviyesi” (en iyi 20 serbest oyuncunun ortalaması), oynadığı maçlarla çarpılır. 0 = serbest oyuncu havuzundan zaten bulunabilecek katkı.</>
);
const teamId = (p: { team: string | null; team_name?: string; name?: string }) => p.team || p.team_name || p.name || "";

export function Draft() {
  const { data: r, error } = useLoad(async () => {
    const d = await api<DraftReport>("/api/draft");
    if (d.available) registerPlayers(d.picks.map((p) => p.player));
    return d;
  });
  const [team, setTeam] = useState("");
  const picksRef = useRef<HTMLDivElement>(null);
  const brief = (p: DraftPick | null) => p ? <>{p.player.name} <span class="muted small">#{p.overall} · {signed(p.surplus, 1)}</span></> : "–";

  return (
    <section>
      <PageHead title="Draft" sub="Kim iyi draft yaptı? Her seçimin bugüne kadarki değeri.">
        {r?.available && <PosterButton name="draft-karnesi" make={() => draftPoster(r, team)} />}
      </PageHead>
      {error ? <ErrorBox msg={error} /> : !r ? <Empty>Yükleniyor…</Empty> : !r.available ? <NeedSync what="Draft" ver="0.5.0" /> : <>
        {!r.has_pool && <div class="warn">Serbest oyuncuların istatistikleri henüz okunmadı; bırakılmış draft seçimleri 0 değerle sayılıyor. Yeniden senkronize et.</div>}
        <Card title="En iyi draft">
          <TableWrap>
            <thead><tr><th>Takım</th><th>Toplam değer</th><th>Beklenene göre</th><th>Hâlâ kadroda</th><th class="l">En iyi seçim</th><th class="l">En kötü seçim</th></tr></thead>
            <tbody>
              {r.teams.map((t, i) => (
                <tr key={teamId(t)} class={`rowlink ${t.team === store.league.my_team ? "me" : ""}`}
                  onClick={() => { setTeam(teamId(t)); picksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  <td><RankPill n={i + 1} /> <TeamName team={t.team} name={t.name} /></td>
                  <td><Val x={t.total} /></td><td><Val x={t.surplus} /></td><td>{t.kept}/{t.picks}</td>
                  <td class="l">{brief(t.best)}</td><td class="l">{brief(t.worst)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p class="muted small note">{VALUE_NOTE} <b>Beklenene göre</b>: seçimin değeri eksi o draft sırasından beklenen değer (bu draftta seçilenlerin değerleri iyiden kötüye sıralanıp ±5 sıra üzerinden ortalanır; ligin toplamı sıfıra yakındır). Değer, oyuncu sonradan bırakılmış ya da takas edilmiş olsa bile onu seçen takıma yazılır. Satıra tıklayınca takımın seçimleri listelenir.</p>
        </Card>
        <div class="card" ref={picksRef}>
          <div class="card-head">
            <h3 style="margin:0">Seçimler</h3>
            <select value={team} onChange={(e) => setTeam(e.currentTarget.value)}>
              <option value="">Tüm takımlar (tur tur)</option>
              {r.teams.map((t) => <option value={teamId(t)} key={teamId(t)}>{t.name}</option>)}
            </select>
          </div>
          {team ? <TeamPicks picks={r.picks.filter((p) => teamId(p) === team)} />
            : rounds(r.picks).map((round) => (
              <div class="round" key={round}>
                <div class="round-head">
                  <h3>{round}. tur</h3>
                  <span class="muted small">{r.picks.filter((p) => p.round === round).length} seçim</span>
                </div>
                <TableWrap>
                  <thead><tr><th>Sıra</th><th class="l">Oyuncu</th><th class="l">Seçen</th><th>Maç</th><th>Değer</th><th>Değer sırası</th><th>Beklenene göre</th><th>Şimdi</th></tr></thead>
                  <tbody>{r.picks.filter((p) => p.round === round).map((p) => <RoundRow key={p.overall} p={p} />)}</tbody>
                </TableWrap>
              </div>
            ))}
        </div>
      </>}
    </section>
  );
}

const rounds = (picks: DraftPick[]) => [...new Set(picks.map((p) => p.round))].sort((a, b) => a - b);

/** Every pick of one team, one row per round. */
function TeamPicks({ picks }: { picks: DraftPick[] }) {
  return (
    <TableWrap>
      <thead><tr><th class="l">Tur</th><th class="l">Oyuncu</th><th>Maç</th><th>Değer</th><th>Değer sırası</th><th>Beklenene göre</th><th>Şimdi</th></tr></thead>
      <tbody>
        {picks.map((p) => (
          <tr key={p.overall}>
            <td>{p.round}. tur</td>
            <td class="l"><PlayerLabel k={p.player.key} /></td>
            <td>{p.gp || 0}</td>
            <td>{p.known ? <Val x={p.value} /> : <span class="faded">veri yok</span>}</td>
            <td>{p.rank ? p.rank + "." : "–"}</td><td><Val x={p.surplus} /></td>
            <td class={p.kept ? "" : "faded"}>{keptText(p)}</td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

/** One pick inside a round: its place in that round is the first column. */
function RoundRow({ p }: { p: DraftPick }) {
  return (
    <tr>
      <td>{p.pick}.</td>
      <td class="l"><PlayerLabel k={p.player.key} /></td>
      <td class="l"><TeamName team={p.team} name={p.team_name} plain /></td>
      <td>{p.gp || 0}</td>
      <td>{p.known ? <Val x={p.value} /> : <span class="faded">veri yok</span>}</td>
      <td>{p.rank ? p.rank + "." : "–"}</td><td><Val x={p.surplus} /></td>
      <td class={p.kept ? "" : "faded"}>{keptText(p)}</td>
    </tr>
  );
}

const keptText = (p: DraftPick) => (p.kept ? "kadroda" : p.player.owner ? store.teamName[p.player.owner] || "başka takım" : "serbest");
