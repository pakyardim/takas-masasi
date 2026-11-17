const $ = (s) => document.querySelector(s);
const status = (msg, cls = "") => { $("#status").textContent = msg; $("#status").className = cls; };

let tab = null;

chrome.runtime.onMessage.addListener((m) => { if (m.type === "progress") status(m.msg); });

(async () => {
  const saved = await chrome.storage.local.get(["server", "lid"]);
  if (saved.server) $("#server").value = saved.server;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab?.url?.match(/^https:\/\/basketball\.fantasysports\.yahoo\.com\/nba\/(\d+)/);
  if (m) {
    $("#lid").value = m[1];
    $("#league").textContent = `Lig ${m[1]} algılandı.`;
  } else if (saved.lid) {
    $("#lid").value = saved.lid;
  }
  if (!tab?.url?.startsWith("https://basketball.fantasysports.yahoo.com/")) {
    $("#league").textContent = "Önce bir sekmede basketball.fantasysports.yahoo.com adresindeki ligini aç.";
    $("#sync").disabled = true;
  }
})();

async function inTab(func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  if (res?.result?.__error) throw new Error(res.result.__error);
  return res?.result;
}

async function post(path, body) {
  const r = await fetch($("#server").value.replace(/\/$/, "") + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Uygulama hatası (${r.status}): ${await r.text()}`);
  return r.json();
}

$("#open").addEventListener("click", () => chrome.tabs.create({ url: $("#server").value }));

$("#sync").addEventListener("click", async () => {
  const lid = $("#lid").value.trim();
  const server = $("#server").value.replace(/\/$/, "");
  if (!/^\d+$/.test(lid)) return status("Lig ID sayı olmalı.", "err");
  await chrome.storage.local.set({ server, lid });
  $("#sync").disabled = true;
  try {
    let have;
    try {
      have = await (await fetch(`${server}/api/import/status?league_id=${lid}`)).json();
    } catch {
      throw new Error(`Uygulamaya ulaşılamadı (${server}). Uygulama çalışıyor mu?`);
    }

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["scraper.js"] });
    // Runs inside the tab. Chrome serializes this function's source only (no closures),
    // so the task name must be passed as an argument.
    const call = async (task, ...a) => {
      try { return await window.__takas[task](...a); } catch (e) { return { __error: String(e.message || e) }; }
    };

    const base = await inTab(call, ["base", lid]);
    await post("/api/import", { kind: "base", data: base });

    // Re-read the last 2 days every time (Yahoo stat corrections), skip older days we already have.
    const cutoff = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const skip = (have.dates || []).filter((d) => d < cutoff);
    const teamIds = base.teams.map((t) => t.id);
    for (let w = 1; w <= base.current_week; w++) {
      const wk = await inTab(call, ["week", lid, w, base.my_team, teamIds, skip]);
      await post("/api/import", { kind: "week", data: wk });
    }
    status(`Tamam: ${base.teams.length} takım, ${base.current_week} hafta senkronize edildi.\nUygulamayı yenile.`, "ok");
  } catch (e) {
    status("Hata: " + e.message, "err");
  } finally {
    $("#sync").disabled = false;
  }
});
