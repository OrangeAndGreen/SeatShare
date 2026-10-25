"""Build the site's JSON from the MIT Election Data and Science Lab (MEDSL) returns.

Raw files go in data/raw/ (not committed):
  1976-2024-house.tab      US House 1976-2024, doi:10.7910/DVN/IG0UN2
                           (behind a guestbook form, so download it by hand)
  1976-2024-president.csv  President 1976-2024, doi:10.7910/DVN/42MVDX
                           (downloaded automatically when missing)

Writes public/data/summary.json (every state, office and year at state level)
and public/data/house/<year>.json (district results).

Usage: python scripts/build_data.py
"""

import csv
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

HOUSE_FILE = RAW / "1976-2024-house.tab"
PRESIDENT_FILE = RAW / "1976-2024-president.csv"
PRESIDENT_URL = "https://dataverse.harvard.edu/api/access/datafile/13887042"
HOUSE_PAGE = "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/IG0UN2"

D, R, O = "D", "R", "O"

DEM_LABELS = {
    "DEMOCRAT", "DEMOCRATIC", "DEMOCRATIC-FARMER-LABOR", "DEMOCRATIC-FARM-LABOR",
    "DEMOCRATIC-NONPARTISAN LEAGUE", "DEMOCRATIC-NPL", "DFL",
    "WRITE-IN (DEMOCRATIC)", "FOGLIETTA (DEMOCRAT)",
}
REP_LABELS = {
    "REPUBLICAN", "INDEPENDENT-REPUBLICAN", "WRITE-IN (REPUBLICAN)",
    "REPUBLICAN, LIBERTARIAN",
}

# Rows that are not votes for anyone: blank, over and under votes, and ballots
# exhausted in a ranked-choice count.
NOT_A_VOTE = re.compile(r"\b(BLANKS?|OVER ?VOTES?|UNDER ?VOTES?|VOID|SPOILED|EXHAUSTED)\b")

# Maine and Nebraska give one elector per district. These are the years a
# district went against the statewide winner; otherwise it is winner-take-all.
SPLIT_ELECTORS = {
    (2008, "NE"): {D: 1, R: 4},
    (2016, "ME"): {D: 3, R: 1},
    (2020, "ME"): {D: 3, R: 1},
    (2020, "NE"): {D: 1, R: 4},
    (2024, "ME"): {D: 3, R: 1},
    (2024, "NE"): {D: 1, R: 4},
}


def party_of(label):
    label = (label or "").strip().upper()
    if label in DEM_LABELS:
        return D
    if label in REP_LABELS:
        return R
    return O


def is_vote(candidate, party_label):
    """False for blank/over/under-vote rows, which carry no party."""
    if party_label and party_label.upper() not in ("NA", ""):
        return True
    return not NOT_A_VOTE.search((candidate or "").upper())


def to_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def tally_candidates(rows, party_field, label_to_party=party_of):
    """Sum each candidate's votes across party lines (fusion tickets).

    A candidate belongs to the major party whose line gave them the most votes,
    or to Other when they had no major-party line.
    Returns [(candidate, party, votes)] sorted by votes, most first.
    """
    votes = defaultdict(int)
    line_votes = defaultdict(lambda: defaultdict(int))
    for row in rows:
        name, label = row["candidate"], row[party_field]
        if not is_vote(name, label):
            continue
        v = to_int(row["candidatevotes"])
        votes[name] += v
        line_votes[name][label_to_party(label)] += v + 1  # +1 so a 0-vote line still counts
    result = []
    for name, total in votes.items():
        lines = line_votes[name]
        major = {p: n for p, n in lines.items() if p != O}
        party = max(major, key=major.get) if major else O
        result.append((name, party, total))
    result.sort(key=lambda c: -c[2])
    return result


def empty_counts():
    return {D: 0, R: 0, O: 0}


def house_contests(rows):
    """Group House rows into one regular contest per (year, state, district).

    The vote counts come from the November round. In 1996 and 2006 Texas held
    court-ordered special elections in place of the regular ones, so specials are
    used where a district has no regular rows. A runoff, where there was one,
    decides the winner.
    """
    by_seat = defaultdict(list)
    for row in rows:
        if row["state_po"] == "DC":  # non-voting delegate
            continue
        by_seat[(int(row["year"]), row["state_po"], int(row["district"]))].append(row)

    contests = {}
    for key, seat_rows in by_seat.items():
        runoff = [r for r in seat_rows if r["runoff"] == "TRUE"]
        first = [r for r in seat_rows if r["runoff"] != "TRUE" and r["special"] == "FALSE"]
        if not first:
            first = [r for r in seat_rows if r["runoff"] != "TRUE"]
        if not first:
            continue
        candidates = tally_candidates(first, "party")
        if not candidates:
            continue
        deciding = tally_candidates(runoff, "party") if runoff else candidates
        winner = deciding[0]
        real = {r["candidate"] for r in first
                if r["writein"] != "TRUE" and r["party"] not in ("NA", "")}
        votes = empty_counts()
        for _, party, v in candidates:
            votes[party] += v
        contests[key] = {
            "district": key[2],
            "winner": winner[0].title(),
            "party": winner[1],
            "votes": votes,
            "uncontested": len(real) <= 1,
        }
    return contests


def president_results(rows):
    """{(year, state): {votes, candidates}} with each party's top candidate."""
    by_state = defaultdict(list)
    for row in rows:
        by_state[(int(row["year"]), row["state_po"])].append(row)
    out = {}
    simplified = {"DEMOCRAT": D, "REPUBLICAN": R}
    for key, state_rows in by_state.items():
        candidates = tally_candidates(
            state_rows, "party_simplified", lambda l: simplified.get(l.upper(), O))
        votes = empty_counts()
        names = {}
        for name, party, v in candidates:
            votes[party] += v
            if party != O and party not in names:
                names[party] = name
        out[key] = {"votes": votes, "names": names}
    return out


def electoral_votes(house_seats, year, state, winner):
    """Electors are House seats + 2 (DC has 3), split only where recorded."""
    total = 3 if state == "DC" else house_seats + 2
    if (year, state) in SPLIT_ELECTORS:
        return dict(empty_counts(), **SPLIT_ELECTORS[(year, state)])
    ev = empty_counts()
    ev[winner] = total
    return ev


def winner_of(votes):
    return max(votes, key=votes.get)


def display_name(raw):
    """'CARTER, JIMMY' -> 'Jimmy Carter'."""
    raw = raw.replace('\\"', '"').replace('""', '"')
    if "," in raw:
        last, first = raw.split(",", 1)
        raw = f"{first.strip()} {last.strip()}"
    return " ".join(w.capitalize() if not w.startswith('"') else '"' + w[1:].capitalize()
                    for w in raw.split())


def state_name(raw):
    return " ".join(w if w == "of" else w.capitalize() for w in raw.lower().split())


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def ensure_raw():
    RAW.mkdir(parents=True, exist_ok=True)
    if not PRESIDENT_FILE.exists():
        print(f"Downloading {PRESIDENT_FILE.name}")
        urllib.request.urlretrieve(PRESIDENT_URL, PRESIDENT_FILE)
    if not HOUSE_FILE.exists():
        sys.exit(f"Missing {HOUSE_FILE}.\nDownload 1976-2024-house.tab from {HOUSE_PAGE}\n"
                 f"(it asks for a guestbook form) and save it in {RAW}.")


def build():
    ensure_raw()
    house_rows = read_csv(HOUSE_FILE)
    pres_rows = read_csv(PRESIDENT_FILE)

    states = {}
    for row in house_rows + pres_rows:
        states[row["state_po"]] = {
            "po": row["state_po"],
            "name": state_name(row["state"]),
            "fips": f"{int(row['state_fips']):02d}",
        }

    contests = house_contests(house_rows)
    house = defaultdict(lambda: {"votes": empty_counts(), "seats": empty_counts(),
                                 "uncontested": 0, "districts": []})
    for (year, state, _), c in sorted(contests.items()):
        h = house[(year, state)]
        for p in (D, R, O):
            h["votes"][p] += c["votes"][p]
        h["seats"][c["party"]] += 1
        h["uncontested"] += c["uncontested"]
        h["districts"].append(c)

    seats_in = {key: sum(h["seats"].values()) for key, h in house.items()}
    pres = president_results(pres_rows)

    summary = {"house": {}, "president": {}}
    for (year, state), h in sorted(house.items()):
        summary["house"].setdefault(str(year), {})[state] = {
            "votes": h["votes"], "seats": h["seats"], "uncontested": h["uncontested"]}
    candidates = {}
    for (year, state), p in sorted(pres.items()):
        win = winner_of({k: v for k, v in p["votes"].items() if k != O}) \
            if p["votes"][O] < max(p["votes"][D], p["votes"][R]) else winner_of(p["votes"])
        summary["president"].setdefault(str(year), {})[state] = {
            "votes": p["votes"],
            "seats": electoral_votes(seats_in.get((year, state), 0), year, state, win),
        }
        for party, name in p["names"].items():
            candidates.setdefault(str(year), {}).setdefault(party, defaultdict(int))[name] += 1
    # The name a party used in most states (spellings vary a little).
    nominees = {y: {p: display_name(max(c, key=c.get)) for p, c in parties.items()}
                for y, parties in candidates.items()}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "house").mkdir(exist_ok=True)
    meta = {
        "states": sorted(states.values(), key=lambda s: s["name"]),
        "offices": {
            "house": sorted(int(y) for y in summary["house"]),
            "president": sorted(int(y) for y in summary["president"]),
        },
        "nominees": nominees,
        "source": "MIT Election Data and Science Lab, Harvard Dataverse",
    }
    write_json(OUT / "summary.json", dict(meta, results=summary))
    for year in meta["offices"]["house"]:
        districts = {state: h["districts"] for (y, state), h in house.items() if y == year}
        write_json(OUT / "house" / f"{year}.json", districts)

    check(summary)
    print(f"Wrote {OUT}")


def check(summary):
    """Every House year should have 435 seats and every presidential year 538 electors."""
    for year, by_state in summary["house"].items():
        seats = sum(sum(s["seats"].values()) for s in by_state.values())
        if seats != 435:
            print(f"warning: House {year} has {seats} seats")
    for year, by_state in summary["president"].items():
        ev = sum(sum(s["seats"].values()) for s in by_state.values())
        if ev != 538:
            print(f"warning: President {year} has {ev} electoral votes")


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


if __name__ == "__main__":
    build()
