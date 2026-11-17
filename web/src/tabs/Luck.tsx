import { api, num, store } from "../store";
import type { LuckReport } from "../types";
import { Card, ErrorBox, TableWrap, TeamName, useLoad } from "../ui";

const signedNum = (x: number, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + num(Math.abs(x), d);
const tone = (x: number, eps = 0.05) => (x > eps ? "pos" : x < -eps ? "neg" : "");

/** Who got lucky and who did not: the week's matchups and the season, measured against the
 *  league (what each team would have achieved against everyone). */
export function Luck({ week }: { week: number }) {
  const { data: r, error } = useLoad(() => api<LuckReport>("/api/luck"));
  if (error) return <Card title="Şans"><ErrorBox msg={error} /></Card>;
  if (!r) return null;
  const me = store.league.my_team;
  const rows = r.byWeek[week];
  const seasonRows = r.season;
  const luckiest = seasonRows[0], unluckiest = seasonRows[seasonRows.length - 1];
  const wk = rows ? [...rows] : null;   // already sorted: luckiest first

  return (
    <Card title="Şans: sonuçlar ne kadar adildi?">
      <p class="muted small" style="margin:-4px 0 10px">
        Her maç için: gerçek sonuç (galibiyet 1, beraberlik 0,5, mağlubiyet 0) eksi o hafta ligdeki takımların yüzde kaçını yenmiş olacağın.
        <b> +</b> değeri şanslı, <b>−</b> değeri şanssız demek: rakibin kadrosu sana denk düştü ya da düşmedi.
      </p>
      <div class="luck-grid">
        <div>
          <div class="label">Sezon</div>
          <p style="margin:6px 0 10px">
            En şanslı: <b><TeamName team={luckiest.team} /></b> <span class="pos">{signedNum(luckiest.luck)}</span><br />
            En şanssız: <b><TeamName team={unluckiest.team} /></b> <span class="neg">{signedNum(unluckiest.luck)}</span>
          </p>
          <TableWrap>
            <thead><tr><th>#</th><th class="l">Takım</th><th>Rekor</th><th>Şans</th></tr></thead>
            <tbody>
              {seasonRows.map((t, i) => (
                <tr key={t.team} class={t.team === me ? "me" : ""}>
                  <td>{i + 1}</td>
                  <td class="l"><TeamName team={t.team} /></td>
                  <td>{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ""}</td>
                  <td><b class={tone(t.luck)}>{signedNum(t.luck)}</b></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
        <div>
          <div class="label">{week}. hafta</div>
          {!wk ? <p class="muted" style="margin:6px 0">Bu hafta henüz tamamlanmadı; şans, hafta bitince hesaplanır.</p> : <>
            <p style="margin:6px 0 10px">
              En şanslı: <b><TeamName team={wk[0].team} /></b> <span class="pos">{signedNum(wk[0].luck)}</span><br />
              En şanssız: <b><TeamName team={wk[wk.length - 1].team} /></b> <span class="neg">{signedNum(wk[wk.length - 1].luck)}</span>
            </p>
            <TableWrap>
              <thead><tr><th class="l">Takım</th><th>Sonuç</th><th>Yendiği takım</th><th>Şans</th></tr></thead>
              <tbody>
                {wk.map((t) => (
                  <tr key={t.team} class={t.team === me ? "me" : ""}>
                    <td class="l"><TeamName team={t.team} /></td>
                    <td class={t.result === "W" ? "tag-w" : t.result === "L" ? "tag-l" : ""}>{t.result === "W" ? "Galibiyet" : t.result === "L" ? "Mağlubiyet" : "Beraberlik"}</td>
                    <td>{t.beaten}/{t.of}</td>
                    <td><b class={tone(t.luck, 0.01)}>{signedNum(t.luck, 2)}</b></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>}
        </div>
      </div>
    </Card>
  );
}
