// Turns a player or team profile into short labelled facts. The popup and its poster both
// draw from this list, so they always show the same numbers.
import { dayLong, fmt, num, pct, rec, signed, store } from "./store";
import type { PlayerProfile, PositionPoint, Res, StatLine, TeamProfile, WeekRef } from "./types";

export interface Fact { k: string; v: string; s?: string; tone?: "good" | "bad"; player?: string; team?: string }
export interface FactTable { columns: string[]; rows: string[][] }
export interface FactSection { title: string; items: Fact[]; table?: FactTable; chart?: { n: number; points: PositionPoint[]; note: string } }

const tone = (x: number, eps = 0.0001): Fact["tone"] => (x > eps ? "good" : x < -eps ? "bad" : undefined);
const teamName = (t: string | null | undefined) => (t ? store.teamName[t] ?? t : "–");
const RESULT: Record<Res, string> = { W: "galibiyet", L: "mağlubiyet", T: "beraberlik" };
const PERIOD = { last30: "Son 30 gün", last14: "Son 14 gün", last7: "Son 7 gün" } as const;

/** "28 sayı, 11 ribaund, 6 asist, 3 blok" (steals, blocks and threes only when notable). */
export function lineText(l: StatLine): string {
  const parts = [`${l.PTS ?? 0} sayı`, `${l.REB ?? 0} ribaund`, `${l.AST ?? 0} asist`];
  if ((l["3PTM"] ?? 0) >= 3) parts.push(`${l["3PTM"]} üçlük`);
  if ((l.ST ?? 0) >= 2) parts.push(`${l.ST} top çalma`);
  if ((l.BLK ?? 0) >= 2) parts.push(`${l.BLK} blok`);
  return parts.join(", ");
}
const score = (w: WeekRef) => (w.score ? `${w.score.W}-${w.score.L}${w.score.T ? "-" + w.score.T : ""}` : "–");

// ---------------------------------------------------------------- player

export const playerSub = (p: PlayerProfile) =>
  [[p.nba_team, p.positions.join(",")].filter(Boolean).join(" - "), p.owner ? teamName(p.owner) : "serbest oyuncu"].filter(Boolean).join(" · ");

export function playerFacts(p: PlayerProfile): FactSection[] {
  const out: FactSection[] = [];

  const season: Fact[] = [
    { k: "Değer sırası", v: p.value_rank ? `${p.value_rank.rank}.` : "–",
      s: p.value_rank && p.value != null ? `${p.value_rank.of} oyuncu içinde · ${signed(p.value, 1)} değer` : "bu sezon maçı yok" },
    { k: "Maç başı z-skor", v: p.z == null ? "–" : signed(p.z), tone: p.z == null ? undefined : tone(p.z),
      s: p.z_rank ? `en az ${p.min_gp} maçı olan ${p.z_rank.of} oyuncu içinde ${p.z_rank.rank}.` : p.gp ? `${p.min_gp} maçtan az: sıralamaya girmiyor` : undefined },
    { k: "Oynadığı maç", v: String(p.gp), s: "bu sezon" },
  ];
  if (p.prev) season.push({ k: "Geçen sezon", v: signed(p.prev.z), s: `${p.prev.gp} maç · bu sezonun ölçüsüyle z-skor`, tone: tone(p.prev.z) });
  out.push({ title: "Sezon", items: season });

  // a period that covers every game of the season would only repeat the season average
  const periods = p.periods.filter((x) => x.gp < p.gp);
  if (periods.length && p.z != null) {
    out.push({
      title: "Son dönem (maç başı z-skor)",
      items: periods.map((x) => ({ k: PERIOD[x.period], v: signed(x.z), s: `${x.gp} maç · sezon ortalamasına göre ${signed(x.z - p.z!)}`, tone: tone(x.z - p.z!, 0.25) })),
    });
  }

  if (p.gp) {
    const ranked = p.cats.filter((c) => c.rank != null);
    const byRank = [...(ranked.length ? ranked : p.cats)].sort((a, b) => (ranked.length ? a.rank! - b.rank! : b.z - a.z));
    const best = byRank[0], worst = byRank[byRank.length - 1];
    const where = (c: (typeof p.cats)[number]) => (c.rank != null ? `${c.of} oyuncu içinde ${c.rank}. · ` : "") + `maç başı ${fmt(c.key, c.value)}`;
    out.push({
      title: "Kategoriler",
      items: [
        { k: "En güçlü kategorisi", v: best.label, s: where(best), tone: "good" },
        { k: "En zayıf kategorisi", v: worst.label, s: where(worst), tone: "bad" },
      ],
      table: {
        columns: ["Kategori", "Maç başı", "z-skor", "Sırası"],
        rows: p.cats.map((c) => [c.label, fmt(c.key, c.value), signed(c.z), c.rank != null ? `${c.rank}.` : "–"]),
      },
    });
  }

  const f = p.fantasy;
  const league: Fact[] = [
    { k: "Şu anki takımı", v: p.owner ? teamName(p.owner) : "serbest", team: p.owner ?? undefined },
    p.draft
      ? { k: "Draft", v: `${p.draft.round}. tur, ${p.draft.overall}. seçim`,
          s: p.draft.team_name + (p.draft.surplus != null ? ` · beklenene göre ${signed(p.draft.surplus, 1)}` : "") }
      : { k: "Draft", v: "seçilmedi" },
  ];
  if (f.days) {
    league.push(
      { k: "Ligde oynadığı takım", v: String(f.teams.length), s: f.teams.map(teamName).join(", ") },
      { k: "Aktif kadroda maç", v: String(f.active_games), s: `${signed(f.active_value, 1)} değer üretti` },
      { k: "Yedekte kalan maç", v: String(f.bench_games), s: f.bench_games ? `${num(f.bench_pts)} sayı yedekte kaldı` : "oynadığı her maçta aktifti" },
    );
    if (f.best) league.push({ k: "En iyi maçı", v: dayLong(f.best.date), s: `${lineText(f.best.line)} · ${teamName(f.best.team)}${f.best.active ? "" : " (yedekteydi)"}` });
    const inj = p.injury;
    league.push(inj
      ? { k: "Kaçırdığı maç", v: String(inj.missed), s: `${inj.il} IL gün · ${signed(inj.lost, 1)} değer kaybı`, tone: inj.missed ? "bad" : undefined }
      : { k: "Kaçırdığı maç", v: "0", s: "aktif kadrodayken maç kaçırmadı" });
  } else {
    league.push({ k: "Ligde", v: "kadroda görünmedi", s: "senkronlanan günlerde hiçbir takımın kadrosunda yoktu" });
  }
  out.push({ title: "Bu ligde", items: league });

  if (p.moves.length) {
    const what = { add: "eklendi", drop: "bırakıldı", trade: "takasla geldi" } as const;
    out.push({ title: "Hareketler", items: p.moves.map((m) => ({ k: dayLong(m.date), v: teamName(m.team), s: what[m.action], team: m.team })) });
  }
  return out;
}

// ---------------------------------------------------------------- team

export const teamSub = (t: TeamProfile) => [
  t.standings ? `${rec(t.standings.record)} · ${t.standings.h2h_rank}. sırada` : null,
  `${t.teams} takımlı lig`,
].filter(Boolean).join(" · ");

export function teamFacts(t: TeamProfile): FactSection[] {
  const out: FactSection[] = [];
  const season: Fact[] = [];
  if (t.standings) season.push({ k: "Gerçek sıralama", v: `${t.standings.h2h_rank}.`, s: `${rec(t.standings.record)} kategori rekoru` });
  if (t.power) {
    season.push({ k: "Güç sıralaması", v: `${t.power.rank}.`, s: `${t.power.power.toFixed(1)} güç puanı` });
    season.push({ k: "Herkese karşı", v: pct(t.power.allplay_pct), s: `son 2 hafta ${pct(t.power.form_pct)}` });
  }
  if (t.luck) season.push({ k: "Şans", v: signed(t.luck.luck, 1), s: `şans sıralamasında ${t.luck.rank}.`, tone: tone(t.luck.luck, 0.05) });
  if (t.standings) {
    const s = t.standings;
    season.push({ k: "Başka formatlarda", v: `${s.roto_rank}. / ${s.one_win_rank}. / ${s.points_rank}.`, s: "rotisserie / tek galibiyet / puan ligi" });
  }
  if (season.length) out.push({ title: "Sezon", items: season });

  if (t.history.length >= 2) {
    out.push({
      title: "Lig sırası, hafta hafta", items: [],
      chart: { n: t.teams, points: t.history, note: "Her tamamlanan haftanın sonundaki gerçek puan durumu (H2H kategori rekoru). Üstteki çizgi 1. sıra; aynı orandaki takımlar aynı sırayı paylaşır." },
    });
  }

  const weeks: Fact[] = [];
  if (t.streak) weeks.push({ k: "Seri", v: `${t.streak.n} ${RESULT[t.streak.result]}`, s: "üst üste, son tamamlanan haftaya kadar", tone: t.streak.result === "W" ? "good" : t.streak.result === "L" ? "bad" : undefined });
  if (t.best_week) weeks.push({ k: "En iyi hafta", v: `${t.best_week.week}. hafta`, s: `herkese karşı ${t.best_week.of} takımın ${t.best_week.beaten} tanesini yenerdi`, tone: "good" });
  if (t.worst_week && t.worst_week !== t.best_week) weeks.push({ k: "En zayıf hafta", v: `${t.worst_week.week}. hafta`, s: `herkese karşı ${t.worst_week.of} takımın ${t.worst_week.beaten} tanesini yenerdi`, tone: "bad" });
  if (t.biggest_win) weeks.push({ k: "En farklı galibiyet", v: score(t.biggest_win), s: `${t.biggest_win.week}. hafta · rakip: ${teamName(t.biggest_win.opponent)}`, tone: "good" });
  if (t.closest_loss) weeks.push({ k: "En kıl payı mağlubiyet", v: score(t.closest_loss), s: `${t.closest_loss.week}. hafta · rakip: ${teamName(t.closest_loss.opponent)}`, tone: "bad" });
  if (weeks.length) out.push({ title: "Haftalar", items: weeks });

  if (t.standings?.cats.length) {
    const cs = [...t.standings.cats].sort((a, b) => a.rank - b.rank);
    const item = (c: (typeof cs)[number], k: string, tn: Fact["tone"]): Fact => ({ k, v: c.label, s: `sezon toplamında ${c.rank}. (${fmt(c.key, c.value, "total")})`, tone: tn });
    const items = [item(cs[0], "En güçlü kategori", "good")];
    if (cs.length > 3) items.push(item(cs[1], "İkinci güçlü", "good"));
    items.push(item(cs[cs.length - 1], "En zayıf kategori", "bad"));
    if (cs.length > 3) items.push(item(cs[cs.length - 2], "İkinci zayıf", "bad"));
    out.push({ title: "Kategoriler", items });
  }

  const u = t.usage;
  const roster: Fact[] = u.top.map((x, i) => ({
    k: i === 0 ? "En çok katkı veren" : `Katkıda ${i + 1}.`, v: x.name, player: x.key,
    s: `${x.games} aktif maç · ${signed(x.value, 1)} değer`,
  }));
  if (t.roster_best) roster.push({ k: "Kadronun en yüksek z-skoru", v: t.roster_best.name, player: t.roster_best.key, s: `maç başı ${signed(t.roster_best.z)}` });
  roster.push({ k: "Kullanılan oyuncu", v: String(u.players), s: "sezon boyunca kadroya giren farklı oyuncu" });
  roster.push({ k: "Yedekte kalan maç", v: String(u.bench_games), s: `${num(u.bench_pts)} sayı yedekte kaldı` });
  if (u.bench_top) roster.push({ k: "Yedekte en çok sayı bırakan", v: u.bench_top.name, player: u.bench_top.key, s: `${u.bench_top.games} maç · ${num(u.bench_top.pts)} sayı` });
  out.push({ title: "Kadro", items: roster });

  const dm: Fact[] = [];
  if (t.draft) {
    dm.push({ k: "Draft karnesi", v: `${t.draft.rank}.`, s: `${signed(t.draft.total, 1)} toplam değer · beklenene göre ${signed(t.draft.surplus, 1)}` });
    if (t.draft.best) dm.push({ k: "En isabetli seçim", v: t.draft.best.name, player: t.draft.best.key, s: `#${t.draft.best.overall} · beklenene göre ${signed(t.draft.best.surplus, 1)}`, tone: "good" });
    if (t.draft.worst) dm.push({ k: "En çok hayal kırıklığı", v: t.draft.worst.name, player: t.draft.worst.key, s: `#${t.draft.worst.overall} · beklenene göre ${signed(t.draft.worst.surplus, 1)}`, tone: "bad" });
    dm.push({ k: "Draft oyuncusu kadroda", v: `${t.draft.kept}/${t.draft.picks}` });
  }
  if (t.moves) {
    dm.push({ k: "Serbest oyuncu eklemesi", v: String(t.moves.adds), s: `${signed(t.moves.value, 1)} değer · ligde ${t.moves.rank}.` });
    if (t.moves.best) dm.push({ k: "En iyi ekleme", v: t.moves.best.name, player: t.moves.best.key, s: `${dayLong(t.moves.best.date)} · ${signed(t.moves.best.value, 1)} değer` });
    dm.push({ k: "Takas", v: String(t.moves.trades) });
  }
  if (dm.length) out.push({ title: "Draft ve transfer", items: dm });

  if (t.injuries) {
    const inj = t.injuries;
    const items: Fact[] = [{ k: "Kaçırılan maç", v: String(inj.missed), s: `${inj.il} IL gün · ${signed(inj.lost, 1)} değer kaybı · kayıpta ${inj.rank}.`, tone: inj.missed ? "bad" : undefined }];
    if (inj.top) items.push({ k: "En çok maç kaçıran", v: inj.top.name, player: inj.top.key, s: `${inj.top.missed} maç` });
    out.push({ title: "Sakatlıklar", items });
  }
  return out;
}

export const PROFILE_NOTE = "Değer: maç başı z-skor eksi yedek seviyesi (en iyi 20 serbest oyuncu), oynanan maçlarla çarpılır. Yalnızca olmuş maçlar sayılır.";
