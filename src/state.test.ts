import { describe, expect, it } from "vitest";
import { makeRow } from "./shares";
import { chartChambers, chartVotes, legislatureVotes, senateWinners, type YearPoint } from "./state";

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

describe("chart chambers", () => {
  const row = (noVotes = 0) => makeRow("AR", "", {
    votes: { D: 30, R: 70, O: 0 }, seats: { D: 2, R: 8, O: 0 }, noVotes,
  });
  it("offers only the chambers the state has, in menu order", () => {
    const points: YearPoint[] = [
      { year: 1968, statesenate: row() },
      { year: 2022, house: row(), statesenate: row() },
    ];
    expect(chartChambers(points)).toEqual(["house", "statesenate"]);
    expect(chartChambers([{ year: 2022, house: row() }])).toEqual(["house"]);
  });
  it("draws no vote share when most seats have no votes", () => {
    expect(chartVotes(row(0))).toBe(0.3);
    expect(chartVotes(row(6))).toBeUndefined();
  });
});
