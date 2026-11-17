// Background service worker: runs the sync so it keeps going after the popup closes.
//
// Robustness:
// - Pages are read one at a time and paced from here (timers in a hidden Yahoo tab
//   get throttled by Chrome; the worker's don't).
// - Each finished day is posted to the app right away, so nothing read is lost.
// - The job is kept in chrome.storage. If Chrome stops this worker mid-sync, a
//   watchdog alarm wakes it up within a minute and the job resumes; days the app
//   already has are skipped.
//
// chrome.storage.local:
//   sync = {running, msg, cls, at}     shown by the popup
//   job  = {tabId, lid, server, info}  the sync in progress (info = league basics once read)

const PAGE_DELAY_MS = 400;
const WATCHDOG = "takas-watchdog";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setState = (s) => chrome.storage.local.set({ sync: { ...s, at: Date.now() } });
let running = false;

chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m.type === "start-sync") {
    if (running) { reply({ ok: false, error: "Senkron zaten çalışıyor." }); return; }
    chrome.storage.local.set({ job: { tabId: m.tabId, lid: m.lid, server: m.server, info: null } })
      .then(() => run());
    reply({ ok: true });
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== WATCHDOG || running) return;
  const { job } = await chrome.storage.local.get("job");
  if (job) run(true);
  else chrome.alarms.clear(WATCHDOG);
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
  await sleep(PAGE_DELAY_MS);
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
  const { job } = await chrome.storage.local.get("job");
  const { tabId, lid, server } = job;
  const say = (msg) => setState({ running: true, msg: (resumed ? "(kaldığı yerden) " : "") + msg });

  try {
    try { await chrome.tabs.get(tabId); } catch { throw new Error("Yahoo sekmesi kapanmış. Ligini açıp tekrar başlat."); }
    let have;
    try {
      have = await (await fetch(`${server}/api/import/status?league_id=${lid}`)).json();
    } catch {
      throw new Error(`Uygulamaya ulaşılamadı (${server}). Uygulama çalışıyor mu?`);
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ["scraper.js"] });

    // 1) league basics, rosters and averages (skipped when resuming after it was done)
    let info = job.info;
    if (!info) {
      say("Lig ayarları okunuyor…");
      const li = await inTab(tabId, "leagueInfo", lid);
      const views = { season: li.season_view, last30: "AL30", last14: "AL14", last7: "AL7" };
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
      const { season_view, ...rest } = li;
      await post(server, { kind: "base",
        data: { ...rest, rosters, players, averages, synced_at: new Date().toISOString() } });
      info = { teams: li.teams.map((t) => t.id), my_team: li.my_team, current_week: li.current_week };
      await chrome.storage.local.set({ job: { ...job, info } });
    }

    // 2) every week, day by day
    const today = etDate(0), cutoff = etDate(-2);
    // re-read the last 2 days every time (Yahoo stat corrections)
    const skip = new Set((have.dates || []).filter((d) => d < cutoff));
    let pages = 0;
    for (let w = 1; w <= info.current_week; w++) {
      say(`${w}/${info.current_week}. hafta: eşleşmeler okunuyor…`);
      const meta = await inTab(tabId, "weekMeta", lid, w, info.my_team);
      const official = {};
      for (const [a, b] of meta.pairs) Object.assign(official, await inTab(tabId, "matchupTotals", lid, w, a, b));
      const weekInfo = { week: w, pairs: meta.pairs, dates: meta.dates, official };
      await post(server, { kind: "week", data: { ...weekInfo, days: {}, players: {} } });

      const todo = meta.dates.filter((d) => d < today && !skip.has(d));
      for (const [i, d] of todo.entries()) {
        const teams = {}, players = {};
        for (const [j, tid] of info.teams.entries()) {
          say(`${w}/${info.current_week}. hafta · gün ${i + 1}/${todo.length} (${d}) · takım ${j + 1}/${info.teams.length}`);
          const rows = await inTab(tabId, "teamDay", lid, d, tid);
          teams[tid] = rows.map((r) => {
            players[r.player.id] = { ...players[r.player.id], ...r.player };
            return { player: r.player.id, slot: r.slot, line: r.line };
          });
          pages++;
        }
        await post(server, { kind: "week", data: { ...weekInfo, days: { [d]: teams }, players } });
      }
    }

    await chrome.storage.local.remove("job");
    await chrome.alarms.clear(WATCHDOG);
    await setState({ running: false, cls: "ok",
      msg: `Tamam: ${info.teams.length} takım, ${info.current_week} hafta, ${pages} yeni gün-sayfası okundu.\nUygulamayı yenile.` });
  } catch (e) {
    await chrome.storage.local.remove("job");
    await chrome.alarms.clear(WATCHDOG);
    await setState({ running: false, cls: "err", msg: "Hata: " + e.message });
  } finally {
    clearInterval(keepAlive);
    running = false;
  }
}
