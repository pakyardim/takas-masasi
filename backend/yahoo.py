"""Yahoo Fantasy Sports API provider (read-only).

Auth: OAuth 2.0. Run `python -m backend.auth_cli` once to create .yahoo_tokens.json;
access tokens are refreshed automatically afterwards.

Docs: https://developer.yahoo.com/fantasysports/guide/
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

import requests

from .engine import add_lines

API = "https://fantasysports.yahooapis.com/fantasy/v2"
AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / ".yahoo_tokens.json"
CACHE_DIR = ROOT / ".cache"

# ratio categories -> component stat names (from Yahoo display-only stats like "FGM/FGA")
RATIO_COMPONENTS = {"FG%": ("FGM", "FGA"), "FT%": ("FTM", "FTA"), "3PT%": ("3PTM", "3PTA")}


# ------------------------------------------------------------------ OAuth

class YahooAuth:
    def __init__(self):
        self.client_id = os.environ["YAHOO_CLIENT_ID"]
        self.client_secret = os.environ["YAHOO_CLIENT_SECRET"]
        self.redirect_uri = os.environ.get("YAHOO_REDIRECT_URI", "oob")
        self.tokens = json.loads(TOKEN_FILE.read_text()) if TOKEN_FILE.exists() else None

    def authorize_url(self) -> str:
        from urllib.parse import urlencode
        return AUTH_URL + "?" + urlencode({"client_id": self.client_id, "redirect_uri": self.redirect_uri,
                                           "response_type": "code"})

    def _token_request(self, data: dict):
        r = requests.post(TOKEN_URL, data=data, auth=(self.client_id, self.client_secret), timeout=20)
        r.raise_for_status()
        tok = r.json()
        tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600)) - 60
        if "refresh_token" not in tok and self.tokens:
            tok["refresh_token"] = self.tokens["refresh_token"]
        self.tokens = tok
        TOKEN_FILE.write_text(json.dumps(tok))
        os.chmod(TOKEN_FILE, 0o600)

    def exchange_code(self, code: str):
        self._token_request({"grant_type": "authorization_code", "code": code.strip(),
                             "redirect_uri": self.redirect_uri})

    def access_token(self) -> str:
        if not self.tokens:
            raise RuntimeError("Yahoo'ya bağlı değil. Önce `python -m backend.auth_cli` çalıştır.")
        if time.time() >= self.tokens.get("expires_at", 0):
            self._token_request({"grant_type": "refresh_token", "refresh_token": self.tokens["refresh_token"],
                                 "redirect_uri": self.redirect_uri})
        return self.tokens["access_token"]


# ------------------------------------------------------------------ XML helpers

def _strip_ns(el: ET.Element) -> ET.Element:
    for e in el.iter():
        if "}" in e.tag:
            e.tag = e.tag.split("}", 1)[1]
    return el


def _t(el, path, default=None):
    x = el.find(path)
    return x.text if x is not None and x.text is not None else default


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ provider

class YahooProvider:
    is_demo = False

    def __init__(self, league_id: str | None = None):
        self.auth = YahooAuth()
        self.league_id = league_id or os.environ["YAHOO_LEAGUE_ID"]
        CACHE_DIR.mkdir(exist_ok=True)
        self._league = None
        self._info = {}

    # --- http with disk cache -------------------------------------------
    def _get(self, path: str, ttl: float | None = 600) -> ET.Element:
        """ttl=None caches forever (used for stats of days that are over)."""
        f = CACHE_DIR / (hashlib.sha1(path.encode()).hexdigest() + ".xml")
        if f.exists() and (ttl is None or time.time() - f.stat().st_mtime < ttl):
            return _strip_ns(ET.fromstring(f.read_bytes()))
        for attempt in range(3):
            r = requests.get(API + path, headers={"Authorization": f"Bearer {self.auth.access_token()}"},
                             timeout=30)
            if r.status_code == 999 or r.status_code == 429:   # Yahoo rate limit
                time.sleep(2 * (attempt + 1))
                continue
            r.raise_for_status()
            f.write_bytes(r.content)
            return _strip_ns(ET.fromstring(r.content))
        r.raise_for_status()

    @staticmethod
    def _day_ttl(d: date):
        return None if d < date.today() - timedelta(days=1) else 600

    # --- league ---------------------------------------------------------
    @property
    def league_key(self):
        if not hasattr(self, "_lk"):
            game = self._get("/game/nba", ttl=86400)
            self._lk = f"{_t(game, './/game_key')}.l.{self.league_id}"
        return self._lk

    def league(self) -> dict:
        if self._league:
            return self._league
        lk = self.league_key
        root = self._get(f"/league/{lk}/settings", ttl=3600)
        lg = root.find(".//league")
        scoring = "points" if _t(lg, "scoring_type", "head") == "headpoint" else "categories"

        stats = lg.findall(".//settings/stat_categories/stats/stat")
        self.stat_names = {}
        composites = {}
        cats = []
        for s in stats:
            sid, name = _t(s, "stat_id"), _t(s, "display_name")
            self.stat_names[sid] = name
            if _t(s, "is_only_display_stat") == "1":
                if "/" in name:
                    composites[sid] = name.split("/")
                continue
            cat = {"key": name, "label": name, "higher": _t(s, "sort_order", "1") == "1"}
            if name in RATIO_COMPONENTS:
                cat["ratio"] = list(RATIO_COMPONENTS[name])
            cats.append(cat)
        self.composites = composites
        # if a ratio category has no composite display stat, fall back to averaging the %
        have = {c for parts in composites.values() for c in parts}
        for c in cats:
            if c.get("ratio") and not set(c["ratio"]) <= have:
                c["ratio"] = [c["key"] + "__n", c["key"] + "__d"]
                c["approx"] = True

        modifiers = {}
        for m in lg.findall(".//settings/stat_modifiers/stats/stat"):
            name = self.stat_names.get(_t(m, "stat_id"))
            if name:
                modifiers[name] = float(_t(m, "value", 0))

        teams = []
        my_team = None
        for t in self._get(f"/league/{lk}/teams", ttl=3600).findall(".//team"):
            tk = _t(t, "team_key")
            teams.append({"key": tk, "name": _t(t, "name"), "manager": _t(t, ".//managers/manager/nickname", "")})
            if _t(t, "is_owned_by_current_login") == "1":
                my_team = tk

        cur = int(_t(lg, "current_week", 1))
        start_week = int(_t(lg, "start_week", 1))
        weeks = []
        for w in range(start_week, cur + 1):
            sb = self._get(f"/league/{lk}/scoreboard;week={w}", ttl=None if w < cur else 600)
            m = sb.find(".//matchup")
            weeks.append({"week": w, "start": _t(m, "week_start"), "end": _t(m, "week_end")})

        self._league = {"key": lk, "name": _t(lg, "name"), "scoring": scoring, "categories": cats,
                        "modifiers": modifiers, "current_week": cur, "my_team": my_team or teams[0]["key"],
                        "teams": teams, "weeks": weeks, "demo": False}
        return self._league

    # --- parsing --------------------------------------------------------
    def _parse_player(self, p: ET.Element, owner=None) -> dict:
        key = _t(p, "player_key")
        info = {"key": key, "name": _t(p, "name/full"), "nba_team": _t(p, "editorial_team_abbr", ""),
                "positions": [_t(x, ".") for x in p.findall("eligible_positions/position")],
                "status": _t(p, "status", ""), "owner": owner}
        self._info[key] = {**self._info.get(key, {}), **{k: v for k, v in info.items() if v is not None}}
        return info

    def _parse_stats(self, p: ET.Element) -> dict | None:
        self.league()
        line, any_value = {}, False
        for s in p.findall("player_stats/stats/stat"):
            sid, raw = _t(s, "stat_id"), _t(s, "value")
            if raw in (None, "-", "", "-/-"):
                continue
            if sid in self.composites:
                parts = raw.split("/")
                for name, v in zip(self.composites[sid], parts):
                    if _num(v) is not None:
                        line[name] = _num(v)
                        any_value = True
                continue
            name = self.stat_names.get(sid)
            v = _num(raw)
            if name and v is not None:
                line[name] = v
                any_value = True
        for c in self._league["categories"]:
            if c.get("approx") and c["key"] in line:
                line[c["key"] + "__n"], line[c["key"] + "__d"] = line[c["key"]], 1.0
        return line if any_value else None

    def _players_stats(self, keys, stat_query: str, ttl) -> dict:
        out = {}
        keys = list(keys)
        for i in range(0, len(keys), 25):
            chunk = ",".join(keys[i:i + 25])
            root = self._get(f"/league/{self.league_key}/players;player_keys={chunk}/stats;{stat_query}", ttl=ttl)
            for p in root.findall(".//player"):
                self._parse_player(p)
                out[_t(p, "player_key")] = self._parse_stats(p)
        return out

    # --- public API -----------------------------------------------------
    def player_info(self, keys) -> dict:
        missing = [k for k in keys if k not in self._info]
        for i in range(0, len(missing), 25):
            root = self._get(f"/league/{self.league_key}/players;player_keys={','.join(missing[i:i+25])}/ownership",
                             ttl=3600)
            for p in root.findall(".//player"):
                owner = _t(p, "ownership/owner_team_key")
                self._parse_player(p, owner)
        return {k: self._info[k] for k in keys if k in self._info}

    def rosters(self) -> dict:
        out = {}
        for t in self.league()["teams"]:
            root = self._get(f"/team/{t['key']}/roster/players", ttl=600)
            out[t["key"]] = [self._parse_player(p, t["key"])["key"] for p in root.findall(".//player")]
        return out

    def _days_stats(self, keys, start: date, end: date) -> dict:
        """player -> [daily lines]"""
        res = {k: [] for k in keys}
        d = start
        while d <= end:
            day = self._players_stats(keys, f"type=date;date={d.isoformat()}", self._day_ttl(d))
            for k, line in day.items():
                if line:
                    res.setdefault(k, []).append(line)
            d += timedelta(days=1)
        return res

    def averages(self, keys, period: str = "season") -> dict:
        keys = list(keys)
        if period == "season":
            raw = self._players_stats(keys, "type=average_season", ttl=3600)
            return {k: (v or {}) for k, v in raw.items()}
        n = {"last30": 30, "last14": 14, "last7": 7}[period]
        end = date.today() - timedelta(days=1)
        daily = self._days_stats(keys, end - timedelta(days=n - 1), end)
        out = {}
        for k, lines in daily.items():
            gp = len(lines)
            tot = add_lines(lines)
            out[k] = ({s: v / gp for s, v in tot.items()} | {"GP": gp}) if gp else {"GP": 0}
        return out

    def matchups(self, week: int) -> list[list[str]]:
        cur = self.league()["current_week"]
        sb = self._get(f"/league/{self.league_key}/scoreboard;week={week}", ttl=None if week < cur else 600)
        return [[_t(t, "team_key") for t in m.findall(".//team")] for m in sb.findall(".//matchup")]

    def _week_dates(self, week: int):
        w = next(x for x in self.league()["weeks"] if x["week"] == week)
        s, e = date.fromisoformat(w["start"]), date.fromisoformat(w["end"])
        return [s + timedelta(days=i) for i in range((e - s).days + 1)]

    def week(self, week: int, teams: list[str]) -> dict:
        days = []
        for d in self._week_dates(week):
            lineups = {}
            for t in teams:
                root = self._get(f"/team/{t}/roster;date={d.isoformat()}/players", ttl=self._day_ttl(d))
                lineups[t] = [{"player": self._parse_player(p, t)["key"],
                               "slot": _t(p, "selected_position/position", "BN")}
                              for p in root.findall(".//player")]
            keys = [e["player"] for t in teams for e in lineups[t]]
            stats = self._players_stats(keys, f"type=date;date={d.isoformat()}", self._day_ttl(d)) \
                if d < date.today() else {k: None for k in keys}
            days.append({"date": d.isoformat(), "lineups": lineups, "stats": stats})
        dates = self._week_dates(week)
        return {"week": week, "start": dates[0].isoformat(), "end": dates[-1].isoformat(), "days": days}

    def player_week_stats(self, key: str, week: int) -> dict:
        out = {}
        for d in self._week_dates(week):
            if d >= date.today():
                out[d.isoformat()] = None
                continue
            out[d.isoformat()] = self._players_stats([key], f"type=date;date={d.isoformat()}",
                                                     self._day_ttl(d)).get(key)
        return out

    def search(self, query: str, limit: int = 15) -> list[dict]:
        from urllib.parse import quote
        root = self._get(f"/league/{self.league_key}/players;search={quote(query)};count={limit}/ownership",
                         ttl=600)
        return [self._parse_player(p, _t(p, "ownership/owner_team_key")) for p in root.findall(".//player")]
