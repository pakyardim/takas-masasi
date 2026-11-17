import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { api, catByKey, dayLong, fmt, num, rec, store } from "../store";
import type { Standings as StandingsData, StandingsTeam } from "../types";
import { PosterButton } from "../PosterButton";
import { standingsPoster } from "../posters";
import { Card, Empty, ErrorBox, PageHead, RankPill, TableWrap, TeamName, useLoad } from "../ui";

type SortKey = "h2h" | "one_win" | "roto" | "points";
const RANK: Record<SortKey, (t: StandingsTeam) => number> = {
  h2h: (t) => t.h2h.rank, one_win: (t) => t.one_win.rank, roto: (t) => t.roto.rank, points: (t) => t.points.rank,
};
const LABEL: Record<SortKey, string> = {
  h2h: "H2H Kategori (gerçek)", one_win: "H2H Tek Galibiyet", roto: "Rotisserie", points: "Puan ligi",
};

/** How many places better (▲) or worse (▼) than in the league's real format. */
function Delta({ rank, base }: { rank: number; base: number }) {
  const d = base - rank;
  return d > 0 ? <span class="delta pos">▲{d}</span> : d < 0 ? <span class="delta neg">▼{-d}</span> : null;
}

export function Standings() {
  const { data: r, error } = useLoad(() => api<StandingsData>("/api/standings"));
  const [sort, setSort] = useState<SortKey>("h2h");
  const me = store.league.my_team;
  if (error) return <Shell><ErrorBox msg={error} /></Shell>;
  if (!r) return <Shell><Empty>Yükleniyor…</Empty></Shell>;
  if (!r.available) return <Shell><Empty>Bu görünüm yalnızca senkronize edilmiş kategori liglerinde çalışır.</Empty></Shell>;

  const teams = [...r.teams].sort((a, b) => RANK[sort](a) - RANK[sort](b) || a.h2h.rank - b.h2h.rank);
  const cats = store.league.categories;
  const shade = (p: number) => `rgba(0, 99, 235, ${(0.04 + (0.26 * (p - 1)) / Math.max(1, r.n - 1)).toFixed(3)})`;
  const pv = Object.entries(r.point_values).map(([k, v]) => `${catByKey(k)?.label || k} ${v > 0 ? "+" : ""}${v}`).join(", ");

  return (
    <Shell action={<PosterButton name="puan-durumu" make={() => standingsPoster(r, teams)} />}>
      <Card title="Dört formatta sıralama">
        <TableWrap>
          <thead>
            <tr>
              <th class="l">Takım</th>
              {(Object.keys(LABEL) as SortKey[]).map((k) => (
                <th key={k} class={`sortable ${sort === k ? "sorted" : ""}`} onClick={() => setSort(k)}>{LABEL[k]}{sort === k ? " ▾" : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.team} class={t.team === me ? "me" : ""}>
                <td class="l"><TeamName team={t.team} /></td>
                <td><RankPill n={t.h2h.rank} /> {rec(t.h2h.record)}</td>
                <td><RankPill n={t.one_win.rank} /> {rec(t.one_win.record)}<Delta rank={t.one_win.rank} base={t.h2h.rank} /></td>
                <td><RankPill n={t.roto.rank} /> {num(t.roto.points, 1)} p<Delta rank={t.roto.rank} base={t.h2h.rank} /></td>
                <td><RankPill n={t.points.rank} /> {num(t.points.total)}<Delta rank={t.points.rank} base={t.h2h.rank} /> <span class="muted small">({rec(t.points.record)})</span></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p class="muted small note">Başlığa tıklayarak o formata göre sırala. ▲▼: gerçek formata (H2H Kategori) göre kaç sıra yukarıda ya da aşağıda. Maç rekorları tamamlanmış {r.weeks_done.length} haftadan; sezon toplamları (rotisserie, puan) {dayLong(r.last_day)} gününe kadar.</p>
      </Card>

      <Card title="Rotisserie ayrıntısı">
        <TableWrap>
          <thead><tr><th>#</th><th class="l">Takım</th>{cats.map((c) => <th key={c.key}>{c.label}</th>)}<th>Toplam</th></tr></thead>
          <tbody>
            {[...r.teams].sort((a, b) => a.roto.rank - b.roto.rank).map((t) => (
              <tr key={t.team} class={t.team === me ? "me" : ""}>
                <td><RankPill n={t.roto.rank} /></td><td class="l"><TeamName team={t.team} /></td>
                {cats.map((c) => {
                  const x = t.roto.cats[c.key];
                  return <td key={c.key} class="heat" style={{ background: shade(x.points) }}>{num(x.points, x.points % 1 ? 1 : 0)}<small>{fmt(c.key, x.value, "total")}</small></td>;
                })}
                <td><b>{num(t.roto.points, 1)}</b></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p class="muted small note">Büyük sayı: o kategoriden alınan puan ({r.n} = ligin en iyisi, 1 = en kötüsü; eşitlikte puan paylaşılır). Küçük sayı: sezon toplamı. Koyu mavi = daha çok puan.</p>
      </Card>

      <Card title="Formatlar">
        <p class="muted small" style="margin:0">
          <b>H2H Kategori (ligin gerçek formatı):</b> her hafta rakibinle her kategori ayrı bir maç sayılır; haftada {cats.length} galibiyet/mağlubiyet dağıtılır.<br />
          <b>H2H Tek Galibiyet:</b> hafta tek maç sayılır; daha çok kategori kazanan haftayı alır.<br />
          <b>Rotisserie:</b> haftalık eşleşme yok. Sezon boyu biriken istatistiklerle her kategoride tüm lig sıralanır; {r.n} takımlı ligde birinci {r.n}, sonuncu 1 puan alır ve {cats.length} kategorinin puanları toplanır. Yani bütün sezon boyunca tüm ligle kapışırsın.<br />
          <b>Puan ligi:</b> kategori yok; her istatistik puana çevrilir (Yahoo varsayılanı: {pv}). Sıralama toplam puana göre; parantez içi haftalık H2H puan rekoru.<br />
          Not: istatistikler ligin gerçekte oynandığı dizilişlerden gelir. Başka bir formatta menajerler farklı kadro kurar ve farklı oynatırdı; Yahoo'nun rotisserie'deki pozisyon başına maç sınırı da uygulanmadı.
        </p>
      </Card>
    </Shell>
  );
}

function Shell({ children, action }: { children: ComponentChildren; action?: ComponentChildren }) {
  return (
    <section>
      <PageHead title="Puan Durumu" sub="Aynı sezon, başka lig formatlarında nasıl görünürdü?">{action}</PageHead>
      {children}
    </section>
  );
}
