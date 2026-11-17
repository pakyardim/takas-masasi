"""Check synced data against Yahoo's official weekly totals.

    .venv/bin/python -m backend.validate

For every synced matchup, rebuilds each team's week from daily lineups + box
scores and compares it with the totals Yahoo shows on the matchup page."""
from . import engine, imported

STATS = ("FGM", "FGA", "FTM", "FTA", "3PTM", "PTS", "REB", "AST", "ST", "BLK", "TO")


def fmt(score):
    return f"{score['W']}-{score['L']}" + (f"-{score['T']}" if score["T"] else "") if score else "?"


def main():
    p = imported.ImportedProvider()
    lg = p.league()
    print(f"{lg['name']} · güncel hafta {lg['current_week']} · senkronize haftalar {[w['week'] for w in lg['weeks']]}")
    ok = diff = 0
    for w in lg["weeks"]:
        off = p.official(w["week"])
        for a, b in p.matchups(w["week"]):
            wk = p.week(w["week"], [a, b])
            ours = engine.what_if(lg, wk, a, b, [])["actual"]["score"]
            theirs = engine.head_to_head(off[a], off[b], lg)["score"] if a in off and b in off else None
            gaps = {}
            for t in (a, b):
                tot, _ = engine.team_week_totals(wk, t, [], {})
                for k in STATS:
                    ov = (off.get(t) or {}).get(k)
                    if ov is not None and abs(tot.get(k, 0) - ov) > 0.01:
                        gaps[f"takım{t}.{k}"] = (round(tot.get(k, 0), 1), ov)
            same = ours == theirs and not gaps
            ok += same
            diff += not same
            print(f"  {w['week']}. hafta  {a} v {b}:  bizim {fmt(ours)}  yahoo {fmt(theirs)}  {'✓' if same else '✗ ' + str(gaps)}")
    print(f"Sonuç: {ok} eşleşme birebir aynı, {diff} farklı.")


if __name__ == "__main__":
    main()
