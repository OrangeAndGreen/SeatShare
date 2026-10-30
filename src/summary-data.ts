// The "Summary" tab: President, Senate and House side by side, across elections and
// state by state. Pure functions, no DOM.

import { makeRow, NATIONAL, PARTIES, type Counts, type Row, type StateResult, type Summary } from "./shares";

export type Federal = "president" | "senate" | "house";

export const FEDERAL: Federal[] = ["president", "senate", "house"];

/** Democratic minus Republican share, of the votes or of the seats: + favours D. */
export function voteMargin(row: Row): number {
  return row.voteShare.D - row.voteShare.R;
}

export function seatMargin(row: Row): number {
  return row.seatShare.D - row.seatShare.R;
}

/** Every year with a President, Senate or House result, in order. */
export function summaryYears(summary: Summary): number[] {
  return [...new Set(FEDERAL.flatMap((o) => summary.offices[o]))].sort((a, b) => a - b);
}

/** An office's result for the nation or one state, or none when it had no election there. */
export function areaRow(summary: Summary, office: Federal, area: string, year: number): Row | undefined {
  return rangeRow(summary, office, area, year, year);
}

/**
 * An office's votes and seats added up over its elections from one year to another,
 * for the nation (every state) or one state; none when it had no election there.
 */
export function rangeRow(
  summary: Summary, office: Federal, area: string, from: number, to: number,
): Row | undefined {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const sum: StateResult = { votes: zero(), seats: zero(), uncontested: 0 };
  let any = false;
  for (const year of summary.offices[office]) {
    if (year < lo || year > hi) continue;
    const results = summary.results[office][year] ?? {};
    for (const po of area === NATIONAL ? Object.keys(results) : [area]) {
      const r = results[po];
      if (!r) continue;
      any = true;
      add(sum.votes, r.votes);
      add(sum.seats, r.seats);
      sum.uncontested! += r.uncontested ?? 0;
    }
  }
  if (!any) return undefined;
  const name = area === NATIONAL ? "United States" : summary.states.find((s) => s.po === area)?.name ?? area;
  return makeRow(area, name, sum);
}

function zero(): Counts {
  return { D: 0, R: 0, O: 0 };
}

function add(into: Counts, c: Counts): void {
  for (const p of PARTIES) into[p] += c[p];
}

export type OfficeRows = Partial<Record<Federal, Row>>;

export interface SummaryPoint {
  year: number;
  rows: OfficeRows;
}

/** One point per election year, with whichever offices were up. */
export function summaryPoints(summary: Summary, area: string): SummaryPoint[] {
  return summaryYears(summary).flatMap((year) => {
    const rows: OfficeRows = {};
    for (const o of FEDERAL) {
      const row = areaRow(summary, o, area, year);
      if (row) rows[o] = row;
    }
    return Object.keys(rows).length ? [{ year, rows }] : [];
  });
}

export interface StateLine {
  po: string;
  name: string;
  rows: OfficeRows;
}

/** The nation, then each state with any result from one year to another, added up. */
export function stateLines(
  summary: Summary, from: number, to: number,
): { national: StateLine; states: StateLine[] } {
  const line = (po: string, name: string): StateLine => {
    const rows: OfficeRows = {};
    for (const o of FEDERAL) {
      const row = rangeRow(summary, o, po, from, to);
      if (row) rows[o] = row;
    }
    return { po, name, rows };
  };
  return {
    national: line(NATIONAL, "United States"),
    states: summary.states.map((s) => line(s.po, s.name)).filter((l) => Object.keys(l.rows).length),
  };
}

export type Column = "votes" | "seats" | "gap" | "seatGap";
export type SummaryKey = "name" | `${Federal}:${Column}`;

/** The columns each office shows; only the House has enough seats for a gap in seats to say much. */
export const COLUMNS: Record<Federal, Column[]> = {
  president: ["votes", "seats", "gap"],
  senate: ["votes", "seats", "gap"],
  house: ["votes", "seats", "gap", "seatGap"],
};

export const SUMMARY_KEYS: SummaryKey[] = [
  "name", ...FEDERAL.flatMap((o) => COLUMNS[o].map((c) => `${o}:${c}` as SummaryKey)),
];

export function isSummaryKey(v: string): v is SummaryKey {
  return (SUMMARY_KEYS as string[]).includes(v);
}

export function columnValue(row: Row, column: Column): number {
  switch (column) {
    case "votes": return voteMargin(row);
    case "seats": return seatMargin(row);
    case "gap": return row.gap;
    case "seatGap": return row.seatGap;
  }
}

/**
 * Margins sort from most Democratic to most Republican; gaps sort by size, whichever
 * party they favour. A state with no election for that office sorts last either way.
 */
export function sortLines(lines: StateLine[], key: SummaryKey, descending: boolean): StateLine[] {
  if (key === "name") {
    return [...lines].sort((a, b) => (descending ? -1 : 1) * a.name.localeCompare(b.name));
  }
  const [office, column] = key.split(":") as [Federal, Column];
  const value = (l: StateLine): number | undefined => {
    const row = l.rows[office];
    if (!row) return undefined;
    const v = columnValue(row, column);
    return column === "gap" || column === "seatGap" ? Math.abs(v) : v;
  };
  return [...lines].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) {
      return x === y ? a.name.localeCompare(b.name) : x === undefined ? 1 : -1;
    }
    return (descending ? y - x : x - y) || a.name.localeCompare(b.name);
  });
}

/** "D +4.2" / "R +12.0" / "Even", from a margin or gap between -1 and 1. */
export function formatMargin(v: number, digits = 1): string {
  const points = Math.abs(v) * 100;
  if (points < 0.5 * 10 ** -digits) return "Even";
  return `${v > 0 ? "D" : "R"} +${points.toFixed(digits)}`;
}
