import { describe, expect, it } from "vitest";
import {
  chamberFile, congressLabel, extremes, filterParty, ordinal, rankMembers, readUnityParams, scoredParty, sortMembers,
  unityHash, type Member, type UnityIndex, type UnityState,
} from "./unity-data";

const m = (n: string, p: Member["p"], v: number, w: number, extra: Partial<Member> = {}): Member =>
  ({ n, p, s: "CA-1", v, w, id: 1, ...extra });

const members: Member[] = [
  m("Ann Able", "D", 100, 90),
  m("Bob Baker", "D", 10, 9),        // 90% too: ties with Ann
  m("Cy Cole", "R", 100, 100),
  m("Di Dunn", "R", 100, 60),
  m("Ed Eng", "I", 100, 95, { c: "D" }),
  m("Flo Fox", "D", 5, 0),           // too few votes
];

describe("rankMembers", () => {
  const ranked = rankMembers(members, 10);
  const byName = Object.fromEntries(ranked.map((r) => [r.n, r]));

  it("scores and counts breaks", () => {
    expect(byName["Di Dunn"].score).toBe(0.6);
    expect(byName["Di Dunn"].breaks).toBe(40);
  });

  it("ranks highest first and shares a rank on an exact tie", () => {
    expect(byName["Cy Cole"].rank).toBe(1);
    expect(byName["Ed Eng"].rank).toBe(2);
    expect(byName["Ann Able"].rank).toBe(3);
    expect(byName["Bob Baker"].rank).toBe(3);
    expect(byName["Di Dunn"].rank).toBe(5);
  });

  it("leaves members with too few votes unranked", () => {
    expect(byName["Flo Fox"].rank).toBeNull();
  });
});

describe("sortMembers", () => {
  const ranked = rankMembers(members, 10);
  const names = (key: Parameters<typeof sortMembers>[1], desc: boolean) => sortMembers(ranked, key, desc).map((r) => r.n);

  it("puts the most loyal first, ties by votes, unranked last", () => {
    expect(names("score", true)).toEqual(["Cy Cole", "Ed Eng", "Ann Able", "Bob Baker", "Di Dunn", "Flo Fox"]);
  });

  it("puts the least loyal first ascending, still with unranked last", () => {
    expect(names("score", false)).toEqual(["Di Dunn", "Ann Able", "Bob Baker", "Ed Eng", "Cy Cole", "Flo Fox"]);
  });

  it("sorts by breaks and by last name", () => {
    expect(names("breaks", true)[0]).toBe("Di Dunn");
    expect(names("name", false)).toEqual(["Ann Able", "Bob Baker", "Cy Cole", "Di Dunn", "Ed Eng", "Flo Fox"]);
  });

  it("sorts seats by state, then district number", () => {
    const seats = rankMembers([
      m("A", "D", 10, 10, { s: "CA-12" }), m("B", "D", 10, 10, { s: "CA-2" }), m("C", "D", 10, 10, { s: "AK-AL" }),
    ], 1);
    expect(sortMembers(seats, "seat", false).map((r) => r.s)).toEqual(["AK-AL", "CA-2", "CA-12"]);
  });
});

describe("parties", () => {
  const ranked = rankMembers(members, 10);

  it("scores an independent against their caucus", () => {
    expect(scoredParty(members[4])).toBe("D");
    expect(scoredParty(m("X", "I", 0, 0))).toBeNull();
  });

  it("filters by the member's own party", () => {
    expect(filterParty(ranked, "I").map((r) => r.n)).toEqual(["Ed Eng"]);
    expect(filterParty(ranked, "all")).toHaveLength(6);
  });

  it("finds the most and least loyal of a party, independents with their caucus", () => {
    const d = extremes(ranked, "D");
    expect(d.most.map((r) => r.n)).toEqual(["Ed Eng"]);
    expect(d.least.map((r) => r.n)).toEqual(["Ann Able", "Bob Baker"]);
    expect(extremes(ranked, "R").least.map((r) => r.n)).toEqual(["Di Dunn"]);
  });
});

describe("labels", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 101, 111, 112, 118].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "101st", "111th", "112th", "118th"]);
  });

  it("names a Congress and its file", () => {
    expect(congressLabel({ congress: 118, start: 2023, end: 2025 })).toBe("118th (2023-2025)");
    expect(chamberFile("house", 118)).toBe("unity/H118.json");
    expect(chamberFile("senate", 80)).toBe("unity/S080.json");
  });
});

describe("URL state", () => {
  const summary = { rollcalls: 1, unityVotes: 1, minVotes: 1, average: { D: 1, R: 1 }, lastVote: null };
  const index: UnityIndex = {
    source: "",
    congresses: [
      { congress: 117, start: 2021, end: 2023, house: summary, senate: summary },
      { congress: 118, start: 2023, end: 2025, house: summary },
    ],
  };
  const base: UnityState = { congress: 0, chamber: "house", party: "all", sort: { key: "score", descending: true } };

  it("defaults to the latest Congress", () => {
    expect(readUnityParams(new URLSearchParams(""), index, base).congress).toBe(118);
  });

  it("reads every parameter", () => {
    const st = readUnityParams(new URLSearchParams("congress=117&chamber=senate&party=R&sort=breaks-desc"), index, base);
    expect(st).toEqual({ congress: 117, chamber: "senate", party: "R", sort: { key: "breaks", descending: true } });
  });

  it("falls back when the chamber has no such Congress, and ignores junk", () => {
    const st = readUnityParams(new URLSearchParams("congress=118&chamber=senate&party=Q&sort=foo-up"), index, base);
    expect(st.congress).toBe(117);
    expect(st.party).toBe("all");
    expect(st.sort).toEqual(base.sort);
  });

  it("round-trips through the hash", () => {
    const st: UnityState = { congress: 117, chamber: "senate", party: "D", sort: { key: "votes", descending: false } };
    const hash = unityHash(st);
    expect(hash).toBe("#/unity?congress=117&chamber=senate&party=D&sort=votes-asc");
    expect(readUnityParams(new URLSearchParams(hash.split("?")[1]), index, base)).toEqual(st);
  });
});
