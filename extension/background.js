// Background service worker: runs the sync so it keeps going after the popup closes.
//
// What is read, and when:
// - League basics (3 pages): every sync.
// - Rosters + averages (4 pages per team): only if the last read is older than
//   ROSTER_MAX_AGE_H hours, or the user ticked "refresh rosters".
// - A week's pairings + official totals (7 pages): skipped once the week is "final"
//   (it ended more than 2 days ago and everything about it is stored).
// - A day's lineups + box scores (1 page per team): read once. Only the last 2 days
//   are re-read, because Yahoo applies stat corrections to them.
//
// Robustness:
// - Pages are read one at a time and paced from here (timers in a hidden Yahoo tab
//   get throttled by Chrome; the worker's don't).
// - Each finished day is posted to the app right away, so nothing read is lost.
// - Yahoo rate limit (HTTP 999): the sync pauses for a few minutes and resumes by itself.
// - The job is kept in chrome.storage. If Chrome stops this worker mid-sync, a
//   watchdog alarm wakes it within a minute and the job resumes where it was.
//
// chrome.storage.local:
//   sync = {running, msg, cls, at}   shown by the popup
//   job  = {tabId, lid, server, force, info, rl, pauseUntil}

const PAGE_DELAY_MS = 1200;          // + up to 600 ms jitter between Yahoo pages
const ROSTER_MAX_AGE_H = 6;
const RATE_LIMIT_WAITS_MIN = [3, 6, 12, 20];
const WATCHDOG = "takas-watchdog";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setState = (s) => chrome.storage.local.set({ sync: { ...s, at: Date.now() } });
const getJob = async () => (await chrome.storage.local.get("job")).job;
const patchJob = async (patch) => { const job = await getJob(); if (job) await chrome.storage.local.set({ job: { ...job, ...patch } }); };
let running = false;

chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m.type === "start-sync") {
    if (running) { reply({ ok: false, error: "Senkron zaten çalışıyor." }); return; }
    chrome.storage.local.set({ job: { tabId: m.tabId, lid: m.lid, server: m.server, force: !!m.force, info: null, rl: 0 } })
      .then(() => run());
    reply({ ok: true });
  }
  if (m.type === "cancel-sync") {
    chrome.storage.local.remove("job").then(() => chrome.alarms.clear(WATCHDOG))
      .then(() => setState({ running: false, msg: "Senkron durduruldu. Okunan günler korunuyor." }));
    reply({ ok: true });
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== WATCHDOG || running) return;
  const job = await getJob();
  if (!job) { chrome.alarms.clear(WATCHDOG); return; }
  if (job.pauseUntil && Date.now() < job.pauseUntil) {
    const mins = Math.ceil((job.pauseUntil - Date.now()) / 60000);
    setState({ running: true, msg: `Yahoo hız sınırı koydu (HTTP 999). ~${mins} dk sonra kaldığı yerden devam edecek…` });
    return;
  }
  run(true);
});

// ------------------------------------------------------------------ helpers

async function inTab(tabId, task, ...args) {
  const exec = async () => {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      // Serialized without closures: everything comes in via args.
      func: async (t, ...a) => {
        if (!window.__takas) return { __error: "NOT_INJECTED" };
        try { return await window.__takas[t](...a); } catch (e) { return { __error: String(e.message || e) }; }
      },
      args: [task, ...args],
    });
    return res?.result;
  };
  let out = await exec();
  if (out?.__error === "NOT_INJECTED") {        // tab was reloaded/navigated since injection
    await chrome.scripting.executeScript({ target: { tabId }, files: ["scraper.js"] });
    out = await exec();
  }
  if (out?.__error) throw new Error(out.__error);
  await sleep(PAGE_DELAY_MS + Math.random() * 600);
  return out;
}

async function post(server, body) {
  const r = await fetch(server + "/api/import", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Uygulama hatası (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

// Yahoo game dates are US Eastern
const etDate = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// ------------------------------------------------------------------ the sync

async function run(resumed = false) {
  if (running) return;
  running = true;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);
  chrome.alarms.create(WATCHDOG, { periodInMinutes: 1 });
  const job = await getJob();
  const { tabId, lid, server } = job;
  const say = (msg) => setState({ running: true, msg: (resumed ? "(kaldığı yerden) " : "") + msg });
  const stats = { pages: 0, skippedWeeks: 0, skippedDays: 0, rosters: false };

  try {
    await patchJob({ pauseUntil: null });
    try { await chrome.tabs.get(tabId); } catch { throw new Error("Yahoo sekmesi kapanmış. Ligini açıp tekrar başlat."); }
    let have;
    try {
      have = await (await fetch(`${server}/api/import/status?league_id=${lid}`)).json();
    } catch {
      throw new Error(`Uygulamaya ulaşılamadı (${server}). Uygulama çalışıyor mu?`);
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ["scraper.js"] });

    // 1) league basics; rosters + averages only when stale
    let info = job.info;
    if (!info) {
      say("Lig ayarları okunuyor…");
      const li = await inTab(tabId, "leagueInfo", lid);
      const { season_view, ...basics } = li;
      const ageH = have.synced_at ? (Date.now() - Date.parse(have.synced_at)) / 36e5 : Infinity;
      if (job.force || ageH > ROSTER_MAX_AGE_H) {
        const views = { season: season_view, last30: "AL30", last14: "AL14", last7: "AL7" };
        const rosters = {}, players = {}, averages = { season: {}, last30: {}, last14: {}, last7: {} };
        for (const [i, team] of li.teams.entries()) {
          for (const [period, view] of Object.entries(views)) {
            say(`Kadro ve ortalamalar: ${team.name} (${i + 1}/${li.teams.length}) · ${period}`);
            const rows = await inTab(tabId, "teamAverages", lid, team.id, view);
            if (period === "season") rosters[team.id] = rows.map((r) => r.player.id);
            for (const r of rows) {
              players[r.player.id] = { ...r.player, owner: team.id };
              averages[period][r.player.id] = r.line || { GP: 0 };
            }
          }
        }
        await post(server, { kind: "base",
          data: { ...basics, rosters, players, averages, synced_at: new Date().toISOString() } });
        stats.rosters = true;
      } else {
        await post(server, { kind: "meta", data: basics });
      }
      info = { teams: li.teams.map((t) => t.id), my_team: li.my_team, current_week: li.current_week };
      await patchJob({ info });
    }

    // 2) weeks, day by day
    const today = etDate(0), cutoff = etDate(-2);
    const haveDates = new Set(have.dates || []);
    const finalWeeks = new Set(have.final_weeks || []);
    for (let w = 1; w <= info.current_week; w++) {
      if (finalWeeks.has(w)) { stats.skippedWeeks++; continue; }
      say(`${w}/${info.current_week}. hafta: eşleşmeler okunuyor…`);
      const meta = await inTab(tabId, "weekMeta", lid, w, info.my_team);
      const official = {};
      for (const [a, b] of meta.pairs) Object.assign(official, await inTab(tabId, "matchupTotals", lid, w, a, b));
      // final: the week (and Yahoo's correction window) is over, so these totals won't change
      const final = meta.dates.length > 0 && meta.dates.every((d) => d < cutoff);
      const weekInfo = { week: w, pairs: meta.pairs, dates: meta.dates, official, final };
      await post(server, { kind: "week", data: { ...weekInfo, days: {}, players: {} } });

      const past = meta.dates.filter((d) => d < today);
      // keep stored days, except the last 2 (stat corrections)
      const todo = past.filter((d) => !(haveDates.has(d) && d < cutoff));
      stats.skippedDays += past.length - todo.length;
      for (const [i, d] of todo.entries()) {
        const teams = {}, players = {};
        for (const [j, tid] of info.teams.entries()) {
          say(`${w}/${info.current_week}. hafta · gün ${i + 1}/${todo.length} (${d}) · takım ${j + 1}/${info.teams.length}`);
          const rows = await inTab(tabId, "teamDay", lid, d, tid);
          teams[tid] = rows.map((r) => {
            players[r.player.id] = { ...players[r.player.id], ...r.player };
            return { player: r.player.id, slot: r.slot, line: r.line };
          });
          stats.pages++;
        }
        await post(server, { kind: "week", data: { ...weekInfo, days: { [d]: teams }, players } });
        haveDates.add(d);
        await patchJob({ rl: 0 });
      }
    }

    await chrome.storage.local.remove("job");
    await chrome.alarms.clear(WATCHDOG);
    await setState({ running: false, cls: "ok", msg:
      `Tamam. Okunan: ${stats.pages / info.teams.length} gün${stats.rosters ? ", kadrolar ve ortalamalar" : ""}.\n` +
      `Atlanan (zaten kayıtlı): ${stats.skippedWeeks} bitmiş hafta, ${stats.skippedDays} gün` +
      `${stats.rosters ? "" : `, kadrolar (son ${ROSTER_MAX_AGE_H} saatte okunmuş)`}.\nUygulamayı yenile.` });
  } catch (e) {
    if (String(e.message).includes("RATE_LIMIT")) {
      const cur = await getJob();
      const n = (cur?.rl || 0) + 1;
      if (cur && n <= RATE_LIMIT_WAITS_MIN.length) {
        const mins = RATE_LIMIT_WAITS_MIN[n - 1];
        await patchJob({ rl: n, pauseUntil: Date.now() + mins * 60000 });
        await setState({ running: true,
          msg: `Yahoo hız sınırı koydu (HTTP 999). ${mins} dk beklenip kaldığı yerden devam edilecek. Okunan günler kayıtlı.` });
        return;                                   // the watchdog alarm resumes the job
      }
      e = new Error("Yahoo hız sınırı kalkmadı. Okunan günler kayıtlı; bir saat sonra tekrar dene.");
    }
    await chrome.storage.local.remove("job");
    await chrome.alarms.clear(WATCHDOG);
    await setState({ running: false, cls: "err", msg: "Hata: " + e.message });
  } finally {
    clearInterval(keepAlive);
    running = false;
  }
}
