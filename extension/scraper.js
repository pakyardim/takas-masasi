// Runs inside a basketball.fantasysports.yahoo.com tab (injected by popup.js).
// It only reads (GET) pages you can already see while signed in, parses them,
// and hands plain JSON back to the popup. It never clicks or submits anything.
(() => {
  if (window.__takas) return;

  const DELAY_MS = 450; // be gentle with Yahoo
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = 0;

  async function get(path) {
    const wait = last + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(path, { credentials: "include" });
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.querySelector('form[action*="login.yahoo.com"]') || r.url.includes("login.yahoo.com")) {
      throw new Error("Yahoo oturumu kapalı. Yahoo'ya giriş yapıp tekrar dene.");
    }
    return doc;
  }

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const progress = (msg) => { try { chrome.runtime.sendMessage({ type: "progress", msg }); } catch {} };

  // ------------------------------------------------------------ table parsing
  const STAT_COLS = {
    "FGM/A": ["FGM", "FGA"], "FTM/A": ["FTM", "FTA"], "3PTM/A": ["3PTM", "3PTA"],
    "3PTM": "3PTM", PTS: "PTS", REB: "REB", OREB: "OREB", DREB: "DREB", AST: "AST", ST: "ST",
    BLK: "BLK", TO: "TO", "GP": "GP", "MIN": "MIN", "MPG": "MIN", "A/T": null, "DD": "DD", "TD": "TD",
  };

  function headerMap(table) {
    const hdr = [...table.rows].find((r) => [...r.cells].some((c) => /^Players?$/.test(clean(c.innerText))));
    if (!hdr) return null;
    // map header label -> visual column index (colspan-aware: other managers'
    // pages have a 2-column "Action" header)
    const map = {};
    let col = 0;
    for (const c of hdr.cells) {
      const t = clean(c.innerText).replace(/\*$/, "");
      if (/^Players?$/.test(t)) map.player = col;
      else if (t === "Pos") map.pos = map.pos ?? col;
      else if (t in STAT_COLS && STAT_COLS[t]) map[t] = col;
      col += c.colSpan || 1;
    }
    return { row: hdr, map };
  }

  /** cell at a visual column index, honoring colspans */
  function cellAt(row, idx) {
    let col = 0;
    for (const c of row.cells) {
      if (col === idx) return c;
      col += c.colSpan || 1;
      if (col > idx) return null;
    }
    return null;
  }

  function num(s) {
    s = clean(s);
    if (!s || s === "-") return null;
    if (/^\d+:\d+$/.test(s)) { const [m, sec] = s.split(":"); return +m + sec / 60; }
    const v = parseFloat(s.replace(/^\./, "0."));
    return Number.isFinite(v) ? v : null;
  }

  function parsePlayerCell(cell) {
    const a = cell.querySelector("a[data-ys-playerid]");
    if (!a) return null;
    // "UTA - PG,SG" (the injury tag also uses .Fz-xxs, so match on the " - ")
    const teamPos = [...cell.querySelectorAll(".Fz-xxs")].map((e) => clean(e.innerText)).find((t) => / - /.test(t)) || "";
    const [nba_team, pos] = teamPos.split(" - ");
    return {
      id: a.dataset.ysPlayerid,
      name: clean(a.innerText),
      nba_team: clean(nba_team),
      positions: (pos || "").split(",").map(clean).filter(Boolean),
      status: clean(cell.querySelector(".F-injury")?.innerText),
    };
  }

  /** Parse a roster-style stats table -> [{player, slot, line}] */
  function parseRosterTable(doc) {
    const out = [];
    for (const table of doc.querySelectorAll("table")) {
      const h = headerMap(table);
      if (!h || h.map.player == null) continue;
      let after = false;
      for (const row of table.rows) {
        if (row === h.row) { after = true; continue; }
        if (!after) continue;
        const pc = cellAt(row, h.map.player);
        const player = pc && parsePlayerCell(pc);
        if (!player) continue;
        const slot = row.querySelector("[data-pos]")?.dataset.pos || clean(cellAt(row, h.map.pos ?? 0)?.innerText) || "BN";
        const line = {};
        let any = false;
        for (const [col, idx] of Object.entries(h.map)) {
          if (!(col in STAT_COLS) || idx == null) continue;
          const txt = clean(cellAt(row, idx)?.innerText);
          const target = STAT_COLS[col];
          if (Array.isArray(target)) {
            const [m, a] = txt.split("/");
            const vm = num(m), va = num(a);
            if (vm != null && va != null) { line[target[0]] = vm; line[target[1]] = va; any = true; }
          } else {
            const v = num(txt);
            if (v != null) { line[target] = v; if (target !== "GP") any = true; }
          }
        }
        out.push({ player, slot: slot === "Util" ? "UTIL" : slot, line: any ? line : null });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ pages
  async function settings(lid) {
    const doc = await get(`/nba/${lid}/settings`);
    const kv = {};
    doc.querySelectorAll("table tr").forEach((tr) => {
      if (tr.cells.length >= 2) kv[clean(tr.cells[0].innerText).replace(/:$/, "")] = clean(tr.cells[1].innerText);
    });
    const cats = [...(kv["Players Stat Categories"] || "").matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
    return {
      name: kv["League Name"],
      scoring_type: kv["Scoring Type"],
      roster_positions: (kv["Roster Positions"] || "").split(",").map(clean),
      categories: cats,
    };
  }

  async function teams(lid) {
    const doc = await get(`/nba/${lid}/teams`);
    const seen = {};
    let my = null;
    doc.querySelectorAll("a").forEach((a) => {
      const m = (a.getAttribute("href") || "").match(new RegExp(`/nba/${lid}/(\\d+)$`));
      const t = clean(a.innerText);
      if (!m || !t) return;
      if (t === "My Team") { my = m[1]; return; }
      seen[m[1]] = seen[m[1]] || t;
    });
    return { teams: Object.entries(seen).map(([id, name]) => ({ id, name })), my_team: my };
  }

  async function weekInfo(lid, week, myTeam) {
    const home = await get(`/nba/${lid}?matchup_week=${week}&module=matchups&lhst=matchups`);
    const pairs = [...new Set([...home.querySelectorAll('a[href*="matchup?week="]')].map((a) => a.getAttribute("href")))]
      .map((h) => new URL(h, location.origin))
      .filter((u) => u.searchParams.get("week") == week)
      .map((u) => [u.searchParams.get("mid1"), u.searchParams.get("mid2")])
      .filter(([a, b]) => a && b);
    const m = await get(`/nba/${lid}/matchup?week=${week}&mid1=${myTeam}`);
    const dates = [...new Set([...m.querySelectorAll("a, option")]
      .map((a) => a.getAttribute("href") || a.value || "")
      .map((h) => (h.match(/[?&]week=(\d+)&date=(\d{4}-\d{2}-\d{2})/) || []))
      .filter((x) => x[1] == week).map((x) => x[2]))].sort();
    return { week, pairs: dedupePairs(pairs), dates };
  }
  function dedupePairs(pairs) {
    const seen = new Set();
    return pairs.filter(([a, b]) => { const k = [a, b].sort().join("-"); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function officialTotals(lid, week, a, b) {
    const doc = await get(`/nba/${lid}/matchup?week=${week}&mid1=${a}&mid2=${b}`);
    for (const table of doc.querySelectorAll("table")) {
      const hdr = table.rows[0];
      if (!hdr || clean(hdr.cells[0]?.innerText) !== "Team") continue;
      const cols = [...hdr.cells].map((c) => clean(c.innerText).replace(/\*$/, ""));
      const rows = [...table.rows].slice(1, 3).map((r) => {
        const line = {};
        cols.forEach((c, i) => {
          const t = clean(r.cells[i]?.innerText);
          if (Array.isArray(STAT_COLS[c])) { const [x, y] = t.split("/"); line[STAT_COLS[c][0]] = num(x); line[STAT_COLS[c][1]] = num(y); }
          else if (STAT_COLS[c]) line[STAT_COLS[c]] = num(t);
        });
        return line;
      });
      return { [a]: rows[0], [b]: rows[1] };
    }
    return null;
  }

  const AVG_VIEWS = { season: null, last30: "AL30", last14: "AL14", last7: "AL7" };

  // ------------------------------------------------------------ public tasks
  async function base(lid) {
    progress("Lig ayarları okunuyor…");
    const s = await settings(lid);
    const t = await teams(lid);
    const home = await get(`/nba/${lid}`);
    const cur = Math.max(1, ...[...home.querySelectorAll('a[href*="matchup?week="]')]
      .map((a) => +(a.getAttribute("href").match(/week=(\d+)/) || [])[1] || 0));
    const seasonView = [...home.querySelectorAll("a, option")]
      .map((a) => (a.getAttribute("href") || a.value || "").match(/stat2=AS_(\d{4})/)).find(Boolean);
    const seasonCode = seasonView ? `AS_${seasonView[1]}` : `AS_${new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1}`;
    AVG_VIEWS.season = seasonCode;

    const rosters = {}, players = {}, averages = { season: {}, last30: {}, last14: {}, last7: {} };
    for (const [i, team] of t.teams.entries()) {
      for (const [period, view] of Object.entries(AVG_VIEWS)) {
        progress(`Kadro ve ortalamalar: ${team.name} (${i + 1}/${t.teams.length}) · ${period}`);
        const doc = await get(`/nba/${lid}/${team.id}?stat1=AS&stat2=${view}`);
        const rows = parseRosterTable(doc);
        if (period === "season") rosters[team.id] = rows.map((r) => r.player.id);
        for (const r of rows) {
          players[r.player.id] = { ...r.player, owner: team.id };
          averages[period][r.player.id] = r.line || { GP: 0 };
        }
      }
    }
    return { league_id: lid, ...s, ...t, current_week: cur, rosters, players, averages, synced_at: new Date().toISOString() };
  }

  async function week(lid, w, myTeam, teamIds, skipDates = []) {
    progress(`${w}. hafta: eşleşmeler okunuyor…`);
    const info = await weekInfo(lid, w, myTeam);
    const official = {};
    for (const [a, b] of info.pairs) Object.assign(official, (await officialTotals(lid, w, a, b)) || {});
    // Yahoo game dates are US Eastern
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const days = {}, players = {};
    const todo = info.dates.filter((d) => d < today && !skipDates.includes(d));
    for (const [n, d] of todo.entries()) {
      days[d] = {};
      for (const [i, tid] of teamIds.entries()) {
        progress(`${w}. hafta · ${d} (${n + 1}/${todo.length}) · takım ${i + 1}/${teamIds.length}`);
        const doc = await get(`/nba/${lid}/${tid}?date=${d}`);
        days[d][tid] = parseRosterTable(doc).map((r) => {
          players[r.player.id] = { ...players[r.player.id], ...r.player };
          // 0 minutes = did not play
          const line = r.line && r.line.MIN === 0 ? null : r.line;
          return { player: r.player.id, slot: r.slot, line };
        });
      }
    }
    return { week: w, pairs: info.pairs, dates: info.dates, official, days, players };
  }

  window.__takas = { base, week, parseRosterTable, get };
})();
