import { api, pct, rec, signed, store } from "../store";
import type { Power as PowerData, PowerTeam } from "../types";
import { PosterButton } from "../PosterButton";
import { powerPoster } from "../posters";
import { Card, Empty, ErrorBox, NeedSync, PageHead, RankPill, TableWrap, TeamName, useLoad } from "../ui";

function Trend({ t }: { t: PowerTeam }) {
  if (t.prev_rank == null || t.prev_rank === t.rank) return <span class="muted">·</span>;
  const d = t.prev_rank - t.rank;
  return d > 0 ? <span class="arrow-up">▲{d}</span> : <span class="arrow-down">▼{-d}</span>;
}

export function Power() {
  const { data: r, error } = useLoad(() => api<PowerData>("/api/power"));
  return (
    <section>
      <PageHead title="Güç Sıralaması" sub="Fikstür şansından arındırılmış performans, son form ve bugünkü kadro gücü.">
        {r?.available && <PosterButton name="guc-siralamasi" make={() => powerPoster(r)} />}
      </PageHead>
      {error ? <ErrorBox msg={error} /> : !r ? <Empty>Yükleniyor…</Empty> : !r.available ? <NeedSync what="Güç sıralaması" ver="0.6.0" /> : <>
        <Card>
          <TableWrap>
            <thead><tr><th>#</th><th class="l">Takım</th><th>Güç</th><th>Herkese karşı</th><th>Form</th><th>Kadro gücü</th><th>Gerçek rekor</th><th>Şans</th><th>Yeneceği rakip</th></tr></thead>
            <tbody>
              {r.teams.map((t) => (
                <tr key={t.team} class={t.team === store.league.my_team ? "me" : ""}>
                  <td><RankPill n={t.rank} /> <Trend t={t} /></td>
                  <td class="l"><TeamName team={t.team} /></td>
                  <td><span class="power-score">{t.power.toFixed(1)}</span><span class="power-bar" style={{ width: `${Math.max(4, t.power)}%` }} /></td>
                  <td>{rec(t.allplay)} <span class="muted small">{pct(t.allplay_pct)}</span></td>
                  <td>{pct(t.form_pct)}</td>
                  <td>{signed(t.roster, 1)}</td>
                  <td>{rec(t.record)} <span class="muted small">{t.standing}.</span></td>
                  <td><b class={t.luck > 0.03 ? "pos" : t.luck < -0.03 ? "neg" : ""}>{t.luck > 0 ? "+" : ""}{Math.round(t.luck * 100)}</b></td>
                  <td>{t.beat}/{t.beat_of}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p class="muted small note">{r.weeks.length} tamamlanmış hafta üzerinden ({r.weeks[0]}–{r.weeks[r.weeks.length - 1]}. hafta); devam eden hafta dahil değil. ▲▼: bir önceki haftaya göre değişim.</p>
        </Card>
        <Card title="Sütunlar">
          <p class="muted small" style="margin:0">
            <b>Güç (0–100)</b> = %{r.weights.allplay * 100} herkese karşı + %{r.weights.form * 100} form + %{r.weights.roster * 100} kadro gücü.<br />
            <b>Herkese karşı:</b> her hafta ligdeki diğer takımların hepsiyle oynasaydın kazanacağın kategori oranı; fikstür şansını siler.<br />
            <b>Form:</b> aynı oran, yalnızca son 2 tamamlanmış hafta.<br />
            <b>Kadro gücü:</b> bugün oynayabilecek en iyi 10 oyuncunun sezon z-skoru toplamı (IL ve “O” hariç).<br />
            <b>Şans:</b> gerçek kategori kazanma oranı eksi herkese karşı oran (yüzde puan). Artı: fikstür sana yaradı; eksi: güçlü haftalarında güçlü rakibe denk geldin.<br />
            <b>Yeneceği rakip:</b> tüm haftalarda, herkese karşı oynansa kazanılacak eşleşme sayısı.
          </p>
        </Card>
      </>}
    </section>
  );
}
