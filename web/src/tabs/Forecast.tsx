import { api, catByKey, dayLong, fmt, pct, store } from "../store";
import type { Forecast as ForecastData, ForecastMatchup } from "../types";
import { Card, Empty, ErrorBox, NeedSync, TableWrap, useLoad } from "../ui";

export function Forecast() {
  const { data: r, error } = useLoad(() => api<ForecastData>("/api/forecast"));
  const me = store.league.my_team;
  const mine = (m: ForecastMatchup) => m.a === me || m.b === me;
  return (
    <section>
      <h2 class="page-title">Tahmin</h2>
      <p class="muted" style="margin:0 0 14px">Bu hafta ve gelecek hafta kim kaç kaç kazanır? Kalan maçlar binlerce kez simüle edilir.</p>
      {error ? <ErrorBox msg={error} /> : !r ? <Empty>Simülasyon çalışıyor…</Empty> : !r.available ? <NeedSync what="Tahmin" ver="0.6.0" /> : <>
        {r.weeks.map((w) => (
          <div key={w.week}>
            <div class="week-head">
              <h3>{w.week}. hafta</h3>
              <span class="muted">{dayLong(w.start)} – {dayLong(w.end)} · {w.days_played ? `devam ediyor · ${w.days_played} gün oynandı, ${w.days_left} gün kaldı` : "henüz başlamadı"}</span>
            </div>
            {w.uncovered_dates.length > 0 && <div class="warn">Bu haftanın {w.uncovered_dates.length} günü için fikstür verisi yok; o günlerin maçları tahmine katılmadı. Yeniden senkronize et.</div>}
            <div class="fc-grid" style="margin-bottom:22px">
              {[...w.matchups].sort((x, y) => +mine(y) - +mine(x)).map((m) => <MatchCard m={m} mine={mine(m)} key={m.a + m.b} />)}
            </div>
          </div>
        ))}
        <Card title="Nasıl hesaplanıyor?">
          <p class="muted small" style="margin:0">Haftanın oynanmış günleri gerçek istatistiklerle sayılır. Kalan her gün için takımın o gün maçı olan en iyi {r.active_slots} oyuncusu oynatılır (IL'deki ve “O” durumundaki oyuncular hariç; pozisyon uygunluğuna bakılmaz).
            Her maç için oyuncunun son 15 maçından rastgele bir gerçek kutu skoru çekilir ve hafta {r.sims.toLocaleString("tr-TR")} kez simüle edilir. Büyük skor: favorinin kazandığı simülasyonlardaki en sık sonuç. Yüzdeler: eşleşmeyi kazanma olasılığı.
            * işaretli oyuncuların 3'ten az maçı var, sezon ortalamaları kullanılır. Kadro değişiklikleri, yeni sakatlıklar ve dinlendirmeler öngörülemez.</p>
        </Card>
      </>}
    </section>
  );
}

function MatchCard({ m, mine }: { m: ForecastMatchup; mine: boolean }) {
  const fa = m.favorite === "a";
  const side = (s: "a" | "b", name: string) => (
    <p class="muted small note">
      <b>{name}</b> kalan maçlar: {m.players[s].length
        ? m.players[s].map((p, i) => <span key={p.player}>{i ? " · " : ""}{p.name} <b>{p.games}</b>{p.few_games ? "*" : ""}</span>) : "–"}
      <br />Oynamıyor sayılan: {m.out[s].length
        ? m.out[s].map((p, i) => <span key={p.name}>{i ? " · " : ""}{p.name} <span class="inj">{p.status}</span></span>) : "yok"}
    </p>
  );
  return (
    <div class={`fc-card ${mine ? "mine" : ""}`}>
      <div class="sb-row">
        <div class={`sb-team ${fa ? "fav" : ""}`}>{m.a_name}</div><div class="sb-score">{m.score.W}</div>
        <div class="sb-vs">vs</div>
        <div class="sb-score">{m.score.L}</div><div class={`sb-team ${fa ? "" : "fav"}`}>{m.b_name}</div>
      </div>
      <div class="prob">
        <span class="pa" style={{ width: `${m.p_a * 100}%` }} /><span class="pt" style={{ width: `${m.p_tie * 100}%` }} /><span class="pb" style={{ width: `${m.p_b * 100}%` }} />
      </div>
      <div class="prob-labels">
        <span style="color:var(--a)">{pct(m.p_a)}</span>
        <span class="muted">{m.p_tie >= 0.005 ? "berabere " + pct(m.p_tie) : ""}</span>
        <span style="color:var(--b)">{pct(m.p_b)}</span>
      </div>
      <details>
        <summary>Kategoriler ve kadro</summary>
        <TableWrap>
          <thead><tr><th>Kategori</th><th>{m.a_name}</th><th>{m.b_name}</th><th style="text-align:left">{m.a_name} kazanır</th></tr></thead>
          <tbody>
            {m.categories.map((c) => (
              <tr key={c.key}>
                <td><b>{catByKey(c.key)?.label ?? c.key}</b></td>
                <td class={c.result === "W" ? "win" : ""}>{fmt(c.key, c.a, "total")}</td>
                <td class={c.result === "L" ? "win" : ""}>{fmt(c.key, c.b, "total")}</td>
                <td style="text-align:left"><span class="pbar"><i style={{ width: `${Math.round(c.p_a * 100)}%` }} /></span>{pct(c.p_a)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {side("a", m.a_name)}{side("b", m.b_name)}
      </details>
      <div class="fc-foot">
        <span>{m.now ? <>Şu an: <b>{m.now.score.W}-{m.now.score.L}{m.now.score.T ? "-" + m.now.score.T : ""}</b></> : "Henüz başlamadı"}</span>
        <span>Ortalama: {m.exp_a.toFixed(1)} – {m.exp_b.toFixed(1)} kategori</span>
        <span>Kalan maç: {m.games_left.a} – {m.games_left.b}</span>
      </div>
    </div>
  );
}
