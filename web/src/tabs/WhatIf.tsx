import { useEffect, useRef, useState } from "preact/hooks";
import { api, catByKey, dayLabel, dayLong, fmt, pname, registerPlayers, RES, scoreText, store } from "../store";
import { drawAllPlayPoster, loadLogos } from "../share";
import { PosterButton } from "../PosterButton";
import { scenarioPoster } from "../posters";
import { Luck } from "./Luck";
import type { AllPlay, Brief, Edit, Matchup, Player, StatLine, VersusRow, WeekData, WhatIfResult } from "../types";
import { Empty, ErrorBox, PageHead, PlayerLabel, TableWrap, TeamLogo, TeamName, TeamOptions } from "../ui";

export function WhatIf() {
  const lg = store.league;
  const cur = lg.current_week;
  const [week, setWeek] = useState(cur > lg.weeks[0].week ? cur - 1 : cur);
  const [team, setTeam] = useState(lg.my_team);
  const [oppReq, setOppReq] = useState<string | null>(null);      // null = the real opponent
  const [wk, setWk] = useState<WeekData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [res, setRes] = useState<WhatIfResult | null>(null);
  const [resErr, setResErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0), runSeq = useRef(0);

  useEffect(() => {
    const mine = ++loadSeq.current;
    setWk(null); setErr(null); setEdits([]); setRes(null);
    const q = oppReq ? `&opponent=${encodeURIComponent(oppReq)}` : "";
    api<WeekData>(`/api/week/${week}?team=${encodeURIComponent(team)}${q}`)
      .then((w) => { if (mine === loadSeq.current) { registerPlayers(w.players); setWk(w); } })
      .catch((e) => { if (mine === loadSeq.current) setErr(e.message); });
  }, [week, team, oppReq]);

  useEffect(() => {
    if (!wk || !edits.length) { setRes(null); setResErr(null); return; }
    const mine = ++runSeq.current;
    setBusy(true);
    api<WhatIfResult>("/api/whatif", { week: wk.week, team: wk.team, opponent: wk.opponent, edits })
      .then((r) => { if (mine === runSeq.current) { registerPlayers(r.info); setRes(r); setResErr(null); } })
      .catch((e) => { if (mine === runSeq.current) setResErr(e.message); })
      .finally(() => { if (mine === runSeq.current) setBusy(false); });
  }, [edits, wk]);

  const allPlayPoster = async () => {
    const data = await api<AllPlay>(`/api/allplay?team=${encodeURIComponent(team)}`);
    if (!data.weeks.length) throw new Error("Bu takım için oynanmış hafta yok.");
    return drawAllPlayPoster(data, store.teamName[team], await loadLogos([team, ...data.teams.map((t) => t.key)]));
  };

  return (
    <section>
      <PageHead title="Ya Olsaydı?" sub="Geçmiş bir haftayı yeniden oynat: başka bir rakibe karşı, farklı bir dizilişle ya da farklı oyuncularla." />
      <div class="toolbar">
        <label>Hafta
          <select value={week} onChange={(e) => { setWeek(+e.currentTarget.value); setOppReq(null); }}>
            {[...lg.weeks].reverse().map((w) => (
              <option value={w.week} key={w.week}>{w.week}. hafta ({w.start.slice(5)} – {w.end.slice(5)}){w.week === cur ? " · devam ediyor" : ""}</option>
            ))}
          </select>
        </label>
        <label>Takım
          <select class="team-select" value={team} onChange={(e) => { setTeam(e.currentTarget.value); setOppReq(null); }}><TeamOptions mark={{ [lg.my_team]: " (sen)" }} /></select>
        </label>
        <label>Rakip
          <select class="team-select" value={wk?.opponent ?? ""} disabled={!wk} onChange={(e) => setOppReq(e.currentTarget.value)}>
            <TeamOptions exclude={team} mark={wk?.real_opponent ? { [wk.real_opponent]: " (gerçek rakip)" } : undefined} />
          </select>
        </label>
      </div>

      {err ? <ErrorBox msg={err} /> : !wk ? <Empty>Hafta verisi yükleniyor…</Empty> : <>
        <Actual wk={wk} />
        <Versus wk={wk} rows={res?.versus ?? wk.versus} onPick={setOppReq} makePoster={allPlayPoster} />
        <Luck week={wk.week} />
        <Builder key={`${wk.week}|${wk.team}|${wk.opponent}`} wk={wk} edits={edits} setEdits={setEdits} />
        <div style={{ opacity: busy ? 0.5 : 1 }}>
          {resErr ? <ErrorBox msg={resErr} /> : res && edits.length ? <Result wk={wk} r={res} edits={edits} /> : null}
        </div>
      </>}

    </section>
  );
}

// ---------------------------------------------------------------- actual result
function Scoreboard({ wk, res, title }: { wk: WeekData; res: Matchup; title: string }) {
  const T = store.teamName[wk.team], O = store.teamName[wk.opponent];
  const isPts = store.league.scoring === "points";
  const a = isPts ? (res.a_points ?? 0).toFixed(1) : res.score!.W, b = isPts ? (res.b_points ?? 0).toFixed(1) : res.score!.L;
  const tie = !isPts && res.score!.T ? ` · ${res.score!.T} berabere` : "";
  return (
    <div class="scoreboard">
      <div class="sb-title">{title}</div>
      <div class="sb-row"><div class="sb-team"><TeamLogo team={wk.team} size={34} /> {T}</div><div class="sb-score">{a}</div><div class="sb-vs">vs</div><div class="sb-score">{b}</div><div class="sb-team">{O} <TeamLogo team={wk.opponent} size={34} /></div></div>
      <div class={`sb-foot ${res.result}`}>{T}: {RES[res.result]}{tie}</div>
    </div>
  );
}

function Actual({ wk }: { wk: WeekData }) {
  const real = wk.opponent === wk.real_opponent;
  const res = wk.result;
  const o = wk.official?.score, r = res.score;
  const same = !!(o && r && o.W === r.W && o.L === r.L && o.T === r.T);
  return (
    <div class="card">
      <Scoreboard wk={wk} res={res} title={`${wk.week}. hafta · ${real ? "gerçek sonuç" : "bu rakibe karşı olsaydı"}`} />
      {res.categories && (
        <TableWrap>
          <thead><tr><th>Takım</th>{res.categories.map((c) => <th key={c.key}>{catByKey(c.key)!.label}</th>)}</tr></thead>
          <tbody>
            <tr><td><TeamName team={wk.team} /></td>{res.categories.map((c) => <td key={c.key} class={c.result === "W" ? "win" : ""}>{fmt(c.key, c.a, "total")}</td>)}</tr>
            <tr><td><TeamName team={wk.opponent} /></td>{res.categories.map((c) => <td key={c.key} class={c.result === "L" ? "win" : ""}>{fmt(c.key, c.b, "total")}</td>)}</tr>
          </tbody>
        </TableWrap>
      )}
      <p class="muted small note">
        {real ? "Skor, haftalık kadro ve günlük kutu skorlarından yeniden hesaplandı. "
          : <>Bu eşleşme gerçekte oynanmadı: iki takımın o haftaki gerçek istatistikleri karşılaştırılıyor. Gerçek rakip: <b>{store.teamName[wk.real_opponent ?? ""] || "?"}</b>.</>}
        {real && o && (same
          ? <b class="pos">✓ Yahoo'nun resmi skoruyla aynı ({scoreText({ score: o })}).</b>
          : <b class="neg">Yahoo'nun resmi skoru: {scoreText({ score: o })}. Fark, eksik senkronize edilmiş günlerden ya da istatistik düzeltmelerinden olabilir.</b>)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- versus everyone
function Versus({ wk, rows, onPick, makePoster }: { wk: WeekData; rows: VersusRow[]; onPick: (t: string) => void; makePoster: () => Promise<HTMLCanvasElement> }) {
  const hasHypo = rows.some((r) => r.hypothetical);
  const wins = (k: "actual" | "hypothetical") => rows.filter((r) => r[k]?.result === "W").length;
  const pill = (x: Brief) => <><b class={x.result === "W" ? "pos" : x.result === "L" ? "neg" : ""}>{scoreText(x)}</b> <span class="muted small">{RES[x.result]}</span></>;
  return (
    <div class="card">
      <div class="card-title-row">
        <h3 style="margin:0">Bu hafta başkasıyla oynasaydın</h3>
        <PosterButton label="Tüm haftaların görselini oluştur" name={`${store.teamName[wk.team]}-herkese-karsi`} make={makePoster} />
      </div>
      <p class="muted small" style="margin:0 0 8px">{store.teamName[wk.team]} bu haftaki istatistikleriyle ligdeki {rows.length} takımdan <b>{wins("actual")}</b> tanesini yenerdi
        {hasHypo ? <>; senaryodaki dizilişle <b>{wins("hypothetical")}</b> tanesini</> : null}. Satıra tıklayınca o rakibe karşı ayrıntıyı görürsün.</p>
      <TableWrap>
        <thead><tr><th>Rakip</th><th>Gerçek dizilişle</th>{hasHypo && <th>Senaryoyla</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team} class={`rowlink ${r.team === wk.opponent ? "selected" : ""}`} onClick={() => onPick(r.team)}>
              <td><TeamName team={r.team} />{r.team === wk.real_opponent && <span class="badge">gerçek rakip</span>}</td>
              <td>{pill(r.actual)}</td>{hasHypo && <td>{r.hypothetical ? pill(r.hypothetical) : null}</td>}
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ---------------------------------------------------------------- scenario builder
function Builder({ wk, edits, setEdits }: { wk: WeekData; edits: Edit[]; setEdits: (e: Edit[]) => void }) {
  const byTeam = (t: string) => Object.keys(wk.usage).filter((k) => wk.usage[k].team === t);
  const [out, setOut] = useState(byTeam(wk.team)[0] ?? "");
  const [into, setInto] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Player[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [mutual, setMutual] = useState(true);
  const timer = useRef<number>();

  const dayEdit = (team: string, player: string, date: string) =>
    edits.find((e) => e.team === team && e.player === player && e.dates?.[0] === date && e.type !== "swap");
  const toggleCell = (team: string, player: string, date: string, active: boolean) => {
    const ed = dayEdit(team, player, date);
    setEdits(ed ? edits.filter((e) => e !== ed) : [...edits, { team, type: active ? "bench" : "start", player, dates: [date] }]);
  };

  const onSearch = (v: string) => {
    setQ(v); setPick(null);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    timer.current = window.setTimeout(async () => {
      const res = await api<Player[]>("/api/search?q=" + encodeURIComponent(v.trim()));
      registerPlayers(res);
      setHits(res);
    }, 250);
  };

  const addSwap = () => {
    const incoming = pick || into;
    if (!out || !incoming || out === incoming) return;
    const team = wk.usage[out].team;
    const other = team === wk.team ? wk.opponent : wk.team;
    let next = edits.filter((s) => !(s.type === "swap" && s.team === team && s.out === out));
    next.push({ team, type: "swap", out, into: incoming });
    if (mutual && wk.usage[incoming]?.team === other) {
      next = next.filter((s) => !(s.type === "swap" && s.team === other && s.out === incoming));
      next.push({ team: other, type: "swap", out: incoming, into: out });
    }
    setEdits(next);
    setPick(null); setQ(""); setInto(""); setHits([]);
  };

  const grid = (team: string) => {
    const rows = Object.entries(wk.grid[team] || {})
      .sort((a, b) => (wk.usage[b[0]]?.active_games || 0) - (wk.usage[a[0]]?.active_games || 0));
    return (
      <>
        <div class="grid-title"><TeamName team={team} plain /></div>
        <TableWrap class="grid-table">
          <thead><tr><th>Oyuncu</th>{wk.dates.map((d) => <th key={d}>{dayLabel(d)}</th>)}</tr></thead>
          <tbody>
            {rows.map(([k, days]) => (
              <tr key={k}>
                <td><PlayerLabel k={k} /></td>
                {wk.dates.map((d) => {
                  const c = days[d];
                  if (!c) return <td key={d}><span class="cell nogame" title="Kadroda değil">·</span></td>;
                  if (!c.played) return <td key={d}><span class="cell nogame">–</span></td>;
                  const ed = dayEdit(team, k, d);
                  const on = ed ? ed.type === "start" : c.active;
                  return (
                    <td key={d}>
                      <span class={`cell click ${on ? "on" : "off"} ${ed ? "edited" : ""}`} onClick={() => toggleCell(team, k, d, c.active)}
                        title={`${on ? "Oynuyor" : "Yedekte"} (${c.slot}) · tıkla: ${on ? "oynatma" : "oynat"}`}>{c.pts ?? 0}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </>
    );
  };

  const group = (label: string, keys: string[]) => keys.length ? (
    <optgroup label={label} key={label}>{keys.map((k) => <option value={k} key={k}>{pname(k)}</option>)}</optgroup>
  ) : null;
  const T = store.teamName[wk.team], O = store.teamName[wk.opponent];
  const editText = (s: Edit) => s.type === "swap"
    ? <>{pname(s.out!)} → <b>{pname(s.into!)}</b></>
    : <><b>{pname(s.player!)}</b> · {dayLong(s.dates![0])} {s.type === "bench" ? "oynatma" : "oynat"}</>;

  return (
    <div class="card">
      <h3>Senaryo kur</h3>
      <p class="muted small" style="margin:-2px 0 10px"><b>Günlük diziliş:</b> bir hücreye tıklayarak o oyuncuyu o gün oynat ya da oynatma.
        Sayılar o günkü sayı (PTS); “–” o gün maçı yok demek.</p>
      {grid(wk.team)}{grid(wk.opponent)}
      <div class="legend">
        <span><span class="swatch on">12</span> oynadı (aktif)</span>
        <span><span class="swatch off">12</span> yedekte kaldı</span>
        <span>Sarı çerçeve: senaryoda değiştirdiğin hücre</span>
      </div>

      <h3 style="margin-top:18px">Oyuncu değiştir</h3>
      <p class="muted small" style="margin:-2px 0 0">Çıkan oyuncunun <b>aktif kadroda olduğu günlerde</b> yerine gelenin o günkü istatistiği sayılır.
        Yerine gelen aynı takımın yedeğiyse ikisinin yeri değişir.</p>
      <div class="swap-form">
        <label>Çıkan oyuncu
          <select value={out} onChange={(e) => setOut(e.currentTarget.value)}>{group(T, byTeam(wk.team))}{group(O, byTeam(wk.opponent))}</select>
        </label>
        <label>Yerine giren
          <select value={pick ? "" : into} onChange={(e) => { setInto(e.currentTarget.value); setPick(null); setQ(""); }}>
            <option value="">— seç —</option>
            {group(`${T} (bu hafta)`, byTeam(wk.team))}{group(`${O} (bu hafta)`, byTeam(wk.opponent))}
            {store.league.teams.filter((t) => t.key !== wk.team && t.key !== wk.opponent).map((t) => group(t.name, store.rosters[t.key] || []))}
          </select>
        </label>
        <label>…veya oyuncu ara
          <input value={q} placeholder="İsim yaz (başka takım, serbest oyuncu…)" autocomplete="off" onInput={(e) => onSearch(e.currentTarget.value)} />
          <div class="search-results">
            {hits.length > 0 && !pick && (
              <ul>{hits.map((p) => (
                <li key={p.key} onClick={() => { setPick(p.key); setQ(p.name); setInto(""); }}>
                  {p.name} <span class="muted small">{p.nba_team} · {p.owner ? store.teamName[p.owner] || "kadrolu" : "serbest"}</span>
                </li>
              ))}</ul>
            )}
          </div>
        </label>
        <button class="primary" onClick={addSwap}>Ekle</button>
      </div>
      <label class="check"><input type="checkbox" checked={mutual} onChange={(e) => setMutual(e.currentTarget.checked)} /> Yerine giren rakibin oyuncusuysa, rakibe de ters değişimi uygula (takas gibi)</label>

      <div class="chips">
        {edits.map((s, i) => (
          <span class="chip" key={i}><span class="muted small">{store.teamName[s.team]}:</span> {editText(s)}
            <button title="Kaldır" onClick={() => setEdits(edits.filter((_, j) => j !== i))}>×</button></span>
        ))}
        {edits.length > 1 && <span class="chip" style="border-color:var(--line)"><a href="#" onClick={(e) => { e.preventDefault(); setEdits([]); }}>Hepsini temizle</a></span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- scenario result
function Result({ wk, r, edits }: { wk: WeekData; r: WhatIfResult; edits: Edit[] }) {
  const a = r.actual, h = r.hypothetical;
  const T = store.teamName[wk.team], O = store.teamName[wk.opponent];
  const cs = r.scoring === "points" ? [] : store.league.categories;
  const comp = (line: StatLine, c: (typeof cs)[number]) => (c.ratio ? (line[c.ratio[1]] ? line[c.ratio[0]] / line[c.ratio[1]] : null) : line[c.key] || 0);
  const tag = (res: string) => <td class={res === "W" ? "tag-w" : res === "L" ? "tag-l" : ""}>{res === "W" ? "K" : res === "L" ? "M" : "B"}</td>;
  const cells = (line: StatLine) => <><td>{line.GP || 0}</td>{cs.map((c) => <td key={c.key}>{fmt(c.key, comp(line, c), "total")}</td>)}</>;
  return (
    <div class="card">
      <div class="card-title-row">
        <h3 style="margin:0">Senaryo sonucu</h3>
        <PosterButton label="Senaryonun görselini oluştur" name={`ya-olsaydi-${wk.week}-hafta-${store.teamName[wk.team]}`} make={() => scenarioPoster(wk, r, edits)} />
      </div>
      {r.flipped
        ? <div class="verdict flip">Sonuç değişirdi: {scoreText(a)} {RES[a.result]} → <b>{scoreText(h)} {RES[h.result]}</b></div>
        : <div class="verdict same">Sonuç değişmezdi: {scoreText(a)} → {scoreText(h)} ({RES[h.result]})</div>}
      {r.warnings.map((x, i) => (
        <div class="warn" key={i}>⚠ {dayLong(x.date)}: {store.teamName[x.team]} senaryoda {x.played} oyuncu oynatıyor, aktif kadro {x.slots} kişilik. Bu diziliş Yahoo'da mümkün olmazdı.</div>
      ))}
      {h.categories && a.categories && <>
        <TableWrap>
          <thead><tr><th>Kategori</th><th>{T} gerçek</th><th>{T} senaryo</th><th>{O} gerçek</th><th>{O} senaryo</th><th>Gerçek</th><th>Senaryo</th></tr></thead>
          <tbody>
            {h.categories.map((c, i) => {
              const c0 = a.categories![i];
              return (
                <tr key={c.key} class={c.changed ? "changed" : ""}>
                  <td><b>{catByKey(c.key)!.label}</b></td>
                  <td class="faded">{fmt(c.key, c0.a, "total")}</td><td class={c.result === "W" ? "win" : ""}>{fmt(c.key, c.a, "total")}</td>
                  <td class="faded">{fmt(c.key, c0.b, "total")}</td><td class={c.result === "L" ? "win" : ""}>{fmt(c.key, c.b, "total")}</td>
                  {tag(c0.result)}{tag(c.result)}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <div class="legend"><span>K = {T} kazanır, M = kaybeder, B = berabere</span><span>Mavi hücre: senaryoda kategoriyi kazanan</span><span>Sarı satır: sonucu değişen kategori</span></div>
      </>}
      <h3 style="margin-top:20px">Değişen oyuncuların aktif kadrodaki katkısı</h3>
      <TableWrap>
        <thead><tr><th>Oyuncu</th><th></th><th>Maç</th>{cs.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {Object.entries(r.players).map(([k, v]) => (
            <>
              <tr key={k + "a"}><td rowSpan={2}><PlayerLabel k={k} /></td><td class="muted">gerçek</td>{cells(v.actual)}</tr>
              <tr key={k + "h"}><td class="muted">senaryo</td>{cells(v.hypothetical)}</tr>
            </>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
