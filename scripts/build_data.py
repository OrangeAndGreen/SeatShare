"""Build the site's JSON from the MIT Election Data and Science Lab (MEDSL) returns.

Raw files go in data/raw/ (not committed):
  1976-2024-house.tab      US House 1976-2024, doi:10.7910/DVN/IG0UN2
                           (behind a guestbook form, so download it by hand)
  1976-2024-president.csv  President 1976-2024, doi:10.7910/DVN/42MVDX
  1976-2024-senate.csv     US Senate 1976-2024, doi:10.7910/DVN/PEJ5QU
  1968-2022-state-legislatures.csv
                           Klarner's state legislative returns, one row per contest,
                           doi:10.7910/DVN/FJOGJB
                           (these three are downloaded automatically when missing)

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
SENATE_FILE = RAW / "1976-2024-senate.csv"
SENATE_URL = "https://dataverse.harvard.edu/api/access/datafile/13887039"
LEGISLATURE_FILE = RAW / "1968-2022-state-legislatures.csv"
LEGISLATURE_URL = "https://dataverse.harvard.edu/api/access/datafile/10273086?format=original"
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
        contest = decide(first, runoff, "party", party_of)
        if contest:
            contests[key] = dict(district=key[2], **contest)
    return contests


def decide(first, runoff, party_field, label_to_party):
    """Votes from the first round; the winner from the runoff where there was one."""
    candidates = tally_candidates(first, party_field, label_to_party)
    if not candidates:
        return None
    deciding = tally_candidates(runoff, party_field, label_to_party) if runoff else candidates
    winner = deciding[0]
    real = {r["candidate"] for r in first
            if r["writein"].upper() != "TRUE" and r[party_field] not in ("NA", "")}
    votes = empty_counts()
    for _, party, v in candidates:
        votes[party] += v
    return {
        "winner": winner[0].title(),
        "party": winner[1],
        "votes": votes,
        "uncontested": len(real) <= 1,
    }


def simplified_party(label):
    return {"DEMOCRAT": D, "REPUBLICAN": R}.get(label.upper(), O)


# Rows in the Senate file that are wrong, by (year, state, candidate, votes as given):
# the rows to use instead, as (stage, votes).
SENATE_FIXES = {
    # The top two carry their December runoff votes with a stray leading 1.
    # Their November votes bring the race to the reported turnout.
    (2014, "LA", "BILL CASSIDY", 1712379): [("GEN", 603048), ("RUNOFF", 712379)],
    (2014, "LA", "MARY L. LANDRIEU", 1561210): [("GEN", 619402), ("RUNOFF", 561210)],
    # Both rounds are filed as "gen"; these are the December runoff rows.
    (2002, "LA", "MARY L. LANDRIEU", 638654): [("RUNOFF", 638654)],
    (2002, "LA", "SUZANNE HAIK TERRELL", 596642): [("RUNOFF", 596642)],
}

# Races missing from the Senate file, as (year, state, candidate, party line, votes).
# Connecticut 2022 is from the Secretary of State's certified results.
SENATE_MISSING = [
    (2022, "CT", "RICHARD BLUMENTHAL", "DEMOCRAT", 701175),
    (2022, "CT", "RICHARD BLUMENTHAL", "WORKING FAMILIES", 22689),
    (2022, "CT", "LEORA LEVY", "REPUBLICAN", 535943),
    (2022, "CT", "WRITEIN", "", 80),
]


def missing_senate_rows(rows):
    """SENATE_MISSING as Senate file rows, for any race the file doesn't have."""
    have = {(r["year"], r["state_po"]) for r in rows}
    return [{"year": str(year), "state_po": state, "stage": "GEN", "special": "FALSE",
             "candidate": name, "party_detailed": party, "party_simplified": party,
             "candidatevotes": str(votes), "writein": "TRUE" if not party else "FALSE"}
            for year, state, name, party, votes in SENATE_MISSING if (str(year), state) not in have]


# Senate candidates filed with no party at all.
SENATE_PARTIES = {
    (2020, "WY", "CYNTHIA M. LUMMIS"): R,
    (2020, "WY", "MERAV BEN DAVID"): D,
    (2020, "NE", "PRESTON LOVE JR."): D,  # Democratic write-in
    (2022, "AK", "MURKOWSKI, LISA"): R,
    (2022, "AK", "TSHIBAKA, KELLY C."): R,
    (2022, "AK", "KELLEY, BUZZ A."): R,
    (2022, "AK", "CHESBRO, PATRICIA R."): D,
}


# The seat class each special election filled, from 2018 on; a regular race's class
# follows from its year. Older specials have since been superseded by regular races.
SENATE_SPECIAL_CLASSES = {
    (2018, "MN"): 2, (2018, "MS"): 2, (2020, "AZ"): 3, (2020, "GA"): 3,
    (2022, "CA"): 3, (2022, "OK"): 2, (2024, "CA"): 1, (2024, "NE"): 2,
}


def senate_class(year, state, special):
    """Class I seats were up in 2018 and 2024, II in 2020, III in 2022; None for an
    older special whose seat isn't recorded."""
    if special:
        return SENATE_SPECIAL_CLASSES.get((year, state))
    return {2: 1, 4: 2, 0: 3}[year % 6]


def senate_label(row, year):
    """The party label to read a Senate row by: the detailed party where it names
    a major party, else the simplified one (which misses some), else the fixes."""
    fixed = SENATE_PARTIES.get((year, row["state_po"], row["candidate"]))
    if fixed:
        return "DEMOCRAT" if fixed == D else "REPUBLICAN"
    if party_of(row["party_detailed"]) != O:
        return row["party_detailed"]
    if simplified_party(row["party_simplified"]) != O:
        return row["party_simplified"]
    return row["party_detailed"]


def senate_contests(rows):
    """One contest per (election year, state, special), so a state can have two.

    Stages differ by year. Georgia files its November round as "pre" and the
    runoff as "gen" in 1992 and 2008, as "gen runoff" in 2022, and the January
    2021 runoffs under 2021, which belong to the 2020 election.
    """
    by_race = defaultdict(list)
    for row in rows:
        year = int(row["year"])
        row = dict(row, stage=row["stage"].upper(), party_detailed=senate_label(row, year))
        fix = SENATE_FIXES.get((year, row["state_po"], row["candidate"], to_int(row["candidatevotes"])))
        fixed = [dict(row, stage=stage, candidatevotes=str(v)) for stage, v in fix] if fix else [row]
        if year % 2:
            year -= 1
        special = row["special"].upper() == "TRUE"
        by_race[(year, row["state_po"], special)].extend(fixed)

    contests = {}
    for key, race_rows in by_race.items():
        stages = {r["stage"] for r in race_rows}
        if "PRE" in stages:
            first = [r for r in race_rows if r["stage"] == "PRE"]
            runoff = [r for r in race_rows if r["stage"] == "GEN"]
        else:
            first = [r for r in race_rows if r["stage"] == "GEN"]
            runoff = [r for r in race_rows if "RUNOFF" in r["stage"]]
        contest = decide(first, runoff, "party_detailed", party_of)
        if contest:
            contests[key] = dict(special=key[2], **contest)
    return contests


LEGISLATURE_OFFICES = {"0": "statehouse", "1": "statesenate"}


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def legislature_results(rows):
    """{office: {year: {state: result}}} from Klarner's contest file.

    A contest's votes are divided by its seats, so a voter in a multimember district
    counts once. Odd-year elections count for the next even year; when that puts two
    elections of one chamber in the same year (Virginia's 1981 and court-ordered 1982
    House elections), the later one decides. "noVotes" counts seats with no votes
    recorded, mostly uncontested seats in states that leave them off the ballot.
    """
    by_election = defaultdict(list)
    for row in rows:
        by_election[(LEGISLATURE_OFFICES[row["sen"]], int(row["year"]), row["sab"])].append(row)

    chosen = {}
    for (office, year, state) in sorted(by_election):
        slot = (office, year + year % 2, state)
        if slot in chosen:
            print(f"note: {office} {state} {year} replaces {chosen[slot][1]} as {slot[1]}")
        chosen[slot] = (office, year, state)  # sorted by year, so the later one stays

    results = defaultdict(dict)
    for (office, slot_year, state), key in sorted(chosen.items()):
        votes = {D: 0.0, R: 0.0, O: 0.0}
        seats = empty_counts()
        uncontested = no_votes = 0
        for row in by_election[key]:
            n = int(row["eseats"])
            for p, field in ((D, "d"), (R, "r"), (O, "o")):
                votes[p] += to_float(row[field + "vote"]) / n
                seats[p] += round(to_float(row[field + "win"]) * n)
            uncontested += n * (row["uncont"] == "1")
            no_votes += n * (row["vmiss"] == "1")
        seats_up = int(by_election[key][0]["seatsup"])
        if sum(seats.values()) != seats_up:
            print(f"warning: {office} {key[1]} {state} has {sum(seats.values())} winners "
                  f"for {seats_up} seats")
        results[office].setdefault(str(slot_year), {})[state] = {
            "votes": {p: round(v) for p, v in votes.items()},
            "seats": seats,
            "uncontested": uncontested,
            "noVotes": no_votes,
        }
    return results


def president_results(rows):
    """{(year, state): {votes, candidates}} with each party's top candidate."""
    by_state = defaultdict(list)
    for row in rows:
        by_state[(int(row["year"]), row["state_po"])].append(row)
    out = {}
    for key, state_rows in by_state.items():
        candidates = tally_candidates(state_rows, "party_simplified", simplified_party)
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


NAME_SUFFIXES = {"JR", "SR", "II", "III", "IV"}


def display_name(raw):
    """'CARTER, JIMMY' -> 'Jimmy Carter'; 'BYRD, HARRY F., JR.' and
    'HARRY F. BYRD, JR.' -> 'Harry F. Byrd Jr.'."""
    raw = raw.replace('\\"', '"').replace('""', '"')
    parts = [part.strip() for part in raw.split(",")]
    suffix = [parts.pop()] if len(parts) > 1 and parts[-1].upper().rstrip(".") in NAME_SUFFIXES else []
    if len(parts) == 2:
        parts = [parts[1], parts[0]]
    raw = " ".join(parts + suffix)
    return " ".join(capitalize(w) if not w.startswith('"') else '"' + capitalize(w[1:])
                    for w in raw.split())


def capitalize(word):
    """'MCCONNELL' -> 'McConnell'."""
    word = word.capitalize()
    return "Mc" + word[2:].capitalize() if len(word) > 3 and word.startswith("Mc") else word


def state_name(raw):
    return " ".join(w if w == "of" else w.capitalize() for w in raw.lower().split())


def read_csv(path, dialect="excel", **fmt):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, dialect=dialect, **fmt))


def ensure_raw():
    RAW.mkdir(parents=True, exist_ok=True)
    for path, url in ((PRESIDENT_FILE, PRESIDENT_URL), (SENATE_FILE, SENATE_URL),
                      (LEGISLATURE_FILE, LEGISLATURE_URL)):
        if not path.exists():
            print(f"Downloading {path.name}")
            urllib.request.urlretrieve(url, path)
    if not HOUSE_FILE.exists():
        sys.exit(f"Missing {HOUSE_FILE}.\nDownload 1976-2024-house.tab from {HOUSE_PAGE}\n"
                 f"(it asks for a guestbook form) and save it in {RAW}.")


def build():
    ensure_raw()
    house_rows = read_csv(HOUSE_FILE)
    pres_rows = read_csv(PRESIDENT_FILE)
    senate_rows = read_csv(SENATE_FILE, dialect="excel-tab", escapechar="\\")  # tab-separated despite the name, \" for a quote
    senate_rows += missing_senate_rows(senate_rows)
    legislature_rows = read_csv(LEGISLATURE_FILE)

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

    summary = {"house": {}, "senate": {}, "president": {}}
    for (year, state), h in sorted(house.items()):
        summary["house"].setdefault(str(year), {})[state] = {
            "votes": h["votes"], "seats": h["seats"], "uncontested": h["uncontested"]}
    # A state with a regular and a special race in one year adds both.
    for (year, state, _), c in sorted(senate_contests(senate_rows).items()):
        s = summary["senate"].setdefault(str(year), {}).setdefault(state, {
            "votes": empty_counts(), "seats": empty_counts(), "uncontested": 0, "races": []})
        for p in (D, R, O):
            s["votes"][p] += c["votes"][p]
        s["seats"][c["party"]] += 1
        s["uncontested"] += c["uncontested"]
        race = {"winner": display_name(c["winner"]), "party": c["party"],
                "special": c["special"], "votes": c["votes"]}
        seat_class = senate_class(year, state, c["special"])
        if seat_class:
            race["class"] = seat_class
        s["races"].append(race)
    summary.update(legislature_results(legislature_rows))
    candidates = {}
    for (year, state), p in sorted(pres.items()):
        win = winner_of(p["votes"])
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
            "senate": sorted(int(y) for y in summary["senate"]),
            "president": sorted(int(y) for y in summary["president"]),
            "statehouse": sorted(int(y) for y in summary["statehouse"]),
            "statesenate": sorted(int(y) for y in summary["statesenate"]),
        },
        "nominees": nominees,
        "source": "MIT Election Data and Science Lab; Carl Klarner, State Legislative Election Returns; Harvard Dataverse",
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
