import { describe, expect, it } from "vitest";
import { makeRow } from "./shares";
import { legislatureVotes, senateWinners } from "./state";

describe("senateWinners", () => {
  it("lists each race with its party, marking specials", () => {
    expect(senateWinners([
      { winner: "Jon Ossoff", party: "D", special: false },
      { winner: "Raphael Warnock", party: "D", special: true },
    ])).toBe("Jon Ossoff (D); Raphael Warnock (D, special)");
    expect(senateWinners([{ winner: "Bernie Sanders", party: "O", special: false }])).toBe("Bernie Sanders (Ind)");
    expect(senateWinners(undefined)).toBe("");
  });
});

describe("legislatureVotes", () => {
  it("gives the vote shares, or says there are no votes when most seats lack them", () => {
    const row = (noVotes: number) => makeRow("FL", "", {
      votes: { D: 40, R: 60, O: 0 }, seats: { D: 4, R: 6, O: 0 }, noVotes,
    });
    expect(legislatureVotes(row(5))).toBe("40.0% / 60.0%");
    expect(legislatureVotes(row(6))).toContain("no votes");
    expect(legislatureVotes(row(6))).toContain("6 of 10 seats");
  });
});
