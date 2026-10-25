# SeatShare

US election results explorer: maps and lists of past results, comparing each party's
share of the vote with its share of the seats won. Static site for GitHub Pages:
https://orangeandgreen.github.io/SeatShare/

## Data

`scripts/build_data.py` turns the MIT Election Data and Science Lab returns into the
small JSON files in `public/data/`, which are committed so the site builds without them.

| File in `data/raw/` | Source |
|---|---|
| `1976-2024-house.tab` | [US House 1976-2024](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/IG0UN2). Behind a guestbook form, so download it by hand. |
| `1976-2024-president.csv` | [President 1976-2024](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/42MVDX). Downloaded by the script when missing. |
| `1976-2024-senate.csv` | [US Senate 1976-2024](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/PEJ5QU). Downloaded by the script when missing. Tab-separated despite the name. |

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

Electoral votes are the state's House seats plus two (DC has three), winner-take-all
except the recorded Maine and Nebraska district splits. Faithless electors are ignored.

## Site

Vite + TypeScript + D3. `npm run dev` to work on it, `npm test` for the unit tests.
Pushing to `master` deploys to Pages.
