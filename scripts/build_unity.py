"""Build the party-line voting data from Voteview's roll calls.

Voteview (Lewis, Poole, Rosenthal, Boche, Rudkin and Sonnet, voteview.com) publishes
every House and Senate roll call with each member's vote and party. Per Congress
and chamber, three CSVs are downloaded into data/raw/voteview/ when missing:

  <C><nnn>_members.csv    members: icpsr, party_code, state, district, name
  <C><nnn>_votes.csv      one row per member per roll call: cast_code
  <C><nnn>_rollcalls.csv  one row per roll call: date

where C is H or S. Writes public/data/unity/index.json (one entry per Congress
with each chamber's party averages) and public/data/unity/<C><nnn>.json (one row
per member). Raw vote files are not shipped.

The measure is Congressional Quarterly's party unity:
  - A party-unity vote is a roll call where a majority of the voting Democrats
    voted against a majority of the voting Republicans. Only Yea and Nay count as
    voting; paired and announced positions, Present and not voting do not.
  - A member's score is the share of the party-unity votes they voted on where they
    voted with their own party's majority.
  - Independents and third-party members are scored against the party they voted
    with more often on those votes (the party they caucus with, in practice).
  - Delegates (DC, Puerto Rico, the territories) are left out.
  - Members who voted on fewer than a quarter of the party-unity votes (at least
    10) are listed but not ranked, and are left out of the party averages.

Usage: python scripts/build_unity.py [first_congress] [last_congress]
"""

import csv
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "voteview"
OUT = ROOT / "public" / "data" / "unity"
BASE_URL = "https://voteview.com/static/data/out"

FIRST_CONGRESS = 80   # 1947, the first postwar Congress
LAST_CONGRESS = 119   # 2025-2027, in progress

DEM, REP = 100, 200
YEA, NAY = 1, 6       # cast codes: 1 Yea, 6 Nay; 2-5 paired/announced, 7-9 present or not voting
CHAMBERS = {"H": "House", "S": "Senate"}
# Delegates and the resident commissioner vote in the Committee of the Whole, so they
# appear in the House files, but they are not members: left out, as CQ does.
NON_STATES = {"DC", "PR", "GU", "VI", "AS", "MP", "PI", "USA"}


def congress_years(congress):
    """(first year, last year) of a Congress: the 118th sat 2023-2025."""
    start = 1789 + 2 * (congress - 1)
    return start, start + 2


def party_letter(code):
    return "D" if code == DEM else "R" if code == REP else "I"


def min_votes(unity_votes):
    """The fewest party-unity votes a member must have voted on to be ranked."""
    return max(10, math.ceil(unity_votes / 4))


def party_positions(votes_by_party):
    """The majority position of each party on one roll call.

    votes_by_party maps a party code to (yeas, nays). Returns {party: YEA or NAY}
    for the parties with a majority one way (a tie has none)."""
    out = {}
    for party, (yeas, nays) in votes_by_party.items():
        if yeas > nays:
            out[party] = YEA
        elif nays > yeas:
            out[party] = NAY
    return out


def is_unity_vote(positions):
    """True when the Democratic and Republican majorities voted opposite ways."""
    return DEM in positions and REP in positions and positions[DEM] != positions[REP]


def score_members(members, votes):
    """Party-unity tallies per member.

    members: {icpsr: party_code}
    votes: iterable of (rollnumber, icpsr, cast_code), one chamber of one Congress.
    Returns (unity_vote_count, {icpsr: {"party": "D"|"R"|"I", "caucus": "D"|"R"|None,
    "votes": n, "with": n}})."""
    cast = defaultdict(dict)  # rollnumber -> {icpsr: YEA/NAY}
    for roll, icpsr, code in votes:
        if code in (YEA, NAY) and icpsr in members:
            cast[roll][icpsr] = code

    # Per member: how often they voted with the D and with the R majority on unity votes.
    agree = defaultdict(lambda: {DEM: 0, REP: 0, "n": 0})
    unity = 0
    for roll, by_member in cast.items():
        tally = {DEM: [0, 0], REP: [0, 0]}
        for icpsr, code in by_member.items():
            party = members[icpsr]
            if party in tally:
                tally[party][0 if code == YEA else 1] += 1
        positions = party_positions(tally)
        if not is_unity_vote(positions):
            continue
        unity += 1
        for icpsr, code in by_member.items():
            a = agree[icpsr]
            a["n"] += 1
            a[DEM] += code == positions[DEM]
            a[REP] += code == positions[REP]

    out = {}
    for icpsr, party in members.items():
        a = agree.get(icpsr, {DEM: 0, REP: 0, "n": 0})
        if party in (DEM, REP):
            caucus = party
        elif a["n"]:
            caucus = DEM if a[DEM] >= a[REP] else REP
        else:
            caucus = None
        out[icpsr] = {
            "party": party_letter(party),
            "caucus": party_letter(caucus) if caucus else None,
            "votes": a["n"],
            "with": a[caucus] if caucus else 0,
        }
    return unity, out


def party_averages(scored, unity_votes):
    """Mean score of each party's ranked members (independents left out)."""
    floor = min_votes(unity_votes)
    sums = {"D": [0.0, 0], "R": [0.0, 0]}
    for m in scored.values():
        if m["party"] in sums and m["votes"] >= floor:
            sums[m["party"]][0] += m["with"] / m["votes"]
            sums[m["party"]][1] += 1
    return {p: round(s / n, 4) if n else None for p, (s, n) in sums.items()}


NAME_SUFFIX = re.compile(r",?\s+(Jr\.?|Sr\.?|II|III|IV)\s*$", re.IGNORECASE)


def title_word(word):
    """ROGERS -> Rogers, McCARTHY -> McCarthy, O'ROURKE -> O'Rourke, OCASIO-CORTEZ -> Ocasio-Cortez."""
    def part(p):
        m = re.match(r"^([A-Z][a-z]+)([A-Z].*)$", p)  # a mixed-case prefix: Mc, De, Mac
        if m:
            return m.group(1) + m.group(2).capitalize()
        return p.capitalize() if p.isupper() else p
    return "".join(part(p) for p in re.split(r"([-' ])", word))


def display_name(bioname):
    """'ROGERS, Mike Dennis' -> 'Mike Rogers'; a nickname in brackets wins: 'BIDEN, Joseph Robinette (Joe), Jr.' -> 'Joe Biden'."""
    bioname = (bioname or "").strip()
    if "," not in bioname:
        return title_word(bioname)
    last, rest = bioname.split(",", 1)
    rest = NAME_SUFFIX.sub("", rest.strip()).strip().rstrip(",")
    nick = re.search(r"\(([^)]+)\)", rest)
    first = nick.group(1) if nick else (rest.split()[0] if rest.split() else "")
    return f"{first} {title_word(last.strip())}".strip()


def seat_label(chamber, state, district, districts_in_state):
    """'CA-12' for a House seat, 'AK-AL' for a state's only seat, 'CA' for a senator.

    Voteview numbers an at-large seat 1, so a state whose only district is 1 is at large."""
    if chamber == "S":
        return state
    if district in ("", "0"):
        return state
    return f"{state}-AL" if districts_in_state == {"1"} else f"{state}-{district}"


def fetch(name, kind, tries=4):
    """The local copy of a Voteview file, downloaded when missing; None if Voteview has none."""
    path = RAW / name
    if path.exists():
        return path
    RAW.mkdir(parents=True, exist_ok=True)
    url = f"{BASE_URL}/{kind}/{name}"
    part = path.with_suffix(".part")
    for attempt in range(tries):
        print(f"Downloading {url}")
        try:
            urllib.request.urlretrieve(url, part)
            part.replace(path)
            return path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            error = e
        except (urllib.error.URLError, OSError) as e:
            error = e
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Could not download {url}: {error}")


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def build_chamber(chamber, congress):
    tag = f"{chamber}{congress:03d}"
    members_path = fetch(f"{tag}_members.csv", "members")
    votes_path = fetch(f"{tag}_votes.csv", "votes")
    rolls_path = fetch(f"{tag}_rollcalls.csv", "rollcalls")
    if not (members_path and votes_path and rolls_path):
        return None

    info = {}
    for r in read_csv(members_path):
        if r["chamber"] != CHAMBERS[chamber] or r["state_abbrev"] in NON_STATES:
            continue
        info[int(float(r["icpsr"]))] = r
    parties = {icpsr: int(float(r["party_code"])) for icpsr, r in info.items()}
    votes = ((int(float(r["rollnumber"])), int(float(r["icpsr"])), int(float(r["cast_code"])))
             for r in read_csv(votes_path))
    unity, scored = score_members(parties, votes)
    rolls = list(read_csv(rolls_path))

    district = {icpsr: (r["district_code"] or "").split(".")[0] for icpsr, r in info.items()}
    districts = defaultdict(set)
    for icpsr, r in info.items():
        districts[r["state_abbrev"]].add(district[icpsr])

    rows = []
    for icpsr, s in scored.items():
        if not s["votes"]:
            continue  # delegates, and members who never cast a vote on a party-unity roll call
        r = info[icpsr]
        state = r["state_abbrev"]
        row = {"n": display_name(r["bioname"]), "p": s["party"],
               "s": seat_label(chamber, state, district[icpsr], districts[state]),
               "v": s["votes"], "w": s["with"], "id": icpsr}
        if s["party"] == "I" and s["caucus"]:
            row["c"] = s["caucus"]
        rows.append(row)
    rows.sort(key=lambda m: (m["n"].split()[-1], m["n"]))
    summary = {
        "rollcalls": len(rolls),
        "unityVotes": unity,
        "minVotes": min_votes(unity),
        "average": party_averages(scored, unity),
        "lastVote": max((r["date"] for r in rolls), default=None),
    }
    return tag, rows, summary


def build(first=FIRST_CONGRESS, last=LAST_CONGRESS):
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for congress in range(first, last + 1):
        start, end = congress_years(congress)
        entry = {"congress": congress, "start": start, "end": end}
        for chamber, key in (("H", "house"), ("S", "senate")):
            built = build_chamber(chamber, congress)
            if not built:
                print(f"warning: no Voteview data for {chamber}{congress:03d}")
                continue
            tag, rows, summary = built
            write_json(OUT / f"{tag}.json", rows)
            entry[key] = summary
        if "house" in entry or "senate" in entry:
            index.append(entry)
            h, s = entry.get("house", {}), entry.get("senate", {})
            print(f"{congress}: House {h.get('unityVotes')}/{h.get('rollcalls')} unity votes {h.get('average')}, "
                  f"Senate {s.get('unityVotes')}/{s.get('rollcalls')} {s.get('average')}")
    write_json(OUT / "index.json", {
        "source": "Voteview: Lewis, Poole, Rosenthal, Boche, Rudkin and Sonnet, Congressional Roll-Call Votes Database, voteview.com",
        "congresses": index,
    })
    print(f"Wrote {OUT}")


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


if __name__ == "__main__":
    args = [int(a) for a in sys.argv[1:3]]
    build(*args)
