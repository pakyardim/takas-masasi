// What goes on each tab's poster. Each function turns a report into a PosterSpec and draws it.
import { drawPoster, TONE, type Cell, type PCell, type PSection } from "./poster";
import { loadLogos } from "./share";
import { catByKey, dayLong, fmt, num, pct, pname, rec, RES, scoreText, signed, store } from "./store";
import type { DraftPick, DraftReport, Edit, InjuryReport, MovesReport, Power, Standings, StandingsTeam, WeekData, WhatIfResult } from "./types";

const allLogos = () => loadLogos(store.league.teams.map((t) => t.key));
const tone = (v: number, eps = 0.0001) => (v > eps ? TONE.good : v < -eps ? TONE.bad : undefined);
const val = (v: number, d = 1): PCell => ({ text: signed(v, d), color: tone(v), bold: true });
const team = (key: string | null | undefined, name?: string): Cell => (key ? { team: key, text: name ?? store.teamName[key] } : name ?? "–");
const player = (k: string, name?: string): PCell => {
  const p = store.players[k];
  return { text: name ?? p?.name ?? k, bold: true, sub: p ? [p.nba_team, (p.positions || []).join(",")].filter(Boolean).join(" - ") : undefined };
};
const short = (name: string) => (name.length > 11 ? name.slice(0, 10).trimEnd() + "…" : name);
const trend = (d: number): PCell => (d > 0 ? { text: `▲${d}`, color: TONE.good, bold: true } : d < 0 ? { text: `▼${-d}`, color: TONE.bad, bold: true } : { text: "·", color: TONE.muted });

// ---------------------------------------------------------------- power rankings
export async function powerPoster(r: Power) {
  const w = r.weights;
  return drawPoster({
    title: "Güç Sıralaması", width: 1280,
    subtitle: `${r.weeks.length} tamamlanmış hafta · %${w.allplay * 100} herkese karşı + %${w.form * 100} form + %${w.roster * 100} kadro gücü`,
    sections: [{
      columns: [
        { label: "#", w: 0.6, align: "c" }, { label: "", w: 0.6, align: "c" }, { label: "Takım", w: 3.4, align: "l" },
        { label: "Güç", w: 1.1 }, { label: "Herkese karşı", w: 1.9 }, { label: "Form", w: 0.9 }, { label: "Kadro gücü", w: 1.3 },
        { label: "Gerçek rekor", w: 1.7 }, { label: "Şans", w: 0.9 }, { label: "Yeneceği rakip", w: 1.5 },
      ],
      rows: r.teams.map((t) => [
        { pill: true, text: String(t.rank) },
        t.prev_rank == null ? { text: "·", color: TONE.muted } : trend(t.prev_rank - t.rank),
        team(t.team),
        { text: t.power.toFixed(1), bold: true, bar: t.power },
        { text: rec(t.allplay), sub: pct(t.allplay_pct) },
        pct(t.form_pct),
        { text: signed(t.roster, 1) },
        { text: rec(t.record), sub: `${t.standing}. sırada` },
        { text: `${t.luck > 0 ? "+" : ""}${Math.round(t.luck * 100)}`, color: tone(t.luck, 0.03), bold: true },
        `${t.beat}/${t.beat_of}`,
      ]),
    }],
    footer: "Herkese karşı: her hafta tüm ligle oynansa kazanılacak kategori oranı · Şans: gerçek oran eksi herkese karşı oran",
  }, await allLogos());
}

// ---------------------------------------------------------------- standings in four formats
export async function standingsPoster(r: Standings, order: StandingsTeam[]) {
  const cats = store.league.categories;
  const delta = (rank: number, base: number) => {
    const d = base - rank;
    return d > 0 ? { sub: `▲${d} gerçeğe göre`, subColor: TONE.good } : d < 0 ? { sub: `▼${-d} gerçeğe göre`, subColor: TONE.bad } : { sub: "aynı sıra" };
  };
  const shade = (p: number) => `rgba(0, 99, 235, ${(0.05 + (0.3 * (p - 1)) / Math.max(1, r.n - 1)).toFixed(3)})`;
  const main: PSection = {
    heading: "Dört formatta sıralama",
    columns: [{ label: "Takım", w: 3.2, align: "l" }, { label: "H2H Kategori (gerçek)", w: 2 }, { label: "H2H Tek Galibiyet", w: 2 }, { label: "Rotisserie", w: 2 }, { label: "Puan ligi", w: 2 }],
    rows: order.map((t) => [
      team(t.team),
      { text: `${t.h2h.rank}.   ${rec(t.h2h.record)}`, bold: true, sub: "ligin formatı" },
      { text: `${t.one_win.rank}.   ${rec(t.one_win.record)}`, bold: true, ...delta(t.one_win.rank, t.h2h.rank) },
      { text: `${t.roto.rank}.   ${num(t.roto.points, 1)} p`, bold: true, ...delta(t.roto.rank, t.h2h.rank) },
      { text: `${t.points.rank}.   ${num(t.points.total)}`, bold: true, ...delta(t.points.rank, t.h2h.rank) },
    ]),
  };
  const roto: PSection = {
    heading: "Rotisserie ayrıntısı",
    note: `Büyük sayı: kategoriden alınan puan (${r.n} = ligin en iyisi). Küçük sayı: sezon toplamı.`,
    columns: [{ label: "#", w: 0.6, align: "c" }, { label: "Takım", w: 3.2, align: "l" },
      ...cats.map((c) => ({ label: c.label, w: 1, align: "c" as const })), { label: "Toplam", w: 1.1 }],
    rows: [...r.teams].sort((a, b) => a.roto.rank - b.roto.rank).map((t) => [
      { pill: true, text: String(t.roto.rank) }, team(t.team),
      ...cats.map((c): Cell => {
        const x = t.roto.cats[c.key];
        return { text: num(x.points, x.points % 1 ? 1 : 0), bold: true, sub: fmt(c.key, x.value, "total"), bg: shade(x.points) };
      }),
      { text: num(t.roto.points, 1), bold: true },
    ]),
  };
  return drawPoster({
    title: "Puan Durumu", width: 1280,
    subtitle: "Aynı sezon, başka lig formatlarında nasıl görünürdü?",
    sections: [main, roto],
    footer: `Rekorlar tamamlanmış ${r.weeks_done.length} haftadan · sezon toplamları ${dayLong(r.last_day)} gününe kadar`,
  }, await allLogos());
}

// ---------------------------------------------------------------- draft
export async function draftPoster(r: DraftReport, teamFilter: string) {
  const pickRow = (p: DraftPick): Cell[] => [
    { text: `#${p.overall}`, sub: `${p.round}. tur`, bold: true }, player(p.player.key, p.player.name), team(p.team, p.team_name),
    String(p.gp || 0), p.known ? val(p.value) : { text: "veri yok", color: TONE.muted }, p.rank ? `${p.rank}.` : "–", val(p.surplus),
  ];
  const pickCols = [{ label: "Seçim", w: 1, align: "l" as const }, { label: "Oyuncu", w: 3, align: "l" as const }, { label: "Seçen", w: 3, align: "l" as const },
    { label: "Maç", w: 0.8 }, { label: "Değer", w: 1.1 }, { label: "Değer sırası", w: 1.3 }, { label: "Beklenene göre", w: 1.5 }];
  const brief = (p: DraftPick | null): Cell => (p ? { text: p.player.name, sub: `#${p.overall} · ${signed(p.surplus, 1)}` } : "–");
  const sections: PSection[] = [{
    heading: "En iyi draft",
    columns: [{ label: "#", w: 0.6, align: "c" }, { label: "Takım", w: 3.2, align: "l" }, { label: "Toplam değer", w: 1.5 }, { label: "Beklenene göre", w: 1.6 },
      { label: "Hâlâ kadroda", w: 1.4 }, { label: "En iyi seçim", w: 2.4, align: "l" }, { label: "En kötü seçim", w: 2.4, align: "l" }],
    rows: r.teams.map((t, i) => [{ pill: true, text: String(i + 1) }, team(t.team, t.name), val(t.total), val(t.surplus), `${t.kept}/${t.picks}`, brief(t.best), brief(t.worst)]),
  }];
  const mine = teamFilter ? r.picks.filter((p) => (p.team || p.team_name) === teamFilter) : [];
  if (mine.length) {
    sections.push({ heading: `${mine[0].team_name}: seçimler`, columns: pickCols, rows: mine.map(pickRow) });
  } else {
    const played = r.picks.filter((p) => p.gp > 0);
    sections.push({ heading: "En isabetli 8 seçim", columns: pickCols, rows: [...played].sort((a, b) => b.surplus - a.surplus).slice(0, 8).map(pickRow) });
    sections.push({ heading: "En çok hayal kırıklığı yaratan 8 seçim", columns: pickCols, rows: [...r.picks].sort((a, b) => a.surplus - b.surplus).slice(0, 8).map(pickRow) });
  }
  return drawPoster({
    title: "Draft Karnesi", width: 1280,
    subtitle: "Her seçimin bugüne kadarki değeri: kim iyi draft yaptı?",
    sections,
    footer: "Değer: maç başı z-skor eksi yedek seviyesi, çarpı maç · beklenene göre: o draft sırasının ortalamasına göre fark",
  }, await allLogos());
}

// ---------------------------------------------------------------- transfers
export async function movesPoster(r: MovesReport) {
  const sections: PSection[] = [{
    heading: "Takımların serbest oyuncu hamleleri",
    columns: [{ label: "#", w: 0.6, align: "c" }, { label: "Takım", w: 3.4, align: "l" }, { label: "Ekleme", w: 1 }, { label: "Toplam değer", w: 1.5 }, { label: "En iyi ekleme", w: 3, align: "l" }],
    rows: r.teams.map((t, i) => [{ pill: true, text: String(i + 1) }, team(t.team, t.name), String(t.adds), val(t.value),
      t.best ? { text: t.best.player.name, sub: `${dayLong(t.best.date)} · ${signed(t.best.value, 1)}` } : "–"]),
  }, {
    heading: "En iyi 10 ekleme",
    columns: [{ label: "#", w: 0.6, align: "c" }, { label: "Oyuncu", w: 3, align: "l" }, { label: "Ekleyen", w: 3, align: "l" }, { label: "Tarih", w: 1.1 },
      { label: "Aktif maç", w: 1.1 }, { label: "Değer", w: 1.1 }, { label: "Durum", w: 1.6 }],
    rows: r.pickups.slice(0, 10).map((x, i) => [{ pill: true, text: String(i + 1) }, player(x.player.key, x.player.name), team(x.team, x.team_name), dayLong(x.date),
      String(x.active_games), val(x.value), x.ongoing ? "kadroda" : { text: x.last ? `${dayLong(x.last)}'e kadar` : "hiç oynamadı", color: TONE.muted }]),
  }];
  if (r.trades.length) {
    sections.push({
      heading: "Takaslar",
      columns: [{ label: "Tarih", w: 1, align: "l" }, { label: "Taraf 1", w: 3.2, align: "l" }, { label: "Değer", w: 1 }, { label: "Taraf 2", w: 3.2, align: "l" }, { label: "Değer", w: 1 }, { label: "Önde", w: 2.2, align: "l" }],
      rows: r.trades.map((t) => {
        const [a, b] = t.sides;
        const side = (s: (typeof t.sides)[number] | undefined): Cell[] => s
          ? [{ team: s.team, text: s.name, sub: "aldı: " + s.players.map((x) => x.player.name).join(", ") }, val(s.value)] : ["–", "–"];
        const diff = a && b ? a.value - b.value : 0;
        return [dayLong(t.date), ...side(a), ...side(b), a && b && Math.abs(diff) > 0.05 ? { text: a.name, sub: signed(diff, 1) + " fark" } : "başa baş"];
      }),
    });
  }
  return drawPoster({
    title: "Transfer Karnesi", width: 1280,
    subtitle: `${r.count} işlem · ${dayLong(r.first)} – ${dayLong(r.last)}`,
    sections,
    footer: "Değer: oyuncunun o takımda aktif kadroda oynadığı maçlarda, yedek seviyesinin üstünde ürettiği katkı",
  }, await allLogos());
}

// ---------------------------------------------------------------- what-if scenario
export async function scenarioPoster(wk: WeekData, r: WhatIfResult, edits: Edit[]) {
  const T = store.teamName[wk.team], O = store.teamName[wk.opponent];
  const a = r.actual, h = r.hypothetical;
  const real = wk.opponent === wk.real_opponent;
  const text = (s: Edit) => `${store.teamName[s.team]}: ` + (s.type === "swap"
    ? `${pname(s.out!)} yerine ${pname(s.into!)}`
    : `${pname(s.player!)} ${dayLong(s.dates![0])} günü ${s.type === "bench" ? "oynatılmasaydı" : "oynatılsaydı"}`);
  const tag = (res: string): PCell => ({ text: res === "W" ? "K" : res === "L" ? "M" : "B", bold: true, color: res === "W" ? TONE.good : res === "L" ? TONE.bad : TONE.muted });
  const sections: PSection[] = [];
  if (a.categories && h.categories) {
    sections.push({
      // long team names would shrink the column headers to nothing: shorten them
      columns: [{ label: "Kategori", w: 1.4, align: "l" }, { label: `${short(T)} gerçek`, w: 1.6 }, { label: `${short(T)} senaryo`, w: 1.6 },
        { label: `${short(O)} gerçek`, w: 1.6 }, { label: `${short(O)} senaryo`, w: 1.6 }, { label: "Gerçek", w: 0.9, align: "c" }, { label: "Senaryo", w: 0.9, align: "c" }],
      rows: h.categories.map((c, i) => {
        const c0 = a.categories![i];
        return [{ text: catByKey(c.key)?.label ?? c.key, bold: true }, { text: fmt(c.key, c0.a, "total"), color: TONE.muted },
          { text: fmt(c.key, c.a, "total"), bold: c.result === "W" }, { text: fmt(c.key, c0.b, "total"), color: TONE.muted },
          { text: fmt(c.key, c.b, "total"), bold: c.result === "L" }, tag(c0.result), tag(c.result)];
      }),
      rowBg: h.categories.map((c) => (c.changed ? TONE.flip : undefined)),
      note: `K = ${T} kazanır, M = kaybeder, B = berabere · sarı satır: sonucu değişen kategori`,
    });
  }
  return drawPoster({
    title: "Ya Olsaydı?",
    subtitle: `${wk.week}. hafta · ${T} – ${O}${real ? "" : " (gerçekte oynanmadı)"}`,
    tiles: [
      { k: real ? "Gerçek sonuç" : "Gerçek dizilişle", v: `${scoreText(a)}  ${RES[a.result]}`, tone: "plain" },
      { k: "Senaryoda", v: `${scoreText(h)}  ${RES[h.result]}`, s: r.flipped ? "Sonuç değişirdi" : "Sonuç değişmezdi",
        tone: h.result === "W" ? "good" : h.result === "L" ? "bad" : "plain" },
    ],
    bullets: { heading: "Senaryo", items: edits.map(text) },
    sections,
    footer: "Geçmiş haftanın gerçek kutu skorlarıyla yeniden hesaplandı",
  }, await loadLogos([wk.team, wk.opponent]));
}

// ---------------------------------------------------------------- injuries
export async function injuriesPoster(r: InjuryReport) {
  const top = r.teams[0];
  const byMissed = [...r.players].sort((a, b) => b.missed - a.missed || b.il - a.il).slice(0, 12);
  const worst = byMissed[0];
  const totalMissed = r.teams.reduce((a, t) => a + t.missed, 0);
  const status = (s: string): Cell => (s ? { text: s, color: TONE.bad, bold: true } : { text: "sağlıklı", color: TONE.muted });
  const numCol = { label: "#", w: 0.6, align: "c" as const };
  return drawPoster({
    title: "Sakatlıklar", width: 1280,
    subtitle: `${r.days_covered} gün · kaçırılan maçlar ve kaybedilen üretim`,
    tiles: [
      { k: "En çok kayıp yaşayan", v: top?.name ?? "–", s: top ? `${signed(top.lost, 1)} değer · ${top.missed} maç` : "", tone: "bad" },
      { k: "En çok maç kaçıran", v: worst?.name ?? "–", s: worst ? `${worst.missed} maç · ${signed(worst.lost, 1)} değer` : "", tone: "plain" },
      { k: "Toplam kaçırılan maç", v: String(totalMissed), s: `${r.days_covered} gün`, tone: "plain" },
    ],
    sections: [
      {
        heading: "Takımlar",
        columns: [numCol, { label: "Takım", w: 3.4, align: "l" }, { label: "IL gün", w: 1 }, { label: "Kaçırılan maç", w: 1.3 }, { label: "Kaybedilen değer", w: 1.6 }],
        rows: r.teams.map((t, i) => [{ pill: true, text: String(i + 1) }, team(t.team), String(t.il), String(t.missed), val(t.lost)]),
      },
      {
        heading: "En çok maç kaçıranlar",
        columns: [numCol, { label: "Oyuncu", w: 3, align: "l" }, { label: "Takım", w: 3, align: "l" }, { label: "IL gün", w: 1 },
          { label: "Kaçırılan maç", w: 1.3 }, { label: "Kaybedilen değer", w: 1.6 }, { label: "Şu an", w: 1.4, align: "l" }],
        rows: byMissed.map((p, i) => [{ pill: true, text: String(i + 1) }, player(p.key, p.name),
          p.team ? team(p.team, p.team_name ?? undefined) : "–", String(p.il || "–"), { text: String(p.missed), bold: true },
          val(p.lost), status(p.status)]),
      },
    ],
    footer: "Kaçırılan maç: aktif kadroda olup NBA takımı oynarken kutu skoru olmayan günler · değer: yedek seviyesi üstü, az maçı olanlarda geçen sezon ortalaması",
  }, await allLogos());
}
