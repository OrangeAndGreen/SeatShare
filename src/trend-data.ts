// Results across elections for the "Over time" tab. Pure functions, no DOM.

import {
  buildRows, makeRow, nationalRow, NATIONAL, PARTIES, type Office, type Party, type Row, type Summary,
} from "./shares";

export type Metric = "seats" | "voteShare" | "seatShare" | "gap" | "seatGap" | "split";

export const METRICS: { value: Metric; text: string }[] = [
  { value: "seatGap", text: "Seat gap, in seats" },
  { value: "gap", text: "Seat gap, in points" },
  { value: "voteShare", text: "Vote share" },
  { value: "seatShare", text: "Seat share" },
  { value: "seats", text: "Seats won" },
  { value: "split", text: "Seat split" },
];

/** Metrics drawn as one line per party; the rest are bars. */
export const PER_PARTY: Metric[] = ["seats", "voteShare", "seatShare"];

export interface TrendPoint {
  year: number;
  row: Row;
}

/** One point per election in [from, to], for the nation or one state. */
export function trendPoints(
  summary: Summary, office: Office, area: string, from: number, to: number,
): TrendPoint[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const points: TrendPoint[] = [];
  for (const year of summary.offices[office]) {
    if (year < lo || year > hi) continue;
    const results = summary.results[office][year];
    if (!results) continue;
    if (area === NATIONAL) {
      points.push({ year, row: nationalRow(buildRows(summary.states, results)) });
    } else if (results[area]) {
      points.push({ year, row: makeRow(area, "", results[area]) });
    }
  }
  return points;
}

/** D and R always; Other only when it ever has any of this metric. */
export function partiesShown(points: TrendPoint[], metric: Metric): Party[] {
  const any = points.some((p) => partyValue(p.row, metric, "O") > 0);
  return PARTIES.filter((p) => p !== "O" || any);
}

export function partyValue(row: Row, metric: Metric, party: Party): number {
  if (metric === "voteShare") return row.voteShare[party];
  if (metric === "seatShare") return row.seatShare[party];
  return row.seats[party];
}

/** The single signed value of a bar metric: + favours D. */
export function gapValue(row: Row, metric: Metric): number {
  return metric === "seatGap" ? row.seatGap : row.gap;
}

/** Clamp a year range to the office's elections, keeping from <= to. */
export function clampRange(years: number[], from: number, to: number): [number, number] {
  const first = years[0];
  const last = years[years.length - 1];
  const lo = Math.max(first, Math.min(from, to));
  const hi = Math.min(last, Math.max(from, to));
  return lo <= hi ? [lo, hi] : [first, last];
}
