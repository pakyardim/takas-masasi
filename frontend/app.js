const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  league: null, rosters: {}, players: {}, teamName: {},
  selA: new Set(), selB: new Set(),
  wk: null, swaps: [], searchPick: null,
};

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

// ---------------------------------------------------------------- formatting
const cats = () => S.league.scoring === "points" ? [{ key: "FPTS", label: "FPTS", higher: true }] : S.league.categories;
const catByKey = (k) => S.league.categories.find((c) => c.key === k);
function fmt(key, v, mode = "pg") {
  if (v === null || v === undefined) return "–";
  const c = catByKey(key);
  if (c && c.ratio) return v.toFixed(3).replace(/^0\./, ".");
  if (mode === "total") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return v.toFixed(1);
}
const signed = (v, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d);
const cls = (v) => (v > 0.0001 ? "pos" : v < -0.0001 ? "neg" : "");
const pname = (k) => S.players[k]?.name || k;
const RES = { W: "Galibiyet", L: "Mağlubiyet", T: "Beraberlik" };

// Yahoo-style player cell: name in link blue, injury tag in red, "NYK - PG,SG" underneath
function playerLabel(k) {
  const p = S.players[k] || {};
  const st = p.status ? `<span class="inj">${esc(p.status)}</span>` : "";
  const sub = [p.nba_team, (p.positions || []).join(",")].filter(Boolean).join(" - ");
  return `<span class="pl-name">${esc(p.name || k)}</span>${st}${sub ? `<span class="pl-sub">${esc(sub)}</span>` : ""}`;
}

// ---------------------------------------------------------------- tabs
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + b.dataset.tab));
  })
);

// ---------------------------------------------------------------- init
async function init() {
  const data = await api("/api/league");
  S.league = data.league; S.rosters = data.rosters; S.players = data.players;
  S.league.teams.forEach((t) => (S.teamName[t.key] = t.name));
  $("#league-name").innerHTML = esc(S.league.name) + (S.league.demo ? ' <span class="badge">DEMO VERİ</span>' : ` (ID# ${esc(S.league.key)})`)
    + (S.league.synced_at ? ` · son senkron ${new Date(S.league.synced_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}` : "");

  const opts = S.league.teams.map((t) => `<option value="${t.key}">${esc(t.name)}${t.key === S.league.my_team ? " (sen)" : ""}</option>`).join("");
  ["#team-a", "#team-b", "#wi-team"].forEach((s) => ($(s).innerHTML = opts));
  $("#team-a").value = S.league.my_team;
  $("#team-b").value = S.league.teams.find((t) => t.key !== S.league.my_team).key;
  $("#wi-team").value = S.league.my_team;

  const cur = S.league.current_week;
  $("#wi-week").innerHTML = [...S.league.weeks].reverse()
    .map((w) => `<option value="${w.week}">${w.week}. hafta (${w.start.slice(5)} – ${w.end.slice(5)})${w.week === cur ? " · devam ediyor" : ""}</option>`).join("");
  $("#wi-week").value = cur > S.league.weeks[0].week ? cur - 1 : cur;

  $("#team-a").onchange = () => { S.selA.clear(); renderRosters(); runTrade(); };
  $("#team-b").onchange = () => { S.selB.clear(); renderRosters(); runTrade(); };
  $("#period").onchange = runTrade;
  $("#wi-week").onchange = loadWeek;
  $("#wi-team").onchange = loadWeek;

  renderRosters();
  runTrade();
  loadWeek();
}

// ================================================================ TRADE
function renderRosters() {
  for (const side of ["a", "b"]) {
    const team = $("#team-" + side).value;
    const sel = side === "a" ? S.selA : S.selB;
    $("#roster-" + side).innerHTML = S.rosters[team].map((k) => {
      return `<div class="prow ${sel.has(k) ? "sel" : ""}" data-k="${k}" data-side="${side}">
        <input type="checkbox" ${sel.has(k) ? "checked" : ""} tabindex="-1">
        <div>${playerLabel(k)}</div>
      </div>`;
    }).join("");
  }
  document.querySelectorAll(".prow").forEach((row) =>
    row.addEventListener("click", () => {
      const sel = row.dataset.side === "a" ? S.selA : S.selB;
      sel.has(row.dataset.k) ? sel.delete(row.dataset.k) : sel.add(row.dataset.k);
      renderRosters();
      runTrade();
    })
  );
}

let tradeSeq = 0;
async function runTrade() {
  const out = $("#trade-result");
  if (!S.selA.size && !S.selB.size) {
    out.innerHTML = `<div class="card empty">Her iki taraftan oyuncu seç: paketler kategori kategori karşılaştırılacak.</div>`;
    return;
  }
  const seq = ++tradeSeq;
  out.style.opacity = 0.5;
  try {
    const r = await api("/api/trade", {
      team_a: $("#team-a").value, give_a: [...S.selA],
      team_b: $("#team-b").value, give_b: [...S.selB], period: $("#period").value,
    });
    if (seq === tradeSeq) renderTrade(r);
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  } finally {
    out.style.opacity = 1;
  }
}

function renderTrade(r) {
  const A = S.teamName[r.teams.a], B = S.teamName[r.teams.b];
  const isPts = r.scoring === "points";
  const metric = isPts ? "FPTS/maç" : "toplam z-skor";
  const d = isPts ? 1 : 2;

  let spots = "";
  if (r.roster_spots.a_net !== 0) {
    const [who, n] = r.roster_spots.a_net > 0 ? [A, r.roster_spots.a_net] : [B, -r.roster_spots.a_net];
    spots = `<p class="muted small">⚠ ${esc(who)} bu takasla ${n} kadro yeri boşaltıyor. Boşalan yere alınacak oyuncunun değeri hesaba katılmadı (diğer takım ise ${n} oyuncu bırakmak zorunda kalır).</p>`;
  }

  const catRows = r.categories.map((c) => {
    const winner = c.better_for_a === "W" ? `<td><span class="side-tag a mini">A</span>${esc(A)}</td>` : c.better_for_a === "L" ? `<td><span class="side-tag b mini">B</span>${esc(B)}</td>` : `<td class="faded">=</td>`;
    const net = c.a_net === null ? "–" : (catByKey(c.key)?.ratio ? signed(c.a_net, 3) : signed(c.a_net, 1));
    const netCls = c.better_for_a === "W" ? "pos" : c.better_for_a === "L" ? "neg" : "";
    return `<tr><td><b>${esc(c.label)}</b>${c.higher ? "" : ' <span class="muted small">(az iyi)</span>'}</td>
      <td class="${c.better_for_a === "L" ? "win" : ""}">${fmt(c.key, c.a_gives)}</td><td class="${c.better_for_a === "W" ? "win" : ""}">${fmt(c.key, c.b_gives)}</td>
      <td class="${netCls}">${net}</td>${winner}</tr>`;
  }).join("");
  const aWins = r.categories.filter((c) => c.better_for_a === "W").length;
  const bWins = r.categories.filter((c) => c.better_for_a === "L").length;

  const cs = cats();
  const playerRows = (keys, tag) => keys.map((k) => {
    const p = r.players[k], avg = p.avg;
    const vals = isPts ? `<td>${p.fpts.toFixed(1)}</td>`
      : cs.map((c) => `<td title="z: ${p.z[c.key].toFixed(2)}" class="${p.z[c.key] > 1 ? "pos" : p.z[c.key] < -1 ? "neg" : ""}">${fmt(c.key, c.ratio ? (avg[c.ratio[1]] ? avg[c.ratio[0]] / avg[c.ratio[1]] : null) : avg[c.key])}</td>`).join("")
        + `<td><b class="${cls(p.z.TOTAL)}">${signed(p.z.TOTAL)}</b></td>`;
    return `<tr><td><div style="display:flex;align-items:center;gap:6px"><span class="side-tag ${tag} mini">${tag.toUpperCase()}</span><div>${playerLabel(k)}</div></div></td><td>${avg.GP ?? "–"}</td>${vals}</tr>`;
  }).join("");
  const aKeys = Object.keys(r.players).filter((k) => S.selA.has(k));
  const bKeys = Object.keys(r.players).filter((k) => S.selB.has(k));

  const impact = (team) => r.team_impact[team].map((x) => {
    const dr = x.rank_before - x.rank_after;
    const arrow = dr > 0 ? `<span class="arrow-up">▲${dr}</span>` : dr < 0 ? `<span class="arrow-down">▼${-dr}</span>` : `<span class="muted">·</span>`;
    return `<tr><td><b>${esc(x.label)}</b></td><td>${fmt(x.key, x.before)}</td><td>${fmt(x.key, x.after)}</td>
      <td>${x.rank_before}. → <b>${x.rank_after}.</b> ${arrow}</td></tr>`;
  }).join("");
  const impactCard = (team, tag) => `<div class="card"><div class="card-head"><span class="side-tag ${tag}">${tag.toUpperCase()}</span><h3 style="margin:0">${esc(S.teamName[team])}: takas sonrası</h3></div>
    <div class="table-wrap"><table><thead><tr><th>Kategori</th><th>Önce</th><th>Sonra</th><th>Lig sırası (${r.league_size} takım)</th></tr></thead><tbody>${impact(team)}</tbody></table></div>
    <p class="muted small">Değerler: kadrodaki tüm oyuncuların maç başı ortalamalarının toplamı (oynama süresi/maç sayısı farkı hesaba katılmaz).</p></div>`;

  $("#trade-result").innerHTML = `
    <div class="summary">
      <div class="stat-card"><div class="k">${esc(A)} veriyor (${metric})</div><div class="v">${r.a_gives_value.toFixed(d)}</div></div>
      <div class="stat-card"><div class="k">${esc(B)} veriyor (${metric})</div><div class="v">${r.b_gives_value.toFixed(d)}</div></div>
      <div class="stat-card"><div class="k">${esc(A)} için net</div><div class="v ${cls(r.a_net_value)}">${signed(r.a_net_value, d)}</div></div>
      ${isPts ? "" : `<div class="stat-card"><div class="k">Kategori üstünlüğü</div><div class="v"><span style="color:var(--a)">${aWins}</span> <span class="muted" style="font-size:14px;font-weight:700">vs</span> <span style="color:var(--b)">${bWins}</span></div><div class="muted small">${esc(A)} lehine – ${esc(B)} lehine</div></div>`}
    </div>
    ${spots}
    <div class="card"><h3>Paket karşılaştırması (maç başı)</h3><p class="muted small" style="margin:-4px 0 8px">Mavi hücre: o kategoride daha iyi olan paket.</p>
      <div class="table-wrap"><table><thead><tr><th>Kategori</th><th>${esc(A)} veriyor</th><th>${esc(B)} veriyor</th><th>${esc(A)} için net</th><th>Kazanan taraf</th></tr></thead><tbody>${catRows}</tbody></table></div>
    </div>
    <div class="card"><h3>Oyuncular</h3>
      <div class="table-wrap"><table><thead><tr><th>Oyuncu</th><th>GP</th>${isPts ? "<th>FPTS/G</th>" : cs.map((c) => `<th>${esc(c.label)}</th>`).join("") + "<th>z toplam</th>"}</tr></thead>
      <tbody>${playerRows(aKeys, "a")}${playerRows(bKeys, "b")}</tbody></table></div>
      ${isPts ? "" : `<p class="muted small">Renkler: z-skoru &gt; +1 yeşil, &lt; −1 kırmızı. Hücrenin üstüne gelince z-skorunu görürsün. Yüzdeler atış hacmiyle ağırlıklı.</p>`}
    </div>
    <div class="two-col">${impactCard(r.teams.a, "a")}${impactCard(r.teams.b, "b")}</div>`;
}

// ================================================================ WHAT IF
async function loadWeek() {
  S.swaps = []; S.searchPick = null;
  $("#wi-actual").innerHTML = `<div class="card empty">Hafta verisi yükleniyor…</div>`;
  $("#wi-builder").hidden = true;
  try {
    S.wk = await api(`/api/week/${$("#wi-week").value}?team=${encodeURIComponent($("#wi-team").value)}`);
  } catch (e) {
    $("#wi-actual").innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  Object.assign(S.players, S.wk.players);
  renderActual();
  renderBuilder();
  $("#wi-builder").hidden = false;
  renderSwaps();
}

function scoreboard(res, title) {
  const T = S.teamName[S.wk.team], O = S.teamName[S.wk.opponent];
  const isPts = S.league.scoring === "points";
  const a = isPts ? res.a_points.toFixed(1) : res.score.W, b = isPts ? res.b_points.toFixed(1) : res.score.L;
  const tie = !isPts && res.score.T ? ` · ${res.score.T} berabere` : "";
  return `<div class="scoreboard"><div class="sb-title">${title}</div>
    <div class="sb-row"><div class="sb-team">${esc(T)}</div><div class="sb-score">${a}</div><div class="sb-vs">vs</div><div class="sb-score">${b}</div><div class="sb-team">${esc(O)}</div></div>
    <div class="sb-foot ${res.result}">${esc(T)}: ${RES[res.result]}${tie}</div></div>`;
}

function matchupTable(res, title) {
  const T = S.teamName[S.wk.team], O = S.teamName[S.wk.opponent];
  if (S.league.scoring === "points") return scoreboard(res, title);
  const head = res.categories.map((c) => `<th>${esc(catByKey(c.key).label)}</th>`).join("");
  const row = (name, side, winRes) => `<tr><td><span class="pl-name">${esc(name)}</span></td>${res.categories.map((c) =>
    `<td class="${c.result === winRes ? "win" : ""}">${fmt(c.key, c[side], "total")}</td>`).join("")}</tr>`;
  return `${scoreboard(res, title)}
    <div class="table-wrap"><table><thead><tr><th>Takım</th>${head}</tr></thead><tbody>${row(T, "a", "W")}${row(O, "b", "L")}</tbody></table></div>`;
}

function renderActual() {
  const w = S.wk;
  const roster = (team) => Object.entries(w.usage).filter(([, u]) => u.team === team)
    .sort((a, b) => b[1].active_games - a[1].active_games)
    .map(([k, u]) => `<tr><td>${playerLabel(k)}</td><td>${u.active_games}</td><td class="${u.bench_games ? "neg" : "faded"}">${u.bench_games}</td></tr>`).join("");
  const rosterCard = (team) => `<div class="card"><h3>${esc(S.teamName[team])}</h3>
    <div class="table-wrap"><table><thead><tr><th>Oyuncu</th><th>Aktifte oynadı</th><th>Yedekte oynadı</th></tr></thead><tbody>${roster(team)}</tbody></table></div></div>`;
  let note = `Skor, haftalık kadro ve günlük kutu skorlarından yeniden hesaplandı.`;
  if (w.official && w.official.score) {
    const o = w.official.score, r = w.result.score;
    const same = o.W === r.W && o.L === r.L && o.T === r.T;
    note += same
      ? ` <b class="pos">✓ Yahoo'nun resmi skoruyla aynı (${o.W}-${o.L}${o.T ? "-" + o.T : ""}).</b>`
      : ` <b class="neg">Yahoo'nun resmi skoru: ${o.W}-${o.L}${o.T ? "-" + o.T : ""}. Fark, eksik senkronize edilmiş günlerden ya da istatistik düzeltmelerinden olabilir; tekrar senkronize etmeyi dene.</b>`;
  }
  $("#wi-actual").innerHTML = `
    <div class="card">${matchupTable(w.result, `${w.week}. hafta · gerçek sonuç`)}
      <p class="muted small note">${note}</p></div>
    <div class="two-col">${rosterCard(w.team)}${rosterCard(w.opponent)}</div>`;
}

function renderBuilder() {
  const w = S.wk;
  const byTeam = (team) => Object.keys(w.usage).filter((k) => w.usage[k].team === team);
  const og = (label, keys) => keys.length ? `<optgroup label="${esc(label)}">${keys.map((k) => `<option value="${k}">${esc(pname(k))}</option>`).join("")}</optgroup>` : "";
  $("#wi-out").innerHTML = og(S.teamName[w.team], byTeam(w.team)) + og(S.teamName[w.opponent], byTeam(w.opponent));

  const others = S.league.teams.filter((t) => t.key !== w.team && t.key !== w.opponent)
    .map((t) => og(t.name, S.rosters[t.key] || [])).join("");
  $("#wi-in").innerHTML = `<option value="">— seç —</option>` + og(S.teamName[w.team] + " (bu hafta)", byTeam(w.team)) +
    og(S.teamName[w.opponent] + " (bu hafta)", byTeam(w.opponent)) + others;
  $("#wi-in").onchange = () => { S.searchPick = null; $("#wi-search").value = ""; };
}

let searchTimer;
$("#wi-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $("#wi-search-results").innerHTML = ""; return; }
  searchTimer = setTimeout(async () => {
    const res = await api("/api/search?q=" + encodeURIComponent(q));
    res.forEach((p) => (S.players[p.key] = { ...S.players[p.key], ...p }));
    $("#wi-search-results").innerHTML = res.length ? `<ul>${res.map((p) =>
      `<li data-k="${p.key}">${esc(p.name)} <span class="muted small">${esc(p.nba_team)} · ${p.owner ? esc(S.teamName[p.owner] || "kadrolu") : "serbest"}</span></li>`).join("")}</ul>` : "";
    document.querySelectorAll("#wi-search-results li").forEach((li) => li.addEventListener("click", () => {
      S.searchPick = li.dataset.k;
      $("#wi-search").value = pname(li.dataset.k);
      $("#wi-in").value = "";
      $("#wi-search-results").innerHTML = "";
    }));
  }, 250);
});

$("#wi-add").addEventListener("click", () => {
  const out = $("#wi-out").value;
  const into = S.searchPick || $("#wi-in").value;
  if (!out || !into || out === into) return;
  const w = S.wk;
  const team = w.usage[out].team;
  const other = team === w.team ? w.opponent : w.team;
  S.swaps = S.swaps.filter((s) => !(s.team === team && s.out === out));
  S.swaps.push({ team, out, into });
  if ($("#wi-mutual").checked && w.usage[into]?.team === other) {
    S.swaps = S.swaps.filter((s) => !(s.team === other && s.out === into));
    S.swaps.push({ team: other, out: into, into: out });
  }
  S.searchPick = null; $("#wi-search").value = ""; $("#wi-in").value = "";
  renderSwaps();
});

function renderSwaps() {
  $("#wi-swaps").innerHTML = S.swaps.map((s, i) =>
    `<span class="chip"><span class="muted small">${esc(S.teamName[s.team])}:</span> ${esc(pname(s.out))} → <b>${esc(pname(s.into))}</b><button data-i="${i}" title="Kaldır">×</button></span>`).join("");
  document.querySelectorAll("#wi-swaps button").forEach((b) => b.addEventListener("click", () => {
    S.swaps.splice(+b.dataset.i, 1);
    renderSwaps();
  }));
  runWhatIf();
}

let wiSeq = 0;
async function runWhatIf() {
  const out = $("#wi-result");
  if (!S.swaps.length) {
    out.innerHTML = `<p class="muted">Bir değişiklik ekle: "Bu hafta X yerine Y oynasaydı ne olurdu?"</p>`;
    return;
  }
  const seq = ++wiSeq;
  out.style.opacity = 0.5;
  try {
    const r = await api("/api/whatif", { week: S.wk.week, team: S.wk.team, opponent: S.wk.opponent, swaps: S.swaps });
    Object.assign(S.players, r.info);
    if (seq === wiSeq) renderWhatIf(r);
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  } finally {
    out.style.opacity = 1;
  }
}

function renderWhatIf(r) {
  const a = r.actual, h = r.hypothetical, isPts = r.scoring === "points";
  const score = (x) => isPts ? `${x.a_points.toFixed(1)}–${x.b_points.toFixed(1)}` : `${x.score.W}-${x.score.L}${x.score.T ? "-" + x.score.T : ""}`;
  const verdict = r.flipped
    ? `<div class="verdict flip">Sonuç değişirdi: ${score(a)} ${RES[a.result]} → <b>${score(h)} ${RES[h.result]}</b></div>`
    : `<div class="verdict same">Sonuç değişmezdi: ${score(a)} → ${score(h)} (${RES[h.result]})</div>`;

  let table = "";
  if (!isPts) {
    const T = S.teamName[S.wk.team], O = S.teamName[S.wk.opponent];
    const rows = h.categories.map((c, i) => {
      const c0 = a.categories[i], meta = catByKey(c.key);
      const tag = (res) => `<td class="${res === "W" ? "tag-w" : res === "L" ? "tag-l" : ""}">${res === "W" ? "K" : res === "L" ? "M" : "B"}</td>`;
      return `<tr class="${c.changed ? "changed" : ""}"><td><b>${esc(meta.label)}</b></td>
        <td class="faded">${fmt(c.key, c0.a, "total")}</td><td class="${c.result === "W" ? "win" : ""}">${fmt(c.key, c.a, "total")}</td>
        <td class="faded">${fmt(c.key, c0.b, "total")}</td><td class="${c.result === "L" ? "win" : ""}">${fmt(c.key, c.b, "total")}</td>
        ${tag(c0.result)}${tag(c.result)}</tr>`;
    }).join("");
    table = `<div class="table-wrap"><table><thead><tr><th>Kategori</th><th>${esc(T)} gerçek</th><th>${esc(T)} senaryo</th><th>${esc(O)} gerçek</th><th>${esc(O)} senaryo</th><th>Gerçek</th><th>Senaryo</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="legend"><span>K = ${esc(T)} kazanır, M = kaybeder, B = berabere</span><span>Mavi hücre: senaryoda kategoriyi kazanan</span><span>Sarı satır: sonucu değişen kategori</span></div>`;
  }

  const cs = isPts ? [] : S.league.categories;
  const comp = (line, c) => c.ratio ? (line[c.ratio[1]] ? line[c.ratio[0]] / line[c.ratio[1]] : null) : (line[c.key] || 0);
  const pRows = Object.entries(r.players).map(([k, v]) => {
    const cells = (line) => `<td>${line.GP || 0}</td>` + cs.map((c) => `<td>${fmt(c.key, comp(line, c), "total")}</td>`).join("");
    return `<tr><td rowspan="2">${playerLabel(k)}</td><td class="muted">gerçek</td>${cells(v.actual)}</tr>
            <tr><td class="muted">senaryo</td>${cells(v.hypothetical)}</tr>`;
  }).join("");

  $("#wi-result").innerHTML = `${verdict}${table}
    <h3 style="margin-top:20px">Değişen oyuncuların aktif kadrodaki katkısı</h3>
    <div class="table-wrap"><table><thead><tr><th>Oyuncu</th><th></th><th>Maç</th>${cs.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${pRows}</tbody></table></div>`;
}

init().catch((e) => {
  document.querySelector("main").innerHTML = `<div class="error">Başlatılamadı: ${esc(e.message)}</div>`;
});
