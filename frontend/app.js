const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  league: null, rosters: {}, players: {}, teamName: {},
  selA: new Set(), selB: new Set(),
  wk: null, edits: [], searchPick: null, loaded: {},
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
    if (b.dataset.tab === "draft") loadDraft();
    if (b.dataset.tab === "moves") loadMoves();
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
  $("#wi-week").onchange = () => loadWeek(null);
  $("#wi-team").onchange = () => loadWeek(null);
  $("#wi-opp").onchange = () => loadWeek($("#wi-opp").value);

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
const dayLabel = (d) => new Date(d + "T12:00:00").toLocaleDateString("tr-TR", { weekday: "short", day: "numeric" });
const dayLong = (d) => new Date(d + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
const scoreText = (x) => x.score ? `${x.score.W}-${x.score.L}${x.score.T ? "-" + x.score.T : ""}` : `${x.a_points.toFixed(1)}–${x.b_points.toFixed(1)}`;

async function loadWeek(opponent) {
  S.edits = []; S.searchPick = null;
  $("#wi-actual").innerHTML = `<div class="card empty">Hafta verisi yükleniyor…</div>`;
  $("#wi-versus").innerHTML = ""; $("#wi-result").innerHTML = "";
  $("#wi-builder").hidden = true;
  try {
    const q = opponent ? `&opponent=${encodeURIComponent(opponent)}` : "";
    S.wk = await api(`/api/week/${$("#wi-week").value}?team=${encodeURIComponent($("#wi-team").value)}${q}`);
  } catch (e) {
    $("#wi-actual").innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  Object.assign(S.players, S.wk.players);
  const w = S.wk;
  $("#wi-opp").innerHTML = S.league.teams.filter((t) => t.key !== w.team)
    .map((t) => `<option value="${t.key}">${esc(t.name)}${t.key === w.real_opponent ? " (gerçek rakip)" : ""}</option>`).join("");
  $("#wi-opp").value = w.opponent;
  renderActual();
  renderVersus(w.versus);
  renderBuilder();
  $("#wi-builder").hidden = false;
  renderEdits();
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
  const real = w.opponent === w.real_opponent;
  let note = real ? `Skor, haftalık kadro ve günlük kutu skorlarından yeniden hesaplandı.`
    : `Bu eşleşme gerçekte oynanmadı: iki takımın o haftaki gerçek istatistikleri karşılaştırılıyor. Gerçek rakip: <b>${esc(S.teamName[w.real_opponent] || "?")}</b>.`;
  if (real && w.official && w.official.score) {
    const o = w.official.score, r = w.result.score;
    const same = o.W === r.W && o.L === r.L && o.T === r.T;
    note += same
      ? ` <b class="pos">✓ Yahoo'nun resmi skoruyla aynı (${o.W}-${o.L}${o.T ? "-" + o.T : ""}).</b>`
      : ` <b class="neg">Yahoo'nun resmi skoru: ${o.W}-${o.L}${o.T ? "-" + o.T : ""}. Fark, eksik senkronize edilmiş günlerden ya da istatistik düzeltmelerinden olabilir.</b>`;
  }
  const title = `${w.week}. hafta · ${real ? "gerçek sonuç" : "bu rakibe karşı olsaydı"}`;
  $("#wi-actual").innerHTML = `<div class="card">${matchupTable(w.result, title)}<p class="muted small note">${note}</p></div>`;
}

// ---- "what if I had played someone else?" : this team's week vs every other team's week
function renderVersus(rows) {
  const w = S.wk;
  const hasHypo = rows.some((r) => r.hypothetical);
  const wins = (k) => rows.filter((r) => r[k] && r[k].result === "W").length;
  const pill = (x) => `<b class="${x.result === "W" ? "pos" : x.result === "L" ? "neg" : ""}">${scoreText(x)}</b> <span class="muted small">${RES[x.result]}</span>`;
  const body = rows.map((r) => `<tr class="rowlink ${r.team === w.opponent ? "selected" : ""}" data-team="${r.team}">
      <td><span class="pl-name">${esc(S.teamName[r.team])}</span>${r.team === w.real_opponent ? ' <span class="badge">gerçek rakip</span>' : ""}</td>
      <td>${pill(r.actual)}</td>${hasHypo ? `<td>${pill(r.hypothetical)}</td>` : ""}</tr>`).join("");
  $("#wi-versus").innerHTML = `<div class="card"><h3>Bu hafta başkasıyla oynasaydın</h3>
    <p class="muted small" style="margin:-4px 0 8px">${esc(S.teamName[w.team])} bu haftaki istatistikleriyle ligdeki ${rows.length} takımdan <b>${wins("actual")}</b> tanesini yenerdi${hasHypo ? `; senaryodaki dizilişle <b>${wins("hypothetical")}</b> tanesini` : ""}. Satıra tıklayınca o rakibe karşı ayrıntıyı görürsün.</p>
    <div class="table-wrap"><table><thead><tr><th>Rakip</th><th>Gerçek dizilişle</th>${hasHypo ? "<th>Senaryoyla</th>" : ""}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  document.querySelectorAll("#wi-versus tr.rowlink").forEach((tr) => tr.addEventListener("click", () => loadWeek(tr.dataset.team)));
}

// ---- daily lineup grid: click a cell to bench / start that player on that day
const dayEdit = (team, player, date) => S.edits.find((e) => e.team === team && e.player === player && e.dates?.[0] === date && e.type !== "swap");

function renderGrid() {
  const w = S.wk;
  const table = (team) => {
    const rows = Object.entries(w.grid[team] || {})
      .sort((a, b) => (w.usage[b[0]]?.active_games || 0) - (w.usage[a[0]]?.active_games || 0));
    const body = rows.map(([k, days]) => `<tr><td>${playerLabel(k)}</td>${w.dates.map((d) => {
      const c = days[d];
      if (!c) return `<td><span class="cell nogame" title="Kadroda değil">·</span></td>`;
      if (!c.played) return `<td><span class="cell nogame">–</span></td>`;
      const ed = dayEdit(team, k, d);
      const on = ed ? ed.type === "start" : c.active;
      return `<td><span class="cell click ${on ? "on" : "off"} ${ed ? "edited" : ""}" data-team="${team}" data-k="${k}" data-d="${d}" data-active="${c.active ? 1 : 0}"
        title="${on ? "Oynuyor" : "Yedekte"} (${esc(c.slot)}) · tıkla: ${on ? "oynatma" : "oynat"}">${c.pts ?? 0}</span></td>`;
    }).join("")}</tr>`).join("");
    return `<div class="grid-title">${esc(S.teamName[team])}</div>
      <div class="table-wrap"><table class="grid-table"><thead><tr><th>Oyuncu</th>${w.dates.map((d) => `<th>${dayLabel(d)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  };
  $("#wi-grid").innerHTML = table(w.team) + table(w.opponent) +
    `<div class="legend"><span><span class="cell on" style="display:inline-block;padding:0 8px;border-radius:9999px;background:var(--a);color:#fff">12</span> oynadı (aktif)</span>
     <span><span style="display:inline-block;padding:0 8px;border-radius:9999px;background:#e0e4e9">12</span> yedekte kaldı</span><span>Sarı çerçeve: senaryoda değiştirdiğin hücre</span></div>`;
  document.querySelectorAll("#wi-grid .cell.click").forEach((el) => el.addEventListener("click", () => {
    const { team, k, d } = el.dataset;
    const ed = dayEdit(team, k, d);
    if (ed) S.edits.splice(S.edits.indexOf(ed), 1);
    else S.edits.push({ team, type: el.dataset.active === "1" ? "bench" : "start", player: k, dates: [d] });
    renderEdits();
  }));
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
  const dropSwap = (t, o) => { S.edits = S.edits.filter((s) => !(s.type === "swap" && s.team === t && s.out === o)); };
  dropSwap(team, out);
  S.edits.push({ team, type: "swap", out, into });
  if ($("#wi-mutual").checked && w.usage[into]?.team === other) {
    dropSwap(other, into);
    S.edits.push({ team: other, type: "swap", out: into, into: out });
  }
  S.searchPick = null; $("#wi-search").value = ""; $("#wi-in").value = "";
  renderEdits();
});

function renderEdits() {
  renderGrid();
  const text = (s) => s.type === "swap" ? `${esc(pname(s.out))} → <b>${esc(pname(s.into))}</b>`
    : `<b>${esc(pname(s.player))}</b> · ${dayLong(s.dates[0])} ${s.type === "bench" ? "oynatma" : "oynat"}`;
  $("#wi-swaps").innerHTML = S.edits.map((s, i) =>
    `<span class="chip"><span class="muted small">${esc(S.teamName[s.team])}:</span> ${text(s)}<button data-i="${i}" title="Kaldır">×</button></span>`).join("")
    + (S.edits.length > 1 ? `<span class="chip" style="border-color:var(--line)"><a href="#" id="wi-clear">Hepsini temizle</a></span>` : "");
  document.querySelectorAll("#wi-swaps button").forEach((b) => b.addEventListener("click", () => {
    S.edits.splice(+b.dataset.i, 1);
    renderEdits();
  }));
  $("#wi-clear")?.addEventListener("click", (e) => { e.preventDefault(); S.edits = []; renderEdits(); });
  runWhatIf();
}

let wiSeq = 0;
async function runWhatIf() {
  const out = $("#wi-result");
  if (!S.edits.length) {
    out.innerHTML = "";
    if (S.wk) renderVersus(S.wk.versus);
    return;
  }
  const seq = ++wiSeq;
  out.style.opacity = 0.5;
  try {
    const r = await api("/api/whatif", { week: S.wk.week, team: S.wk.team, opponent: S.wk.opponent, edits: S.edits });
    Object.assign(S.players, r.info);
    if (seq === wiSeq) { renderWhatIf(r); renderVersus(r.versus); }
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  } finally {
    out.style.opacity = 1;
  }
}

function renderWhatIf(r) {
  const a = r.actual, h = r.hypothetical, isPts = r.scoring === "points";
  const verdict = r.flipped
    ? `<div class="verdict flip">Sonuç değişirdi: ${scoreText(a)} ${RES[a.result]} → <b>${scoreText(h)} ${RES[h.result]}</b></div>`
    : `<div class="verdict same">Sonuç değişmezdi: ${scoreText(a)} → ${scoreText(h)} (${RES[h.result]})</div>`;
  const warns = (r.warnings || []).map((x) =>
    `<div class="warn">⚠ ${dayLong(x.date)}: ${esc(S.teamName[x.team])} senaryoda ${x.played} oyuncu oynatıyor, aktif kadro ${x.slots} kişilik. Bu diziliş Yahoo'da mümkün olmazdı.</div>`).join("");

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

  $("#wi-result").innerHTML = `<div class="card"><h3>Senaryo sonucu</h3>${verdict}${warns}${table}
    <h3 style="margin-top:20px">Değişen oyuncuların aktif kadrodaki katkısı</h3>
    <div class="table-wrap"><table><thead><tr><th>Oyuncu</th><th></th><th>Maç</th>${cs.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${pRows}</tbody></table></div></div>`;
}

// ================================================================ DRAFT + TRANSFERS (filled in below)
async function loadDraft() {}
async function loadMoves() {}

init().catch((e) => {
  document.querySelector("main").innerHTML = `<div class="error">Başlatılamadı: ${esc(e.message)}</div>`;
});
