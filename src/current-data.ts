// The "Current" tab: who holds each federal office now, and the votes from the election
// that put each of them there. Pure functions, no DOM.

import { makeRow, NATIONAL, PARTIES, type Counts, type Party, type Row, type Summary } from "./shares";
import { FEDERAL, formatMargin, seatMargin, voteMargin, type Federal } from "./summary-data";

export type SeatClass = 1 | 2 | 3;

export interface SenateSeat {
  seatClass: SeatClass;
  year: number;
  winner: string;
  party: Party;
  special: boolean;
  votes: Counts;
  /** The next regular election for the seat, or the special called to fill it. */
  next: number;
  /** Who holds the seat now when they were appointed rather than elected. */
  appointed?: string;
}

// Seats filled by appointment since the last election, and the special that will
// settle them. The votes stay those of the last election for the seat.
export const APPOINTED: Record<string, { name: string; replaced: string; special: number }> = {
  "FL-3": { name: "Ashley Moody", replaced: "Marco Rubio", special: 2026 },
  "OH-3": { name: "Jon Husted", replaced: "JD Vance", special: 2026 },
};

/** Class I seats are up in years like 2024, II in 2026, III in 2028. */
export function nextRegular(seatClass: SeatClass, after: number): number {
  const rest = { 1: 2, 2: 4, 3: 0 }[seatClass];
  let y = after + 1;
  while (y % 6 !== rest) y++;
  return y;
}

/** A state's current senators: for each seat class, its latest race, a regular before a special the same year. */
export function currentSeats(summary: Summary, po: string): SenateSeat[] {
  const seats = new Map<SeatClass, SenateSeat>();
  const years = [...summary.offices.senate].sort((a, b) => b - a);
  for (const year of years) {
    const races = summary.results.senate[year]?.[po]?.races ?? [];
    for (const race of [...races].sort((a, b) => Number(a.special) - Number(b.special))) {
      const c = race.class;
      if (!c || !race.votes || seats.has(c)) continue;
      const appointed = APPOINTED[`${po}-${c}`];
      seats.set(c, {
        seatClass: c, year, winner: race.winner, party: race.party, special: race.special, votes: race.votes,
        next: appointed ? appointed.special : nextRegular(c, year),
        appointed: appointed?.name,
      });
    }
  }
  return [...seats.values()].sort((a, b) => a.next - b.next || a.seatClass - b.seatClass);
}

export interface CurrentLine {
  po: string;
  name: string;
  rows: Partial<Record<Federal, Row>>;
  senators: SenateSeat[];
}

/** The latest year an office was elected. */
export function latestYear(summary: Summary, office: "president" | "house"): number {
  return Math.max(...summary.offices[office]);
}

function zero(): Counts {
  return { D: 0, R: 0, O: 0 };
}

function add(into: Counts, c: Counts): void {
  for (const p of PARTIES) into[p] += c[p];
}

/** The Senate as it stands: the current seats' votes added up, one seat each. */
function senateRow(po: string, name: string, seats: SenateSeat[]): Row | undefined {
  if (!seats.length) return undefined;
  const votes = zero();
  const won = zero();
  for (const s of seats) {
    add(votes, s.votes);
    won[s.party] += 1;
  }
  return makeRow(po, name, { votes, seats: won });
}

/** The nation, then every state, as the offices stand after their latest elections. */
export function currentLines(summary: Summary): { national: CurrentLine; states: CurrentLine[] } {
  const pres = summary.results.president[latestYear(summary, "president")] ?? {};
  const house = summary.results.house[latestYear(summary, "house")] ?? {};
  const states = summary.states.map((s): CurrentLine => {
    const senators = currentSeats(summary, s.po);
    const rows: CurrentLine["rows"] = {};
    if (pres[s.po]) rows.president = makeRow(s.po, s.name, pres[s.po]);
    const senate = senateRow(s.po, s.name, senators);
    if (senate) rows.senate = senate;
    if (house[s.po]) rows.house = makeRow(s.po, s.name, house[s.po]);
    return { po: s.po, name: s.name, rows, senators };
  }).filter((l) => Object.keys(l.rows).length);

  const rows: CurrentLine["rows"] = {};
  for (const o of FEDERAL) {
    const lines = states.filter((l) => l.rows[o]);
    if (!lines.length) continue;
    const votes = zero();
    const seats = zero();
    let uncontested = 0;
    for (const l of lines) {
      add(votes, l.rows[o]!.votes);
      add(seats, l.rows[o]!.seats);
      uncontested += l.rows[o]!.uncontested;
    }
    rows[o] = makeRow(NATIONAL, "United States", { votes, seats, uncontested });
  }
  return {
    national: { po: NATIONAL, name: "United States", rows, senators: states.flatMap((l) => l.senators) },
    states,
  };
}

export type CurrentColumn = "votes" | "seats" | "gap" | "seatGap" | "uncontested" | "next";
export type CurrentKey = "name" | `${Federal}:${CurrentColumn}`;

/** The columns each office shows, after the Senate's list of senators. */
export const CURRENT_COLUMNS: Record<Federal, CurrentColumn[]> = {
  president: ["votes", "seats", "gap"],
  senate: ["votes", "seats", "gap", "seatGap", "next"],
  house: ["votes", "seats", "gap", "seatGap", "uncontested"],
};

export const CURRENT_KEYS: CurrentKey[] = [
  "name", ...FEDERAL.flatMap((o) => CURRENT_COLUMNS[o].map((c) => `${o}:${c}` as CurrentKey)),
];

export function isCurrentKey(v: string): v is CurrentKey {
  return (CURRENT_KEYS as string[]).includes(v);
}

/** The first year one of the state's Senate seats is up. */
export function nextUp(line: CurrentLine): number | undefined {
  return line.senators.length ? Math.min(...line.senators.map((s) => s.next)) : undefined;
}

/** The value a column sorts by: margins from most Democratic, gaps by size. */
export function sortValue(line: CurrentLine, key: Exclude<CurrentKey, "name">): number | undefined {
  const [office, column] = key.split(":") as [Federal, CurrentColumn];
  const row = line.rows[office];
  if (!row) return undefined;
  switch (column) {
    case "votes": return voteMargin(row);
    case "seats": return seatMargin(row);
    case "gap": return Math.abs(row.gap);
    case "seatGap": return Math.abs(row.seatGap);
    case "uncontested": return row.uncontested;
    case "next": return nextUp(line);
  }
}

/** States with nothing in a column sort last either way. */
export function sortCurrent(lines: CurrentLine[], key: CurrentKey, descending: boolean): CurrentLine[] {
  if (key === "name") {
    return [...lines].sort((a, b) => (descending ? -1 : 1) * a.name.localeCompare(b.name));
  }
  return [...lines].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === undefined || y === undefined) {
      return x === y ? a.name.localeCompare(b.name) : x === undefined ? 1 : -1;
    }
    return (descending ? y - x : x - y) || a.name.localeCompare(b.name);
  });
}

/** A senator's own margin, Democratic minus Republican. */
export function seatMarginText(seat: SenateSeat): string {
  const { D, R, O } = seat.votes;
  return formatMargin(D + R + O ? (D - R) / (D + R + O) : 0);
}
