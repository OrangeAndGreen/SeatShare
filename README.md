# SeatShare

US election results explorer: maps and lists of past results, comparing each party's
share of the vote with its share of the seats won. Static site for GitHub Pages:
https://orangeandgreen.github.io/SeatShare/

## Data

`scripts/build_data.py` turns the MIT Election Data and Science Lab returns and Klarner's
state legislative returns into the
small JSON files in `public/data/`, which are committed so the site builds without them.

| File in `data/raw/` | Source |
|---|---|
| `1976-2024-house.tab` | [US House 1976-2024](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/IG0UN2). Behind a guestbook form, so download it by hand. |
| `1976-2024-president.csv` | [President 1976-2024](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/42MVDX). Downloaded by the script when missing. |
| `1976-2024-senate.csv` | [US Senate 1976-2024](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/PEJ5QU). Downloaded by the script when missing. Tab-separated despite the name. |
| `1968-2022-state-legislatures.csv` | [Carl Klarner, State Legislative Election Returns 1967-2022](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/FJOGJB), the file with one row per contest (`202slers_uoa_contest`). Downloaded by the script when missing. |

```
python scripts/build_data.py
python -m unittest discover -s tests
```

How the House file is read:

- Votes are the November round. A candidate's votes are summed across party lines
  (fusion tickets) and they count for the major party whose line gave them most.
- A runoff, where there was one, decides the winner. Texas's court-ordered specials
  in 1996 and 2006 stand in for the regular elections there.
- Blank, over and under votes and exhausted ranked-choice ballots are left out.
  The DC delegate is left out.
- Uncontested seats are counted. Florida records their winners as 1 vote, so they
  pull a party's vote share down.

How the Senate file is read:

- One race per state, year and regular/special, so a state can fill two seats in a
  year (Georgia in 2020, Nebraska in 2024). Its votes are the two races added up.
- Votes are the November round; a runoff decides the winner. Georgia files its
  November round as `pre` in 1992 and 2008, its 2022 runoff as `gen runoff`, and
  its January 2021 runoffs under 2021, which count for 2020.
- The party is read from `party_detailed` first, because `party_simplified` calls
  some Democrats Other. A few candidates with no party at all, and two Louisiana
  races whose rounds are mixed up, are corrected in `SENATE_PARTIES` and
  `SENATE_FIXES` in the script.
- Independents (Sanders, King, Lieberman in 2006, Murkowski's 2010 write-in) count
  as Other.
- The file has no Connecticut 2022 race; the certified result is added from
  `SENATE_MISSING` in the script.
- Each race keeps its own votes and the seat class it filled, which the "Current" tab
  uses to find each state's two sitting senators. A regular race's class follows from
  its year; specials since 2018 are listed in `SENATE_SPECIAL_CLASSES`.

How the state legislature file is read:

- One result per state, chamber and year. Seats are the seats up that year, so a
  senate with staggered terms counts about half its seats.
- A contest's votes are divided by its number of seats, so a voter in a multimember
  district counts once.
- Odd-year elections (Virginia, New Jersey, Mississippi, Kentucky to 1983) count for
  the next even year. Where that puts two elections of one chamber in the same year
  (Virginia's House in 1981 and its court-ordered 1982 election, Mississippi in 1991
  and 1992, the Rhode Island Senate in 1983 and 1984), the later one is used.
- Arkansas, Florida, Oklahoma and Hawaii leave uncontested races off the ballot, so
  those seats have no votes (`noVotes`). Where that is over half the seats up, the
  map hatches the state and the list sorts it last by votes and gaps.
- Louisiana (jungle primaries) and Nebraska (nonpartisan) are not in the file, nor is
  Minnesota before 1974, when its legislature was nonpartisan.

Electoral votes are the state's House seats plus two (DC has three), winner-take-all
except the recorded Maine and Nebraska district splits. Faithless electors are ignored.

## Party lines

`scripts/build_unity.py` builds the "Party lines" tab from [Voteview](https://voteview.com)'s
roll calls (Lewis, Poole, Rosenthal, Boche, Rudkin and Sonnet), which need no key. It
downloads the members, votes and roll-call CSVs for each Congress and chamber into
`data/raw/voteview/` (about 475 MB for the 80th-119th Congresses, not committed) and
writes one small file per chamber and Congress to `public/data/unity/`, with
`index.json` holding each one's party averages.

```
python scripts/build_unity.py            # 80th (1947) to 119th Congress
python scripts/build_unity.py 100 119    # or any range of Congresses
```

The measure is Congressional Quarterly's party unity:

- A party-unity vote is a roll call where most voting Democrats voted against most
  voting Republicans. Only Yea and Nay count; paired and announced positions, Present
  and not voting don't.
- A member's score is the share of the party-unity votes they cast where they voted
  with their party's majority. Breaks are the votes against it.
- Independents are scored against the party they voted with more often on those
  votes (the one they caucus with, in practice), and don't count toward either
  party's majority. Voteview gives a member who changed party a new id, so they are
  listed once for each party.
- Delegates and the resident commissioner are left out.
- Members who cast fewer than a quarter of the party-unity votes (at least 10) are
  listed but not ranked, and are left out of the party averages.

## Site

Vite + TypeScript + D3. `npm run dev` to work on it, `npm test` for the unit tests.
Pushing to `master` deploys to Pages.
