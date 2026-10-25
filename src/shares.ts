// Vote share, seat share and the gap between them. Pure functions, no DOM.

export type Party = "D" | "R" | "O";
export type Counts = Record<Party, number>;
export type Office = "house" | "senate" | "president" | "statehouse" | "statesenate";

export const OFFICES: { value: Office; text: string }[] = [
  { value: "house", text: "US House" },
  { value: "senate", text: "US Senate" },
  { value: "president", text: "President" },
  { value: "statehouse", text: "State House" },
  { value: "statesenate", text: "State Senate" },
];

/** State legislative chambers, from Klarner's returns. */
export function isLegislature(office: Office): boolean {
  return office === "statehouse" || office === "statesenate";
}

/** Over half the seats up have no votes recorded: the vote share means little. */
export function votesUnreliable(row: Row): boolean {
  return row.noVotes * 2 > row.totalSeats;
}

export function isOffice(v: string | undefined): v is Office {
  return OFFICES.some((o) => o.value === v);
}

export function officeName(office: Office): string {
  return OFFICES.find((o) => o.value === office)!.text;
}

export interface StateInfo {
  po: string;
  name: string;
  fips: string;
}

export interface SenateRace {
  winner: string;
  party: Party;
  special: boolean;
}

export interface StateResult {
  votes: Counts;
  seats: Counts;
  uncontested?: number;
  /** State legislatures: seats with no votes recorded, mostly uncontested seats left off the ballot. */
  noVotes?: number;
  /** Senate only: the races that year, two when there was a special. */
  races?: SenateRace[];
}

export interface District {
  district: number;
  winner: string;
  party: Party;
  votes: Counts;
  uncontested: boolean;
}

export interface Summary {
  states: StateInfo[];
  offices: Record<Office, number[]>;
  nominees: Record<string, Partial<Record<Party, string>>>;
  source: string;
  results: Record<Office, Record<string, Record<string, StateResult>>>;
}

export interface Row {
  po: string;
  name: string;
  votes: Counts;
  seats: Counts;
  voteShare: Counts;
  seatShare: Counts;
  /** Seat share minus vote share, Democrats less Republicans, halved: + favours D. */
  gap: number;
  /** The gap in seats: how many seats beyond a proportional split. + favours D. */
  seatGap: number;
  totalVotes: number;
  totalSeats: number;
  uncontested: number;
  noVotes: number;
}

export const PARTIES: Party[] = ["D", "R", "O"];
export const NATIONAL = "US";

export function total(c: Counts): number {
  return c.D + c.R + c.O;
}

export function shares(c: Counts): Counts {
  const t = total(c);
  if (t === 0) return { D: 0, R: 0, O: 0 };
  return { D: c.D / t, R: c.R / t, O: c.O / t };
}

/** How far seats ran ahead of votes: + for Democrats, - for Republicans. */
export function seatBonus(voteShare: Counts, seatShare: Counts): number {
  return (seatShare.D - voteShare.D - (seatShare.R - voteShare.R)) / 2;
}

export function makeRow(po: string, name: string, r: StateResult): Row {
  const voteShare = shares(r.votes);
  const seatShare = shares(r.seats);
  const gap = seatBonus(voteShare, seatShare);
  return {
    po,
    name,
    votes: r.votes,
    seats: r.seats,
    voteShare,
    seatShare,
    gap,
    seatGap: gap * total(r.seats),
    totalVotes: total(r.votes),
    totalSeats: total(r.seats),
    uncontested: r.uncontested ?? 0,
    noVotes: r.noVotes ?? 0,
  };
}

export function buildRows(states: StateInfo[], results: Record<string, StateResult>): Row[] {
  return states
    .filter((s) => results[s.po])
    .map((s) => makeRow(s.po, s.name, results[s.po]));
}

export function nationalRow(rows: Row[]): Row {
  const add = (pick: (r: Row) => Counts): Counts => {
    const c: Counts = { D: 0, R: 0, O: 0 };
    for (const r of rows) for (const p of PARTIES) c[p] += pick(r)[p];
    return c;
  };
  const uncontested = rows.reduce((n, r) => n + r.uncontested, 0);
  const noVotes = rows.reduce((n, r) => n + r.noVotes, 0);
  return makeRow(NATIONAL, "United States", {
    votes: add((r) => r.votes),
    seats: add((r) => r.seats),
    uncontested,
    noVotes,
  });
}

export type SortKey =
  | "name" | "seats" | "demVotes" | "demSeats" | "repVotes" | "repSeats" | "gap" | "seatGap";

// The gaps sort by size, whichever party they favour.
const sortValue: Record<SortKey, (r: Row) => number | string> = {
  name: (r) => r.name,
  seats: (r) => r.totalSeats,
  demVotes: (r) => r.voteShare.D,
  demSeats: (r) => r.seatShare.D,
  repVotes: (r) => r.voteShare.R,
  repSeats: (r) => r.seatShare.R,
  gap: (r) => Math.abs(r.gap),
  seatGap: (r) => Math.abs(r.seatGap),
};

// Keys that rest on the vote. A state whose votes are mostly missing sorts last by them.
const BY_VOTES: SortKey[] = ["demVotes", "repVotes", "gap", "seatGap"];

export function sortRows(rows: Row[], key: SortKey, descending: boolean): Row[] {
  const get = sortValue[key];
  const byVotes = BY_VOTES.includes(key);
  return [...rows].sort((a, b) => {
    if (byVotes && votesUnreliable(a) !== votesUnreliable(b)) return votesUnreliable(a) ? 1 : -1;
    const x = get(a);
    const y = get(b);
    const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return (descending ? -c : c) || a.name.localeCompare(b.name);
  });
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** "D +12.3" / "R +4.0" / "Even", in percentage points. */
export function formatGap(gap: number): string {
  const points = Math.abs(gap) * 100;
  if (points < 0.05) return "Even";
  return `${gap > 0 ? "D" : "R"} +${points.toFixed(1)}`;
}

/** "R +3.1" / "D +0.4" / "Even", in seats. */
export function formatSeatGap(seats: number): string {
  if (Math.abs(seats) < 0.05) return "Even";
  return `${seats > 0 ? "D" : "R"} +${Math.abs(seats).toFixed(1)}`;
}

/** "5 R, 1 D": the larger side first, parties with no seats left out. */
export function formatSeats(c: Counts): string {
  return PARTIES.filter((p) => c[p] > 0)
    .sort((a, b) => c[b] - c[a])
    .map((p) => `${c[p]} ${p === "O" ? "Ind" : p}`)
    .join(", ");
}

/** Democratic minus Republican share, -1 (all R) to +1 (all D). */
export function margin(share: Counts): number {
  return share.D - share.R;
}
