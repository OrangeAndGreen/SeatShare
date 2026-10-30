// The "Current" tab: every state's President, senators and House members as they
// stand, with the votes from the election that put each of them in office.

import { officeSwatch } from "./compare";
import {
  APPOINTED, CURRENT_COLUMNS, currentLines, latestYear, nextUp, seatMarginText, sortCurrent,
  type CurrentColumn, type CurrentKey, type CurrentLine, type SenateSeat,
} from "./current-data";
import { formatGap, formatSeatGap, formatSeats, NATIONAL, officeName, pct, type Row, type Summary } from "./shares";
import { FEDERAL, formatMargin, seatMargin, voteMargin, type Federal } from "./summary-data";
import { escapeHtml, partyColor } from "./ui";

export interface CurrentState {
  sort: { key: CurrentKey; descending: boolean };
}

const COLUMN_LABEL: Record<CurrentColumn, (o: Federal) => string> = {
  votes: () => "Votes",
  seats: (o) => (o === "president" ? "Electors" : "Seats"),
  gap: () => "Gap, pts",
  seatGap: () => "Gap, seats",
  uncontested: () => "Uncontested",
  next: () => "Next up",
};

// Columns that read best smallest first.
const ASCENDING: CurrentKey[] = ["name", "senate:next"];

export function drawCurrent(
  container: HTMLElement,
  summary: Summary,
  st: CurrentState,
  onSort: (st: CurrentState) => void,
): void {
  const pres = latestYear(summary, "president");
  const house = latestYear(summary, "house");
  const nominees = summary.nominees[pres] ?? {};
  const { national, states } = currentLines(summary);
  const senate = national.rows.senate;

  const headline = document.createElement("div");
  headline.className = "headline";
  const stat = (k: string, v: string, s: string) =>
    `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const p = national.rows.president;
  const h = national.rows.house;
  headline.innerHTML = (p ? stat(`President, elected ${pres}`, `D ${pct(p.voteShare.D)} · R ${pct(p.voteShare.R)}`,
    `${escapeHtml(nominees.D ?? "")} ${p.seats.D} · ${escapeHtml(nominees.R ?? "")} ${p.seats.R} electors`) : "")
    + (senate ? stat("Senate, as elected", formatSeats(senate.seats),
      `${formatMargin(voteMargin(senate))} in the votes that elected them · ${formatSeatGap(senate.seatGap)} seats`) : "")
    + (h ? stat(`House, elected ${house}`, formatSeats(h.seats),
      `${formatMargin(voteMargin(h))} in the votes · ${formatSeatGap(h.seatGap)} seats`) : "");

  const head = document.createElement("div");
  head.innerHTML = `<h2>Every state's members now</h2>
    <p class="note">The President and House elected in ${pres === house ? pres : `${pres} and ${house}`}, and each
    state's two senators from the last election for their seats. A state's Senate votes add up the races that elected
    its two senators, whichever years those were, and its gap in seats is how many more seats a party holds than a
    split of those two in proportion to the votes. Margins are
    Democratic minus Republican share; hover one for each party's share. Sort by any column: margins sort from most
    Democratic, gaps by size whichever party they favour. Seats filled by appointment keep the votes of the last
    election for them. Vacancies and House specials since ${house} aren't shown.</p>`;
  const listBox = document.createElement("div");
  container.replaceChildren(headline, head, listBox);

  const render = (sort: CurrentState["sort"]) => drawTable(listBox, national, states, sort, (s) => {
    onSort({ sort: s });
    render(s);
  });
  render(st.sort);
}

function shareTitle(row: Row): string {
  return `D ${pct(row.voteShare.D)} · R ${pct(row.voteShare.R)}${row.voteShare.O >= 0.0005 ? ` · Other ${pct(row.voteShare.O)}` : ""}`;
}

function cell(line: CurrentLine, office: Federal, column: CurrentColumn): string {
  const row = line.rows[office];
  if (!row) return `<span class="muted">-</span>`;
  switch (column) {
    case "votes": return `<span title="${shareTitle(row)}">${formatMargin(voteMargin(row))}</span>`;
    case "seats": return `<span title="${formatMargin(seatMargin(row))}">${formatSeats(row.seats) || "-"}</span>`;
    case "gap": return formatGap(row.gap);
    case "seatGap": return formatSeatGap(row.seatGap);
    case "uncontested": return row.uncontested ? String(row.uncontested) : `<span class="muted">0</span>`;
    case "next": {
      const n = nextUp(line);
      const count = line.senators.filter((s) => s.next === n).length;
      if (n === undefined) return "-";
      if (line.po === NATIONAL) return `${count} in ${n}`;
      return `${n}${count > 1 ? " (both)" : ""}`;
    }
  }
}

function senatorHtml(po: string, seat: SenateSeat): string {
  const dot = `<span class="dot" style="background:${partyColor(seat.party)}"></span>`;
  const party = seat.party === "O" ? "Ind" : seat.party;
  const won = `${seat.special ? "special " : ""}${seat.year} ${seatMarginText(seat)}`;
  const a = APPOINTED[`${po}-${seat.seatClass}`];
  if (seat.appointed && a) {
    return `${dot}${escapeHtml(a.name)} (${party}) <span class="s">appointed for ${escapeHtml(a.replaced)}, who won
      ${won} · special ${seat.next}</span>`;
  }
  return `${dot}${escapeHtml(seat.winner)} (${party}) <span class="s">${won} · up ${seat.next}</span>`;
}

function drawTable(
  box: HTMLElement, national: CurrentLine, states: CurrentLine[], sort: CurrentState["sort"],
  onSort: (s: CurrentState["sort"]) => void,
): void {
  const sorted = sortCurrent(states, sort.key, sort.descending);
  const offices = FEDERAL.filter((o) => national.rows[o]);
  const th = (k: CurrentKey, label: string, cls = "") => {
    const aria = k === sort.key ? (sort.descending ? "descending" : "ascending") : "none";
    return `<th scope="col" class="${cls}" aria-sort="${aria}"><button data-key="${k}">${label}</button></th>`;
  };
  const span = (o: Federal) => CURRENT_COLUMNS[o].length + (o === "senate" ? 1 : 0);
  const groups = `<tr><th></th>${offices.map((o) =>
    `<th scope="colgroup" colspan="${span(o)}" class="group">${officeSwatch(o)} ${officeName(o)}</th>`).join("")}</tr>`;
  const officeHeads = (o: Federal) => (o === "senate" ? `<th scope="col" class="first">Senators</th>` : "")
    + CURRENT_COLUMNS[o].map((c, i) => th(`${o}:${c}`, COLUMN_LABEL[c](o), i === 0 && o !== "senate" ? "first" : "")).join("");
  const cols = `<tr>${th("name", "State")}${offices.map(officeHeads).join("")}</tr>`;

  const officeCells = (l: CurrentLine, o: Federal) => {
    const senators = o !== "senate" ? ""
      : `<td class="first senators">${l.po === NATIONAL ? `<span class="s">${l.senators.length} senators</span>`
        : l.senators.map((s) => senatorHtml(l.po, s)).join("<br>") || `<span class="muted">-</span>`}</td>`;
    return senators + CURRENT_COLUMNS[o].map((c, i) =>
      `<td${i === 0 && o !== "senate" ? ` class="first"` : ""}>${cell(l, o, c)}</td>`).join("");
  };
  const line = (l: CurrentLine, cls = "") => `<tr class="${cls}"><td>${l.po === NATIONAL ? l.name
    : `<a href="#/state/${l.po}">${escapeHtml(l.name)}</a>`}</td>${offices.map((o) => officeCells(l, o)).join("")}</tr>`;

  box.innerHTML = `<div class="table-wrap breakout"><table class="summary-table current-table">
    <thead>${groups}${cols}</thead>
    <tbody>${line(national, "national")}${sorted.map((l) => line(l)).join("")}</tbody>
  </table></div>`;

  box.querySelectorAll<HTMLButtonElement>("th button").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.key as CurrentKey;
      onSort(key === sort.key ? { key, descending: !sort.descending } : { key, descending: !ASCENDING.includes(key) });
    });
  });
}
