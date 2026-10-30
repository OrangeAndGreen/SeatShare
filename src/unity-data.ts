// Party-line voting: the data built by scripts/build_unity.py from Voteview, and the
// pure logic the "Party lines" tab uses to rank, sort and filter members.

export type Chamber = "house" | "senate";
export type MemberParty = "D" | "R" | "I";

/** One member's party-unity tally in one chamber and Congress. */
export interface Member {
  /** Display name. */
  n: string;
  p: MemberParty;
  /** The party an independent voted with more often, which their score is measured against. */
  c?: "D" | "R";
  /** State, or state and district: "CA-12", "AK-AL". */
  s: string;
  /** Party-unity votes they voted on (Yea or Nay). */
  v: number;
  /** Of those, the votes with their party's majority. */
  w: number;
  /** Voteview's ICPSR id. */
  id: number;
}

export interface ChamberSummary {
  rollcalls: number;
  unityVotes: number;
  /** Members with fewer party-unity votes than this are listed but not ranked. */
  minVotes: number;
  /** Mean score of each party's ranked members. */
  average: { D: number | null; R: number | null };
  lastVote: string | null;
}

export interface CongressEntry {
  congress: number;
  start: number;
  end: number;
  house?: ChamberSummary;
  senate?: ChamberSummary;
}

export interface UnityIndex {
  source: string;
  congresses: CongressEntry[];
}

export const CHAMBERS: { value: Chamber; text: string }[] = [
  { value: "house", text: "House" },
  { value: "senate", text: "Senate" },
];

export type PartyFilter = "all" | MemberParty;

export const PARTY_FILTERS: { value: PartyFilter; text: string }[] = [
  { value: "all", text: "All members" },
  { value: "D", text: "Democrats" },
  { value: "R", text: "Republicans" },
  { value: "I", text: "Independents" },
];

export type UnitySortKey = "score" | "name" | "party" | "seat" | "votes" | "breaks";
export const UNITY_SORT_KEYS: UnitySortKey[] = ["score", "name", "party", "seat", "votes", "breaks"];

export interface UnityState {
  congress: number;
  chamber: Chamber;
  party: PartyFilter;
  sort: { key: UnitySortKey; descending: boolean };
}

/** A member with their score and rank worked out. */
export interface RankedMember extends Member {
  score: number;
  breaks: number;
  /** 1 is the most loyal; members sharing a score share a rank. Null when too few votes to rank. */
  rank: number | null;
}

export function chamberFile(chamber: Chamber, congress: number): string {
  return `unity/${chamber === "house" ? "H" : "S"}${String(congress).padStart(3, "0")}.json`;
}

/** The party a member is measured against: their own, or an independent's caucus. */
export function scoredParty(m: Member): "D" | "R" | null {
  return m.p === "I" ? m.c ?? null : m.p;
}

export function score(m: Member): number {
  return m.v ? m.w / m.v : 0;
}

/** Scores compared exactly, as fractions, so 9/10 and 90/100 tie. Higher first. */
function compareScore(a: Member, b: Member): number {
  return b.w * a.v - a.w * b.v;
}

/** Scores and ranks every member: ranked members by score, highest first, sharing ranks on a tie. */
export function rankMembers(members: Member[], minVotes: number): RankedMember[] {
  const out: RankedMember[] = members.map((m) => ({ ...m, score: score(m), breaks: m.v - m.w, rank: null }));
  const ranked = out.filter((m) => m.v >= minVotes).sort(compareScore);
  ranked.forEach((m, i) => {
    m.rank = i > 0 && compareScore(ranked[i - 1], m) === 0 ? ranked[i - 1].rank : i + 1;
  });
  return out;
}

export function filterParty(members: RankedMember[], party: PartyFilter): RankedMember[] {
  return party === "all" ? members : members.filter((m) => m.p === party);
}

const byName = (a: Member, b: Member) => lastName(a.n).localeCompare(lastName(b.n)) || a.n.localeCompare(b.n);

function lastName(n: string): string {
  const parts = n.split(" ");
  return parts[parts.length - 1];
}

/** The seat as a sort key: state, then district number. */
function compareSeat(a: string, b: string): number {
  const [sa, da = ""] = a.split("-");
  const [sb, db = ""] = b.split("-");
  return sa.localeCompare(sb) || (Number(da) || 0) - (Number(db) || 0);
}

/**
 * Sorted for the table. By score, unranked members always go last (by votes, most first);
 * descending means most loyal first. Ties fall back to the name.
 */
export function sortMembers(members: RankedMember[], key: UnitySortKey, descending: boolean): RankedMember[] {
  const dir = descending ? 1 : -1;
  const cmp = (a: RankedMember, b: RankedMember): number => {
    switch (key) {
      case "score":
        if ((a.rank === null) !== (b.rank === null)) return a.rank === null ? 1 : -1;
        if (a.rank === null || b.rank === null) return b.v - a.v || byName(a, b);
        return dir * (a.rank - b.rank) || b.v - a.v || byName(a, b);
      case "name":
        return -dir * byName(a, b);
      case "party":
        return -dir * ((a.c ? `${a.p}${a.c}` : a.p).localeCompare(b.c ? `${b.p}${b.c}` : b.p)) || byName(a, b);
      case "seat":
        return -dir * compareSeat(a.s, b.s) || byName(a, b);
      case "votes":
        return dir * (b.v - a.v) || byName(a, b);
      case "breaks":
        return dir * (b.breaks - a.breaks) || byName(a, b);
    }
  };
  return [...members].sort(cmp);
}

/** The first direction a column sorts in when clicked. */
export function firstDescending(key: UnitySortKey): boolean {
  return key === "score" || key === "votes" || key === "breaks";
}

/** The most and least loyal ranked members of a party (by the party they're scored against). */
export function extremes(members: RankedMember[], party: "D" | "R"): { most: RankedMember[]; least: RankedMember[] } {
  const ranked = members.filter((m) => m.rank !== null && scoredParty(m) === party)
    .sort((a, b) => a.rank! - b.rank! || b.v - a.v);
  if (!ranked.length) return { most: [], least: [] };
  const top = ranked[0].score;
  const bottom = ranked[ranked.length - 1].score;
  return {
    most: ranked.filter((m) => m.score === top),
    least: ranked.filter((m) => m.score === bottom).sort((a, b) => b.v - a.v),
  };
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function congressLabel(c: Pick<CongressEntry, "congress" | "start" | "end">): string {
  return `${ordinal(c.congress)} (${c.start}-${c.end})`;
}

/** Reads the tab's URL parameters over the current state; unknown values keep what was there. */
export function readUnityParams(params: URLSearchParams, index: UnityIndex, st: UnityState): UnityState {
  const next: UnityState = { ...st, sort: { ...st.sort } };
  const chamber = params.get("chamber");
  if (chamber === "house" || chamber === "senate") next.chamber = chamber;
  const withChamber = index.congresses.filter((c) => c[next.chamber]);
  const congress = Number(params.get("congress"));
  if (withChamber.some((c) => c.congress === congress)) next.congress = congress;
  else if (!withChamber.some((c) => c.congress === next.congress) && withChamber.length) {
    next.congress = withChamber[withChamber.length - 1].congress;
  }
  const party = params.get("party");
  if (PARTY_FILTERS.some((p) => p.value === party)) next.party = party as PartyFilter;
  const s = params.get("sort")?.match(/^(\w+)-(asc|desc)$/);
  if (s && UNITY_SORT_KEYS.includes(s[1] as UnitySortKey)) {
    next.sort = { key: s[1] as UnitySortKey, descending: s[2] === "desc" };
  }
  return next;
}

export function unityHash(st: UnityState): string {
  return `#/unity?congress=${st.congress}&chamber=${st.chamber}`
    + `${st.party !== "all" ? `&party=${st.party}` : ""}`
    + `&sort=${st.sort.key}-${st.sort.descending ? "desc" : "asc"}`;
}
