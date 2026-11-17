// Background service worker: runs the sync so it keeps going after the popup closes.
// State lives in chrome.storage.local "sync" = {running, msg, cls, started}; the popup just displays it.

const setState = (s) => chrome.storage.local.set({ sync: { ...s, at: Date.now() } });
let running = false;

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.type === "progress" && running) setState({ running: true, msg: m.msg });
  if (m.type === "start-sync") {
    if (running) { reply({ ok: false, error: "Senkron zaten çalışıyor." }); return; }
    sync(m.tabId, m.lid, m.server);
    reply({ ok: true });
  }
});

async function inTab(tabId, args) {
  // Chrome serializes this function's source only (no closures): everything comes in via args.
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (task, ...a) => {
      try { return await window.__takas[task](...a); } catch (e) { return { __error: String(e.message || e) }; }
    },
    args,
  });
  if (res?.result?.__error) throw new Error(res.result.__error);
  return res?.result;
}

async function post(server, body) {
  const r = await fetch(server + "/api/import", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Uygulama hatası (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

async function sync(tabId, lid, server) {
  running = true;
  const started = Date.now();
  await setState({ running: true, msg: "Başlıyor…", started });
  try {
    let have;
    try {
      have = await (await fetch(`${server}/api/import/status?league_id=${lid}`)).json();
    } catch {
      throw new Error(`Uygulamaya ulaşılamadı (${server}). Uygulama çalışıyor mu?`);
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ["scraper.js"] });

    const base = await inTab(tabId, ["base", lid]);
    await post(server, { kind: "base", data: base });

    // Re-read the last 2 days every time (Yahoo stat corrections); skip older days we already have.
    const cutoff = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const skip = new Set((have.dates || []).filter((d) => d < cutoff));
    const teamIds = base.teams.map((t) => t.id);
    let pages = 0;

    for (let w = 1; w <= base.current_week; w++) {
      const meta = await inTab(tabId, ["weekMeta", lid, w, base.my_team]);
      const { today, ...weekInfo } = meta;
      await post(server, { kind: "week", data: { ...weekInfo, days: {}, players: {} } });
      const todo = meta.dates.filter((d) => d < today && !skip.has(d));
      for (const [i, d] of todo.entries()) {
        const day = await inTab(tabId, ["day", lid, d, teamIds, `${w}/${base.current_week}. hafta · gün ${i + 1}/${todo.length} · `]);
        await post(server, { kind: "week", data: { ...weekInfo, days: { [d]: day.teams }, players: day.players } });
        pages += teamIds.length;
      }
    }
    const secs = Math.round((Date.now() - started) / 1000);
    await setState({ running: false, cls: "ok",
      msg: `Tamam: ${base.teams.length} takım, ${base.current_week} hafta (${pages} gün-sayfası, ${secs} sn).\nUygulamayı yenile.` });
  } catch (e) {
    await setState({ running: false, cls: "err", msg: "Hata: " + e.message });
  } finally {
    running = false;
  }
}
