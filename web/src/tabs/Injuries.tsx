import { api, num, registerPlayers, store } from "../store";
import type { InjuryCell, InjuryReport } from "../types";
import { Card, Empty, ErrorBox, PageHead, PlayerLabel, PlayerName, TableWrap, TeamName, useLoad } from "../ui";
import { PosterButton } from "../PosterButton";
import { injuriesPoster } from "../posters";

const signedNum = (x: number, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + num(Math.abs(x), d);
const dayShort = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

export function Injuries() {
  const { data: r, error } = useLoad(async () => {
    const d = await api<InjuryReport>("/api/injuries");
    // players who are no longer on any roster are not in the league list: register their names here
    if (d.available) registerPlayers(d.players.map((p) => ({ key: p.key, name: p.name, nba_team: p.nba_team, positions: p.positions, status: p.status, owner: p.team })));
    return d;
  });
  const me = store.league.my_team;
  return (
    <section>
      <PageHead title="Sakatlıklar" sub="Kim kimi vurdu? Hafta hafta sakat oyuncular, kaçırılan maçlar ve kaybedilen üretim.">
        {r?.available && <PosterButton name="sakatliklar" make={() => injuriesPoster(r)} />}
      </PageHead>
      {error ? <ErrorBox msg={error} /> : !r ? <Empty>Yükleniyor…</Empty> : !r.available ? <Empty>Henüz günlük veri yok. Eklentiyle senkronize et.</Empty> : <Body r={r} me={me} />}
    </section>
  );
}

function Body({ r, me }: { r: InjuryReport; me: string }) {
  const totalMissed = r.teams.reduce((a, t) => a + t.missed, 0);
  const worstTeam = r.teams[0];
  const worstPlayer = r.players[0];
  const byMissed = [...r.players].sort((a, b) => b.missed - a.missed).slice(0, 25);
  const byLost = [...r.players].sort((a, b) => b.lost - a.lost).slice(0, 25);
  const cell = (c?: InjuryCell) => (c && (c.il || c.missed) ? c : null);
  const heat = (m: number, max: number) => (m ? `rgba(211, 13, 47, ${(0.08 + 0.4 * Math.min(1, m / Math.max(1, max))).toFixed(3)})` : undefined);
  const maxWeekMissed = Math.max(1, ...r.teams.flatMap((t) => Object.values(t.byWeek).map((c) => c.missed)));

  return (
    <>
      <div class="summary">
        <div class="stat-card"><div class="k">En çok kayıp yaşayan takım</div><div class="v" style="font-size:20px"><TeamName team={worstTeam.team} /></div><div class="muted small">{signedNum(worstTeam.lost)} değer · {worstTeam.missed} kaçırılan maç</div></div>
        <div class="stat-card"><div class="k">En çok maç kaçıran oyuncu</div><div class="v" style="font-size:20px">{worstPlayer ? <PlayerName k={worstPlayer.key} name={worstPlayer.name} /> : "–"}</div><div class="muted small">{worstPlayer ? `${worstPlayer.missed} maç · ${signedNum(worstPlayer.lost)} değer` : ""}</div></div>
        <div class="stat-card"><div class="k">Toplam kaçırılan maç</div><div class="v">{totalMissed}</div><div class="muted small">{r.days_covered} gün, {dayShort(r.first_day!)} – {dayShort(r.last_day!)}</div></div>
      </div>

      <Card title="Takımlar">
        <TableWrap>
          <thead><tr><th class="l">Takım</th><th>IL gün</th><th>Kaçırılan maç</th><th>Kaybedilen değer</th></tr></thead>
          <tbody>
            {r.teams.map((t) => (
              <tr key={t.team} class={t.team === me ? "me" : ""}>
                <td class="l"><TeamName team={t.team} /></td>
                <td>{t.il}</td><td>{t.missed}</td>
                <td><b class={t.lost > 0.05 ? "neg" : t.lost < -0.05 ? "pos" : ""}>{signedNum(t.lost)}</b></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Hafta hafta: kaçırılan maç">
        <p class="muted small" style="margin:-4px 0 10px">Her hücrede o hafta kaçırılan maç sayısı; koyulaştıkça çok. Hafta ne kadar "sakat" geçtiyse o satır o kadar koyu.</p>
        <TableWrap>
          <thead><tr><th class="l">Takım</th>{r.weeks.map((w) => <th key={w}>{w}. hf</th>)}</tr></thead>
          <tbody>
            {r.teams.map((t) => (
              <tr key={t.team} class={t.team === me ? "me" : ""}>
                <td class="l"><TeamName team={t.team} /></td>
                {r.weeks.map((w) => {
                  const c = cell(t.byWeek[w]);
                  return <td key={w} style={{ background: heat(c?.missed ?? 0, maxWeekMissed) }}>{c ? c.missed : "·"}{c && c.il ? <span class="muted small"> ({c.il} IL)</span> : null}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Oyuncular: en çok maç kaçıranlar">
        <TableWrap>
          <thead><tr><th class="l">Oyuncu</th><th class="l">Takım</th><th>IL gün</th><th>Kaçırılan maç</th><th>Kaybedilen değer</th><th>Şu an</th></tr></thead>
          <tbody>
            {byMissed.map((p) => (
              <tr key={p.key}>
                <td class="l"><PlayerLabel k={p.key} /></td>
                <td class="l">{p.team ? <TeamName team={p.team} plain /> : "–"}</td>
                <td>{p.il || "–"}</td><td><b>{p.missed}</b></td>
                <td><b class={p.lost > 0.05 ? "neg" : p.lost < -0.05 ? "pos" : ""}>{signedNum(p.lost)}</b></td>
                <td class={p.status ? "neg" : "muted"}>{p.status || "sağlıklı"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Oyuncular: en çok değer kaybettirenler">
        <TableWrap>
          <thead><tr><th class="l">Oyuncu</th><th class="l">Takım</th><th>Kaçırılan maç</th><th>Kaybedilen değer</th></tr></thead>
          <tbody>
            {byLost.map((p) => (
              <tr key={p.key}>
                <td class="l"><PlayerLabel k={p.key} /></td>
                <td class="l">{p.team ? <TeamName team={p.team} plain /> : "–"}</td>
                <td>{p.missed}</td>
                <td><b class={p.lost > 0.05 ? "neg" : p.lost < -0.05 ? "pos" : ""}>{signedNum(p.lost)}</b></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p class="muted small note">
          <b>Nasıl hesaplanıyor?</b> IL gün: oyuncu günlük kadroda IL (sakat listesi) yuvasındaydı. Kaçırılan maç: aktif kadroda olduğu, NBA takımının o gün maçı olduğu ama kutu skoru olmadığı günler.
          Bu, sakatlık dışındaki dinlenmeleri de içerir; yani üst sınırdır. Kaybedilen değer: kaçırılan maçların değeri (oyuncunun maç başı değeri eksi yedek seviyesi).
          Negatif değer, oyuncunun yerine koyulacak serbest oyuncudan zayıf olduğunu gösterir.
          Gün bazında sakatlık durumu senkronda saklanmadığı için yalnızca "Şu an" sütunu güncel durumu verir.
        </p>
      </Card>
    </>
  );
}
