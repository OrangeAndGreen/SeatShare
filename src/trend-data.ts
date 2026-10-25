// Results across elections for the "Over time" tab. Pure functions, no DOM.

import {
  buildRows, makeRow, nationalRow, NATIONAL, OFFICES, PARTIES, votesUnreliable, type Office, type Party, type Row, type Summary,
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

// Comparing offices: one line per office for a metric that doesn't depend on its size.

export const COMPARE = "compare";
export type TrendOffice = Office | typeof COMPARE;

export const COMPARE_METRICS: { value: Metric; text: string }[] = [
  { value: "gap", text: "Seat gap, in points" },
  { value: "voteShare", text: "Democratic vote share" },
  { value: "seatShare", text: "Democratic seat share" },
];

export function isCompareMetric(metric: Metric): boolean {
  return COMPARE_METRICS.some((m) => m.value === metric);
}

/** The years with a result for any of the offices, in order. */
export function trendYears(summary: Summary, office: TrendOffice, offices: Office[]): number[] {
  if (office !== COMPARE) return summary.offices[office];
  return [...new Set(offices.flatMap((o) => summary.offices[o]))].sort((a, b) => a - b);
}

/** An office's value in a comparison, or none when it rests on votes mostly missing. */
export function compareValue(row: Row, metric: Metric): number | undefined {
  if (metric === "seatShare") return row.seatShare.D;
  if (votesUnreliable(row)) return undefined;
  return metric === "voteShare" ? row.voteShare.D : row.gap;
}

export interface CompareSeries {
  office: Office;
  points: { year: number; value: number; row: Row }[];
}

/** One series per office, each with the years it has a value. */
export function compareSeries(
  summary: Summary, offices: Office[], area: string, metric: Metric, from: number, to: number,
): CompareSeries[] {
  return offices.map((office) => ({
    office,
    points: trendPoints(summary, office, area, from, to).flatMap((p) => {
      const value = compareValue(p.row, metric);
      return value === undefined ? [] : [{ year: p.year, value, row: p.row }];
    }),
  }));
}

const ALL_OFFICES: Office[] = OFFICES.map((o) => o.value);

/** The offices named in a URL, in menu order; all of them when none are named. */
export function parseOffices(param: string | null): Office[] {
  const named = new Set((param ?? "").split(","));
  const offices = ALL_OFFICES.filter((o) => named.has(o));
  return offices.length ? offices : ALL_OFFICES;
}

/** The URL form of an office list: empty when it is all of them. */
export function formatOffices(offices: Office[]): string {
  return offices.length === ALL_OFFICES.length ? "" : offices.join(",");
}
