// The sortable list: one row per state, vote share against seat share.

import { formatGap, formatSeatGap, formatSeats, pct, sortRows, type Office, type Row, type SortKey } from "./shares";
import { escapeHtml, shareBar } from "./ui";

interface Column {
  key: SortKey;
  label: string;
  cell: (r: Row, office: Office) => string;
  firstDescending: boolean;
}

const COLUMNS: Column[] = [
  {
    key: "name", label: "State", firstDescending: false,
    cell: (r) => r.po === "US" ? r.name : `<a href="#/state/${r.po}">${escapeHtml(r.name)}</a>`,
  },
  {
    key: "seats", label: "Seats", firstDescending: true,
    cell: (r) => String(r.totalSeats),
  },
  {
    key: "demVotes", label: "D votes", firstDescending: true,
    cell: (r) => pct(r.voteShare.D),
  },
  {
    key: "demSeats", label: "D seats", firstDescending: true,
    cell: (r) => pct(r.seatShare.D, 0),
  },
  {
    key: "repVotes", label: "R votes", firstDescending: true,
    cell: (r) => pct(r.voteShare.R),
  },
  {
    key: "repSeats", label: "R seats", firstDescending: true,
    cell: (r) => pct(r.seatShare.R, 0),
  },
  {
    key: "gap", label: "Gap, points", firstDescending: true,
    cell: (r) => formatGap(r.gap),
  },
  {
    key: "seatGap", label: "Gap, seats", firstDescending: true,
    cell: (r) => formatSeatGap(r.seatGap),
  },
];

export const SORT_KEYS: SortKey[] = COLUMNS.map((c) => c.key);

export interface ListState {
  key: SortKey;
  descending: boolean;
}

export function drawList(
  container: HTMLElement,
  rows: Row[],
  national: Row,
  office: Office,
  sort: ListState,
  onSort: (s: ListState) => void,
): void {
  const seatsLabel = office !== "president" ? "Seats" : "Electors";
  const sorted = sortRows(rows, sort.key, sort.descending);
  const head = COLUMNS.map((c) => {
    const label = c.key === "seats" ? seatsLabel : c.label.replace(/seats$/, office !== "president" ? "seats" : "electors");
    const aria = c.key === sort.key ? (sort.descending ? "descending" : "ascending") : "none";
    return `<th scope="col" aria-sort="${aria}"><button data-key="${c.key}">${label}</button></th>`;
  }).join("") + `<th scope="col">Split</th>`;

  const line = (r: Row, cls = "") =>
    `<tr class="${cls}">${COLUMNS.map((c) => `<td>${c.cell(r, office)}</td>`).join("")}`
    + `<td><span class="muted">${formatSeats(r.seats)}</span>${shareBar(r.seatShare.D, r.seatShare.R)}`
    + `${r.uncontested ? ` <span class="muted" title="Uncontested seats">· ${r.uncontested} unc.</span>` : ""}</td></tr>`;

  container.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>${head}</tr></thead>
    <tbody>${line(national, "national")}${sorted.map((r) => line(r)).join("")}</tbody>
  </table></div>`;

  container.querySelectorAll<HTMLButtonElement>("th button").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.key as SortKey;
      const col = COLUMNS.find((c) => c.key === key)!;
      onSort(key === sort.key
        ? { key, descending: !sort.descending }
        : { key, descending: col.firstDescending });
    });
  });
}
