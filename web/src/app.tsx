import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { loadLeague, setMyTeam, store } from "./store";
import { Draft } from "./tabs/Draft";
import { Moves } from "./tabs/Moves";
import { Power } from "./tabs/Power";
import { Standings } from "./tabs/Standings";
import { Trade } from "./tabs/Trade";
import { WhatIf } from "./tabs/WhatIf";

const TABS: { id: string; label: string; view: ComponentType }[] = [
  { id: "trade", label: "Takas Analizi", view: Trade },
  { id: "whatif", label: "Ya Olsaydı?", view: WhatIf },
  { id: "power", label: "Güç Sıralaması", view: Power },
  { id: "standings", label: "Puan Durumu", view: Standings },
  { id: "draft", label: "Draft", view: Draft },
  { id: "moves", label: "Transferler", view: Moves },
];
const fromHash = () => TABS.find((t) => t.id === location.hash.slice(1))?.id ?? "trade";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(fromHash);
  // a tab is mounted on first visit and then kept (hidden) so it does not reload or lose its state
  const [seen, setSeen] = useState<string[]>([fromHash()]);

  useEffect(() => {
    loadLeague().then(() => setReady(true)).catch((e) => setError(e.message));
    const onHash = () => open(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (id: string) => {
    setTab(id);
    setSeen((s) => (s.includes(id) ? s : [...s, id]));
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  };
  const lg = ready ? store.league : null;

  return (
    <>
      <header>
        <div class="topbar"><div class="brand-name">takas<span>masası</span></div></div>
        <nav>
          <span class="nav-label"><span class="ball" /> Fantasy Basketbol</span>
          {TABS.map((t) => <button key={t.id} class={`tab ${tab === t.id ? "active" : ""}`} onClick={() => open(t.id)}>{t.label}</button>)}
        </nav>
        <div id="league-name">
          {!lg ? (error ? "" : "Yükleniyor…") : <>
            <span>{lg.name} (ID# {lg.key})
              {lg.synced_at ? ` · veri: ${new Date(lg.synced_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}` : ""}</span>
            <label class="me-pick">Takımım
              <select value={lg.my_team} onChange={(e) => setMyTeam(e.currentTarget.value)}>
                {lg.teams.map((t) => <option value={t.key} key={t.key}>{t.name}</option>)}
              </select>
            </label>
          </>}
        </div>
      </header>
      <main>
        {error === "NO_DATA" ? <div class="card empty"><b>Henüz lig verisi yok.</b><br />Eklentiyle senkronize et, sonra bu sayfayı yenile.</div>
          : error ? <div class="error">Başlatılamadı: {error}</div>
          : ready && TABS.filter((t) => seen.includes(t.id)).map((t) => (
            <div key={t.id} class={tab === t.id ? "" : "hidden"}><t.view /></div>
          ))}
      </main>
      <footer class="muted small">Saf istatistik karşılaştırması: AI yorumu yok. z-skor referansı: tüm kadrolu oyuncuların sezon ortalaması.</footer>
    </>
  );
}
