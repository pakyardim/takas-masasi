// Popup: collects settings and shows progress. The sync itself runs in background.js,
// so closing this popup does not stop it.
const $ = (s) => document.querySelector(s);
let tab = null;

function show(state) {
  if (!state) return;
  const stale = state.running && Date.now() - (state.at || 0) > 180_000;
  $("#status").textContent = stale ? "Senkron 3 dakikadır ilerlemiyor; tekrar başlatabilirsin (okunan günler korunur)." : state.msg || "";
  $("#status").className = state.cls || "";
  $("#sync").disabled = !!state.running && !stale || !onYahoo();
  $("#sync").textContent = state.running && !stale ? "Senkronize ediliyor…" : "Senkronize et";
}
const onYahoo = () => !!tab?.url?.startsWith("https://basketball.fantasysports.yahoo.com/");

chrome.storage.onChanged.addListener((c) => { if (c.sync) show(c.sync.newValue); });

(async () => {
  const saved = await chrome.storage.local.get(["server", "lid", "sync"]);
  if (saved.server) $("#server").value = saved.server;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab?.url?.match(/^https:\/\/basketball\.fantasysports\.yahoo\.com\/nba\/(\d+)/);
  if (m) {
    $("#lid").value = m[1];
    $("#league").textContent = `Lig ${m[1]} algılandı.`;
  } else if (saved.lid) {
    $("#lid").value = saved.lid;
  }
  if (!onYahoo()) {
    $("#league").textContent = "Önce bir sekmede basketball.fantasysports.yahoo.com adresindeki ligini aç.";
  }
  show(saved.sync || { running: false });
})();

$("#open").addEventListener("click", () => chrome.tabs.create({ url: $("#server").value }));

$("#sync").addEventListener("click", async () => {
  const lid = $("#lid").value.trim();
  const server = $("#server").value.trim().replace(/\/$/, "");
  if (!/^\d+$/.test(lid)) return show({ msg: "Lig ID sayı olmalı.", cls: "err" });
  await chrome.storage.local.set({ server, lid });
  const r = await chrome.runtime.sendMessage({ type: "start-sync", tabId: tab.id, lid, server });
  if (!r?.ok) show({ msg: r?.error || "Başlatılamadı.", cls: "err" });
});
