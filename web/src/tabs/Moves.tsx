import { api, dayLong, registerPlayers, signed, store } from "../store";
import type { MovesReport, Pickup } from "../types";
import { Card, Empty, ErrorBox, NeedSync, PlayerLabel, RankPill, TableWrap, useLoad, Val } from "../ui";
import { VALUE_NOTE } from "./Draft";

export function Moves() {
  const { data: r, error } = useLoad(async () => {
    const d = await api<MovesReport>("/api/moves");
    if (d.available) {
      registerPlayers(d.pickups.map((x) => x.player));
      d.trades.forEach((t) => t.sides.forEach((s) => registerPlayers(s.players.map((x) => x.player))));
    }
    return d;
  });

  const head = <thead><tr><th>#</th><th class="l">Oyuncu</th><th class="l">Ekleyen</th><th>Tarih</th><th>Aktif maç</th><th>Değer</th><th>Değer / maç</th><th>Durum</th></tr></thead>;
  const row = (x: Pickup, i: number) => (
    <tr key={`${x.date}${x.team}${x.player.key}${i}`} class={x.team === store.league.my_team ? "me" : ""}>
      <td><RankPill n={i + 1} /></td><td class="l"><PlayerLabel k={x.player.key} /></td>
      <td class="l">{x.team_name}</td><td>{dayLong(x.date)}</td>
      <td>{x.active_games}{x.games > x.active_games && <span class="muted small"> (+{x.games - x.active_games} yedekte)</span>}</td>
      <td><Val x={x.value} /></td><td>{x.per_game == null ? "–" : signed(x.per_game)}</td>
      <td class={x.ongoing ? "" : "faded"}>{x.ongoing ? "kadroda" : x.last ? dayLong(x.last) + "'e kadar" : "hiç oynamadı"}</td>
    </tr>
  );

  return (
    <section>
      <h2 class="page-title">Transferler</h2>
      <p class="muted" style="margin:0 0 14px">Serbest oyuncu eklemeleri ve takaslar: kim en iyi hamleyi yaptı?</p>
      {error ? <ErrorBox msg={error} /> : !r ? <Empty>Yükleniyor…</Empty> : !r.available ? <NeedSync what="Transfer" ver="0.5.0" /> : <>
        <Card title="Takımların serbest oyuncu hamleleri">
          <TableWrap>
            <thead><tr><th>Takım</th><th>Ekleme</th><th>Toplam değer</th><th class="l">En iyi ekleme</th></tr></thead>
            <tbody>
              {r.teams.map((t, i) => (
                <tr key={t.team} class={t.team === store.league.my_team ? "me" : ""}>
                  <td><RankPill n={i + 1} /> <span class="pl-name">{t.name}</span></td>
                  <td>{t.adds}</td><td><Val x={t.value} /></td>
                  <td class="l">{t.best ? <>{t.best.player.name} <span class="muted small">{dayLong(t.best.date)} · {signed(t.best.value, 1)}</span></> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p class="muted small note">{r.count} işlem ({dayLong(r.first)} – {dayLong(r.last)}). {VALUE_NOTE} Yalnızca oyuncunun o takımda <b>aktif kadroda oynadığı</b> maçlar sayılır.</p>
        </Card>

        <Card title="En iyi eklemeler">
          <TableWrap>{head}<tbody>{r.pickups.slice(0, 15).map(row)}</tbody></TableWrap>
          {r.pickups.length > 15 && (
            <details>
              <summary>Kalan {r.pickups.length - 15} eklemeyi göster</summary>
              <TableWrap>{head}<tbody>{r.pickups.slice(15).map((x, i) => row(x, i + 15))}</tbody></TableWrap>
            </details>
          )}
        </Card>

        <Card title="Takaslar">
          {!r.trades.length ? <p class="muted">Bu sezon henüz takas yok.</p> : <>
            <TableWrap>
              <thead><tr><th>Tarih</th><th class="l">Taraf 1</th><th>Değer</th><th class="l">Taraf 2</th><th>Değer</th><th class="l">Şimdiye kadar önde</th></tr></thead>
              <tbody>
                {r.trades.map((t, i) => {
                  const [a, b] = t.sides;
                  const diff = a && b ? a.value - b.value : 0;
                  const side = (s: (typeof t.sides)[number] | undefined) => s ? <>
                    <td class="l" style="white-space:normal"><b>{s.name}</b> aldı:
                      {s.players.map((x) => <div key={x.player.key}>{x.player.name} <span class="muted small">{x.active_games} maç · {signed(x.value, 1)}</span></div>)}</td>
                    <td><Val x={s.value} /></td>
                  </> : <><td /><td /></>;
                  return (
                    <tr key={i}>
                      <td>{dayLong(t.date)}</td>{side(a)}{side(b)}
                      <td class="l">{a && b && Math.abs(diff) > 0.05 ? <><span class="pl-name">{a.name}</span> {signed(diff, 1)}</> : "başa baş"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            <p class="muted small note">Takastan sonra her oyuncunun yeni takımında aktif kadroda ürettiği değer.</p>
          </>}
        </Card>
      </>}
    </section>
  );
}
