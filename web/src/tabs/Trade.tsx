import { useEffect, useRef, useState } from "preact/hooks";
import { drawTradePoster, loadLogos } from "../share";
import { makeShare, ShareModal, type Share } from "../ShareModal";
import { api, catByKey, cats, cls, fmt, pname, registerPlayers, signed, store } from "../store";
import type { Balance, Category, Res, TradeCat, TradeFix, TradeResult } from "../types";
import { Card, Empty, ErrorBox, PlayerLabel, SideTag, TableWrap, TeamLogo, TeamOptions } from "../ui";

type Side = "a" | "b";
const netCls = (r: Res) => (r === "W" ? "pos" : r === "L" ? "neg" : "");

export function Trade() {
  const lg = store.league;
  const mark = { [lg.my_team]: " (sen)" };
  const [teamA, setTeamA] = useState(lg.my_team);
  const [teamB, setTeamB] = useState(lg.teams.find((t) => t.key !== lg.my_team)!.key);
  const [selA, setSelA] = useState<string[]>([]);
  const [selB, setSelB] = useState<string[]>([]);
  const [period, setPeriod] = useState("season");
  const [fix, setFix] = useState<TradeFix | null>(null);     // manual drop/add choices
  const [res, setRes] = useState<TradeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!selA.length && !selB.length) { setRes(null); setErr(null); return; }
    const mine = ++seq.current;
    setBusy(true);
    api<TradeResult>("/api/trade", { team_a: teamA, give_a: selA, team_b: teamB, give_b: selB, period, ...(fix || {}) })
      .then((r) => { if (mine === seq.current) { registerPlayers(r.info); setRes(r); setErr(null); } })
      .catch((e) => { if (mine === seq.current) setErr(e.message); })
      .finally(() => { if (mine === seq.current) setBusy(false); });
  }, [teamA, teamB, selA, selB, period, fix]);

  const toggle = (side: Side, k: string) => {
    const [sel, set] = side === "a" ? [selA, setSelA] : [selB, setSelB];
    set(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
    setFix(null);                      // packages changed: let the app suggest drops/adds again
  };
  const roster = (side: Side, team: string, sel: string[]) => (
    <div class="roster">
      {store.rosters[team].map((k) => (
        <div class={`prow ${sel.includes(k) ? "sel" : ""}`} key={k} onClick={() => toggle(side, k)}>
          <input type="checkbox" checked={sel.includes(k)} tabIndex={-1} readOnly />
          <div><PlayerLabel k={k} /></div>
        </div>
      ))}
    </div>
  );

  return (
    <section>
      <h2 class="page-title">Takas Analizi</h2>
      <p class="muted" style="margin:0 0 14px">Oyunculara tıklayarak iki tarafın paketini oluştur. Sonuç otomatik hesaplanır.</p>
      <div class="toolbar">
        <label>İstatistik dönemi
          <select value={period} onChange={(e) => setPeriod(e.currentTarget.value)}>
            <option value="season">Sezon ortalaması</option>
            <option value="last30">Son 30 gün</option>
            <option value="last14">Son 14 gün</option>
            <option value="last7">Son 7 gün</option>
          </select>
        </label>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-head">
            <SideTag side="a" /><TeamLogo team={teamA} size={30} />
            <select class="team-select" value={teamA} onChange={(e) => { setTeamA(e.currentTarget.value); setSelA([]); setFix(null); }}><TeamOptions mark={mark} /></select>
            <span class="muted small">verir</span>
          </div>
          {roster("a", teamA, selA)}
        </div>
        <div class="card">
          <div class="card-head">
            <SideTag side="b" /><TeamLogo team={teamB} size={30} />
            <select class="team-select" value={teamB} onChange={(e) => { setTeamB(e.currentTarget.value); setSelB([]); setFix(null); }}><TeamOptions mark={mark} /></select>
            <span class="muted small">verir</span>
          </div>
          {roster("b", teamB, selB)}
        </div>
      </div>
      <div style={{ opacity: busy ? 0.5 : 1 }}>
        {err ? <ErrorBox msg={err} />
          : res ? <TradeView r={res} selA={selA} selB={selB} period={period} onFix={setFix} />
          : <Empty>Her iki taraftan oyuncu seç: paketler kategori kategori karşılaştırılacak.</Empty>}
      </div>
    </section>
  );
}

const PERIODS: Record<string, string> = { season: "Sezon ortalaması", last30: "Son 30 gün", last14: "Son 14 gün", last7: "Son 7 gün" };

function TradeView({ r, selA, selB, period, onFix }: { r: TradeResult; selA: string[]; selB: string[]; period: string; onFix: (f: TradeFix) => void }) {
  const [share, setShare] = useState<Share | null>(null);
  const [sharing, setSharing] = useState(false);
  const openShare = async () => {
    setSharing(true);
    try {
      const logos = await loadLogos([r.teams.a, r.teams.b]);
      // only players that are part of this result (the selection may already have changed)
      const give = (sel: string[]) => sel.filter((k) => r.players[k]);
      const canvas = drawTradePoster(r, give(selA), give(selB), PERIODS[period] ?? period, logos);
      setShare(await makeShare(canvas, `takas-${store.teamName[r.teams.a]}-${store.teamName[r.teams.b]}`));
    } catch (e) {
      alert("Görsel oluşturulamadı: " + (e as Error).message);
    } finally {
      setSharing(false);
    }
  };
  const A = store.teamName[r.teams.a], B = store.teamName[r.teams.b];
  const isPts = r.scoring === "points";
  const d = isPts ? 1 : 2;
  const metric = isPts ? "FPTS/maç" : "toplam z-skor";
  const bal = r.balance, mv = r.moves;
  const uneven = !!(bal.a.need_drop || bal.a.room || bal.b.need_drop || bal.b.room);
  const vtxt = (v: number | null) => (v === null || v === undefined ? "veri yok" : signed(v, d));
  const netFmt = (c: TradeCat, v: number | null) => (v === null || v === undefined ? "–" : catByKey(c.key)?.ratio ? signed(v, 3) : signed(v, 1));

  const pick = (side: Side, kind: "drops" | "adds", i: number, value: string) => {
    const f: TradeFix = { drops_a: [...bal.a.drops], drops_b: [...bal.b.drops], adds_a: [...bal.a.adds], adds_b: [...bal.b.adds] };
    const key = `${kind}_${side}` as keyof TradeFix;
    f[key][i] = value;
    (Object.keys(f) as (keyof TradeFix)[]).forEach((k) => { f[k] = [...new Set(f[k].filter(Boolean))]; });
    onFix(f);
  };

  const sideBalance = (side: Side, name: string, gives: number, gets: number) => {
    const b: Balance = bal[side];
    if (!b.need_drop && !b.room) return null;
    return (
      <div class="bal-side">
        <div><SideTag side={side} mini /><b>{name}</b> {gives} oyuncu veriyor, {gets} oyuncu alıyor.</div>
        {b.need_drop > 0 && <>
          <div class="muted small" style="margin:4px 0 6px">Kadro {bal.capacity} kişilik (IL hariç): yer açmak için <b>{b.need_drop} oyuncu bırakmalı</b>. Öneri: dönemdeki en düşük değerli oyuncular. Değiştirebilirsin.</div>
          {b.drops.map((k, i) => (
            <label key={i}>Bırakılacak {i + 1}
              <select value={k} onChange={(e) => pick(side, "drops", i, e.currentTarget.value)}>
                {b.drop_options.map((o) => <option value={o.key} key={o.key}>{pname(o.key)} ({vtxt(o.value)})</option>)}
              </select>
            </label>
          ))}
        </>}
        {b.room > 0 && <>
          <div class="muted small" style="margin:4px 0 6px"><b>{b.room} kadro yeri açılıyor</b>: serbest oyunculardan doldurulabilir. Öneri: en değerli serbest oyuncular (sezon ortalamasıyla).</div>
          {!bal.has_free_agents
            ? <div class="muted small">Serbest oyuncu verisi yok; yerler boş sayıldı. Eklentiyle senkronize edince dolar.</div>
            : Array.from({ length: b.room }, (_, i) => (
              <label key={i}>Eklenecek {i + 1}
                <select value={b.adds[i] ?? ""} onChange={(e) => pick(side, "adds", i, e.currentTarget.value)}>
                  <option value="">— boş bırak —</option>
                  {b.add_options.map((o) => <option value={o.key} key={o.key}>{pname(o.key)} ({vtxt(o.value)})</option>)}
                </select>
              </label>
            ))}
        </>}
      </div>
    );
  };

  const better = (x: number | null, y: number | null, higher: boolean) => (x == null || y == null || x === y ? 0 : (x > y) === higher ? 1 : -1);
  const tally = (key: "better_for_a" | "better_for_b") =>
    `${r.categories.filter((c) => c[key] === "W").length} kategori iyileşir, ${r.categories.filter((c) => c[key] === "L").length} kötüleşir`;

  const cs: Category[] = cats();
  const playerRows = (keys: string[], side: Side, role: { cls: string; text: string }) => keys.filter((k) => r.players[k]).map((k) => {
    const p = r.players[k], avg = p.avg;
    return (
      <tr key={`${side}${role.text}${k}`}>
        <td><div style="display:flex;align-items:center;gap:6px"><SideTag side={side} mini /><div><PlayerLabel k={k} /></div></div></td>
        <td class="l"><span class={`role ${role.cls}`}>{role.text}</span></td>
        <td>{avg.GP ?? "–"}</td>
        {isPts ? <td>{(p.fpts ?? 0).toFixed(1)}</td> : <>
          {cs.map((c) => {
            const z = p.z![c.key];
            const v = c.ratio ? (avg[c.ratio[1]] ? avg[c.ratio[0]] / avg[c.ratio[1]] : null) : avg[c.key];
            return <td key={c.key} title={`z: ${z.toFixed(2)}`} class={z > 1 ? "pos" : z < -1 ? "neg" : ""}>{fmt(c.key, v)}</td>;
          })}
          <td><b class={cls(p.z!.TOTAL)}>{signed(p.z!.TOTAL)}</b></td>
        </>}
      </tr>
    );
  });
  const R = { give: { cls: "", text: "verir" }, drop: { cls: "neg", text: "bırakır" }, add: { cls: "pos", text: "ekler" } };

  const impactCard = (team: string, side: Side) => (
    <div class="card">
      <div class="card-head"><SideTag side={side} /><TeamLogo team={team} size={28} /><h3 style="margin:0">{store.teamName[team]}: takas sonrası</h3></div>
      <TableWrap>
        <thead><tr><th>Kategori</th><th>Önce</th><th>Sonra</th><th>Lig sırası ({r.league_size} takım)</th></tr></thead>
        <tbody>
          {r.team_impact[team].map((x) => {
            const dr = x.rank_before - x.rank_after;
            return (
              <tr key={x.key}>
                <td><b>{x.label}</b></td><td>{fmt(x.key, x.before)}</td><td>{fmt(x.key, x.after)}</td>
                <td>{x.rank_before}. → <b>{x.rank_after}.</b>{" "}
                  {dr > 0 ? <span class="arrow-up">▲{dr}</span> : dr < 0 ? <span class="arrow-down">▼{-dr}</span> : <span class="muted">·</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <p class="muted small">Değerler: kadrodaki tüm oyuncuların maç başı ortalamalarının toplamı; bırakılan ve eklenen oyuncular dahil (oynama süresi/maç sayısı farkı hesaba katılmaz).</p>
    </div>
  );

  const extra = uneven ? " (bırakılan/eklenen dahil)" : "";
  return (
    <>
      <div class="summary">
        <div class="stat-card"><div class="k">{A} veriyor ({metric})</div><div class="v">{r.a_gives_value.toFixed(d)}</div></div>
        <div class="stat-card"><div class="k">{B} veriyor ({metric})</div><div class="v">{r.b_gives_value.toFixed(d)}</div></div>
        <div class="stat-card"><div class="k">{A} için net{extra}</div><div class={`v ${cls(r.a_net_value)}`}>{signed(r.a_net_value, d)}</div>{!isPts && <div class="muted small">{tally("better_for_a")}</div>}</div>
        <div class="stat-card"><div class="k">{B} için net{extra}</div><div class={`v ${cls(r.b_net_value)}`}>{signed(r.b_net_value, d)}</div>{!isPts && <div class="muted small">{tally("better_for_b")}</div>}</div>
      </div>

      <div class="card-title-row" style="margin:-4px 0 14px">
        <span class="muted small">Takası tek bir görselde paylaş: paketler, net değer ve kategori değişimleri.</span>
        <button class="ghost" onClick={openShare} disabled={sharing}>{sharing ? "Hazırlanıyor…" : "Bu takasın görselini oluştur"}</button>
      </div>
      {share && <ShareModal share={share} onClose={() => setShare(null)} />}

      {uneven && (
        <Card title="Kadro dengesi">
          <p class="muted small" style="margin:-4px 0 10px">Oyuncu sayısı eşit olmayan takasta bir taraf oyuncu bırakmak zorunda kalır, diğer tarafta yer açılır. Aşağıdaki seçimler net değere, kategori farklarına ve lig sıralarına dahildir.</p>
          <div class="bal-grid">{sideBalance("a", A, selA.length, selB.length)}{sideBalance("b", B, selB.length, selA.length)}</div>
        </Card>
      )}

      <Card title="Kategori karşılaştırması (maç başı)">
        <p class="muted small" style="margin:-4px 0 8px">İlk iki sütun yalnızca takas paketleri (mavi: o kategoride daha iyi paket). Net sütunları her takımın kendi toplamındaki değişim{uneven ? ", bırakılan ve eklenen oyuncular dahil" : ""}.</p>
        <TableWrap>
          <thead><tr><th>Kategori</th><th>{A} veriyor</th><th>{B} veriyor</th><th>{A} için net</th><th>{B} için net</th></tr></thead>
          <tbody>
            {r.categories.map((c) => {
              const pk = better(c.a_gives, c.b_gives, c.higher);
              return (
                <tr key={c.key}>
                  <td><b>{c.label}</b>{c.higher ? null : <span class="muted small"> (az iyi)</span>}</td>
                  <td class={pk > 0 ? "win" : ""}>{fmt(c.key, c.a_gives)}</td>
                  <td class={pk < 0 ? "win" : ""}>{fmt(c.key, c.b_gives)}</td>
                  <td class={netCls(c.better_for_a)}>{netFmt(c, c.a_net)}</td>
                  <td class={netCls(c.better_for_b)}>{netFmt(c, c.b_net)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Oyuncular">
        <TableWrap>
          <thead><tr><th>Oyuncu</th><th class="l">Rol</th><th>GP</th>{isPts ? <th>FPTS/G</th> : <>{cs.map((c) => <th key={c.key}>{c.label}</th>)}<th>z toplam</th></>}</tr></thead>
          <tbody>
            {playerRows(selA, "a", R.give)}{playerRows(selB, "b", R.give)}
            {playerRows(mv.drops_a, "a", R.drop)}{playerRows(mv.drops_b, "b", R.drop)}
            {playerRows(mv.adds_a, "a", R.add)}{playerRows(mv.adds_b, "b", R.add)}
          </tbody>
        </TableWrap>
        {!isPts && <p class="muted small">Renkler: z-skoru &gt; +1 yeşil, &lt; −1 kırmızı. Hücrenin üstüne gelince z-skorunu görürsün. Yüzdeler atış hacmiyle ağırlıklı.</p>}
      </Card>

      <div class="two-col">{impactCard(r.teams.a, "a")}{impactCard(r.teams.b, "b")}</div>
    </>
  );
}
