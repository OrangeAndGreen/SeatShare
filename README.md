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

Electoral votes are the state's House seats plus two (DC has three), winner-take-all
except the recorded Maine and Nebraska district splits. Faithless electors are ignored.

## Site

Vite + TypeScript + D3. `npm run dev` to work on it, `npm test` for the unit tests.
Pushing to `master` deploys to Pages.
