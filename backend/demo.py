"""Demo data provider: a fictional 10-team H2H 9-cat league with realistic-ish
daily box scores, so the app can be used without Yahoo credentials.

It exposes the same interface as YahooProvider (see provider.py)."""
from __future__ import annotations

import random
from datetime import date, timedelta

from .engine import add_lines

SEASON_START = date(2026, 10, 19)          # Monday of week 1
NUM_WEEKS = 20
NBA_TEAMS = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
             "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
             "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"]
FIRST = ["Jalen", "Marcus", "Tyrese", "Darius", "Andre", "Malik", "Cole", "Isaiah", "Jordan", "Trey",
         "Devin", "Caleb", "Miles", "Nikola", "Luka", "Bogdan", "Kenji", "Omar", "Elijah", "Xavier",
         "Rui", "Dante", "Theo", "Victor", "Amir", "Keon", "Zion", "Bruno", "Leo", "Grant"]
LAST = ["Hayes", "Brooks", "Okafor", "Marsh", "Vance", "Kowalski", "Reyes", "Whitfield", "Duarte", "Pryor",
        "Lindqvist", "Abara", "Sutton", "Moretti", "Calloway", "Ngata", "Fischer", "Banks", "Ellison", "Tate",
        "Varga", "Holloway", "Mensah", "Quinn", "Barros", "Kerr", "Delacroix", "Osei", "Strand", "Yilmaz"]
FANTASY_TEAMS = ["Pick & Roll Pirates", "Dunk Dynasty", "Fast Break Falcons", "Triple Double Trouble",
                 "Splash Bros Inc", "Paint Protectors", "Bench Mob", "Alley-Oop Avengers",
                 "Euro Step Elite", "Buzzer Beaters"]
MANAGERS = ["Sen", "Ahmet", "Mert", "Can", "Ece", "Burak", "Deniz", "Selin", "Kerem", "Zeynep"]
SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "C", "UTIL", "UTIL"]

LEAGUE = {
    "key": "demo.l.1",
    "name": "Demo Ligi (H2H 9-Cat)",
    "scoring": "categories",
    "categories": [
        {"key": "FG%", "label": "FG%", "higher": True, "ratio": ["FGM", "FGA"]},
        {"key": "FT%", "label": "FT%", "higher": True, "ratio": ["FTM", "FTA"]},
        {"key": "3PTM", "label": "3PTM", "higher": True},
        {"key": "PTS", "label": "PTS", "higher": True},
        {"key": "REB", "label": "REB", "higher": True},
        {"key": "AST", "label": "AST", "higher": True},
        {"key": "ST", "label": "STL", "higher": True},
        {"key": "BLK", "label": "BLK", "higher": True},
        {"key": "TO", "label": "TO", "higher": False},
    ],
    "modifiers": {},
}


def _week_range(week: int) -> tuple[date, date]:
    start = SEASON_START + timedelta(weeks=week - 1)
    return start, start + timedelta(days=6)


class DemoProvider:
    is_demo = True

    def __init__(self, today: date | None = None, seed: int = 42):
        self.today = today or date.today()
        self.rng = random.Random(seed)
        self._make_players()
        self._make_schedule()
        self._box = {}  # (player, date) -> line | None

    # ------------------------------------------------------------ generation
    def _make_players(self):
        rng = self.rng
        self.players = {}
        names = set()
        for i in range(190):
            while True:
                n = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
                if n not in names:
                    names.add(n)
                    break
            arch = rng.choices(["guard", "wing", "big"], [0.38, 0.34, 0.28])[0]
            tier = max(0.35, min(1.6, rng.gauss(1.0 - i / 260, 0.18)))
            if arch == "guard":
                prof = dict(FGA=15, fg=.45, FTA=4.5, ft=.84, TPA=6.5, tp=.37, REB=4, AST=6.5, ST=1.2, BLK=.3, TO=2.6)
                pos = ["PG", "SG"] if rng.random() < .5 else ["PG"]
            elif arch == "wing":
                prof = dict(FGA=13, fg=.47, FTA=3.8, ft=.80, TPA=5.5, tp=.36, REB=5.5, AST=3.2, ST=1.1, BLK=.6, TO=1.8)
                pos = ["SG", "SF"] if rng.random() < .5 else ["SF", "PF"]
            else:
                prof = dict(FGA=11, fg=.57, FTA=4.0, ft=.70, TPA=1.2, tp=.31, REB=10, AST=2.4, ST=.8, BLK=1.6, TO=1.9)
                pos = ["PF", "C"] if rng.random() < .5 else ["C"]
            for k in ("FGA", "FTA", "TPA", "REB", "AST", "ST", "BLK", "TO"):
                prof[k] = max(0.1, prof[k] * tier * rng.uniform(0.75, 1.25))
            for k in ("fg", "ft", "tp"):
                prof[k] = min(.93, max(.25, prof[k] + rng.gauss(0, .03)))
            key = f"demo.p.{1000 + i}"
            self.players[key] = {"key": key, "name": n, "nba_team": rng.choice(NBA_TEAMS),
                                 "positions": pos, "status": "", "profile": prof, "tier": tier}

        ranked = sorted(self.players, key=lambda k: -self.players[k]["tier"])
        self.teams = [{"key": f"demo.t.{i + 1}", "name": FANTASY_TEAMS[i], "manager": MANAGERS[i]}
                      for i in range(10)]
        self.roster = {t["key"]: [] for t in self.teams}
        # snake draft of top 130
        for rnd in range(13):
            order = self.teams if rnd % 2 == 0 else list(reversed(self.teams))
            for t in order:
                self.roster[t["key"]].append(ranked.pop(0))
        self.owner = {p: t for t, ps in self.roster.items() for p in ps}
        injured = self.rng.sample(list(self.owner), 4)
        for p in injured:
            self.players[p]["status"] = "INJ"

    def _make_schedule(self):
        """NBA team -> set of game dates (3-4 games per week)."""
        self.games = {t: set() for t in NBA_TEAMS}
        for w in range(1, NUM_WEEKS + 1):
            start, _ = _week_range(w)
            for t in NBA_TEAMS:
                n = self.rng.choice([3, 3, 4, 4, 4, 2])
                for d in self.rng.sample(range(7), n):
                    self.games[t].add(start + timedelta(days=d))

    def _box_score(self, pk: str, d: date):
        if d >= self.today:
            return None
        cache_key = (pk, d)
        if cache_key in self._box:
            return self._box[cache_key]
        p = self.players[pk]
        line = None
        if d in self.games[p["nba_team"]] and not (p["status"] == "INJ" and d > self.today - timedelta(days=12)):
            r = random.Random(f"{pk}{d}")
            pr = p["profile"]
            g = lambda m, sd=0.35: max(0, round(r.gauss(m, m * sd)))
            fga = g(pr["FGA"], .25)
            tpa = min(fga, g(pr["TPA"], .4))
            tpm = sum(r.random() < pr["tp"] for _ in range(tpa))
            twa = fga - tpa
            twm = sum(r.random() < min(.95, pr["fg"] + .05) for _ in range(twa))
            fgm = min(fga, tpm + twm)
            fta = g(pr["FTA"], .5)
            ftm = sum(r.random() < pr["ft"] for _ in range(fta))
            line = {"GP": 1, "FGM": fgm, "FGA": fga, "FTM": ftm, "FTA": fta, "3PTM": tpm, "3PTA": tpa,
                    "PTS": 2 * fgm + tpm + ftm, "REB": g(pr["REB"]), "AST": g(pr["AST"]),
                    "ST": g(pr["ST"], .8), "BLK": g(pr["BLK"], .8), "TO": g(pr["TO"], .5)}
        self._box[cache_key] = line
        return line

    def _lineup(self, team: str, d: date):
        """Manager starts the 10 best players with a game (with occasional mistakes)."""
        r = random.Random(f"{team}{d}")
        ps = list(self.roster[team])
        def score(pk):
            plays = d in self.games[self.players[pk]["nba_team"]] and self.players[pk]["status"] != "INJ"
            return (plays and r.random() > 0.08, self.players[pk]["tier"])
        ps.sort(key=score, reverse=True)
        lineup = []
        for i, pk in enumerate(ps):
            slot = SLOTS[i] if i < len(SLOTS) else ("IL" if self.players[pk]["status"] == "INJ" else "BN")
            lineup.append({"player": pk, "slot": slot})
        return lineup

    # ------------------------------------------------------------ public API
    def league(self) -> dict:
        cur = min(NUM_WEEKS, max(1, (self.today - SEASON_START).days // 7 + 1))
        weeks = []
        for w in range(1, cur + 1):
            s, e = _week_range(w)
            weeks.append({"week": w, "start": s.isoformat(), "end": e.isoformat()})
        return {**LEAGUE, "current_week": cur, "my_team": self.teams[0]["key"],
                "teams": self.teams, "weeks": weeks, "demo": True}

    def player_info(self, keys) -> dict:
        out = {}
        for k in keys:
            p = self.players.get(k)
            if p:
                out[k] = {f: p[f] for f in ("key", "name", "nba_team", "positions", "status")} | \
                         {"owner": self.owner.get(k)}
        return out

    def rosters(self) -> dict:
        return {t: list(ps) for t, ps in self.roster.items()}

    def averages(self, keys, period: str = "season") -> dict:
        end = self.today - timedelta(days=1)
        days = {"season": (end - SEASON_START).days + 1, "last30": 30, "last14": 14, "last7": 7}[period]
        start = max(SEASON_START, end - timedelta(days=days - 1))
        out = {}
        for k in keys:
            lines = []
            d = start
            while d <= end:
                ln = self._box_score(k, d)
                if ln:
                    lines.append(ln)
                d += timedelta(days=1)
            tot = add_lines(lines)
            gp = tot.get("GP", 0)
            out[k] = {s: v / gp for s, v in tot.items() if s != "GP"} | {"GP": gp} if gp else {"GP": 0}
        return out

    def matchups(self, week: int) -> list[list[str]]:
        keys = [t["key"] for t in self.teams]
        # round robin rotation
        fixed, rest = keys[0], keys[1:]
        shift = (week - 1) % len(rest)
        rest = rest[shift:] + rest[:shift]
        ring = [fixed] + rest
        n = len(ring)
        return [[ring[i], ring[n - 1 - i]] for i in range(n // 2)]

    def week(self, week: int, teams: list[str]) -> dict:
        start, end = _week_range(week)
        days = []
        d = start
        while d <= end:
            lineups = {t: self._lineup(t, d) for t in teams}
            stats = {e["player"]: self._box_score(e["player"], d) for t in teams for e in lineups[t]}
            days.append({"date": d.isoformat(), "lineups": lineups, "stats": stats})
            d += timedelta(days=1)
        return {"week": week, "start": start.isoformat(), "end": end.isoformat(), "days": days}

    def player_week_stats(self, key: str, week: int) -> dict:
        start, _ = _week_range(week)
        return {(start + timedelta(days=i)).isoformat(): self._box_score(key, start + timedelta(days=i))
                for i in range(7)}

    def search(self, query: str, limit: int = 15) -> list[dict]:
        q = query.lower().strip()
        hits = [k for k, p in self.players.items() if q in p["name"].lower()]
        hits.sort(key=lambda k: -self.players[k]["tier"])
        return list(self.player_info(hits[:limit]).values())
