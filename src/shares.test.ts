import { describe, expect, it } from "vitest";
import {
  buildRows, formatGap, formatSeatGap, formatSeats, isLegislature, makeRow, nationalRow, pct, seatBonus, shares, sortRows,
  votesUnreliable,
} from "./shares";

const nc = makeRow("NC", "North Carolina", {
  votes: { D: 47, R: 53, O: 0 },
  seats: { D: 4, R: 10, O: 0 },
});
const ma = makeRow("MA", "Massachusetts", {
  votes: { D: 64, R: 30, O: 6 },
  seats: { D: 9, R: 0, O: 0 },
  uncontested: 2,
});

describe("shares", () => {
  it("divides by the total", () => {
    expect(shares({ D: 1, R: 3, O: 0 })).toEqual({ D: 0.25, R: 0.75, O: 0 });
  });
  it("is all zero for an empty count", () => {
    expect(shares({ D: 0, R: 0, O: 0 })).toEqual({ D: 0, R: 0, O: 0 });
  });
});

describe("seatBonus", () => {
  it("is negative when Republicans win more seats than votes", () => {
    // R: 71.4% of seats on 53% of votes; D: 28.6% on 47%
    expect(nc.gap).toBeCloseTo((4 / 14 - 0.47 - (10 / 14 - 0.53)) / 2);
    expect(nc.gap).toBeLessThan(0);
  });
  it("is zero when seats match votes", () => {
    expect(seatBonus({ D: 0.5, R: 0.5, O: 0 }, { D: 0.5, R: 0.5, O: 0 })).toBe(0);
  });
});

describe("rows", () => {
  it("skips states with no result", () => {
    const rows = buildRows(
      [{ po: "MA", name: "Massachusetts", fips: "25" }, { po: "DC", name: "DC", fips: "11" }],
      { MA: { votes: { D: 1, R: 0, O: 0 }, seats: { D: 1, R: 0, O: 0 } } },
    );
    expect(rows.map((r) => r.po)).toEqual(["MA"]);
  });
  it("adds states into a national row", () => {
    const us = nationalRow([nc, ma]);
    expect(us.votes).toEqual({ D: 111, R: 83, O: 6 });
    expect(us.totalSeats).toBe(23);
    expect(us.uncontested).toBe(2);
  });
  it("sorts the gaps by size, whichever party they favour", () => {
    // MA: D +2.97 seats, NC: R +2.58, TX: R +10
    const tx = makeRow("TX", "Texas", { votes: { D: 50, R: 50, O: 0 }, seats: { D: 10, R: 30, O: 0 } });
    expect(sortRows([ma, nc, tx], "seatGap", true).map((r) => r.po)).toEqual(["TX", "MA", "NC"]);
    expect(sortRows([ma, nc, tx], "seatGap", false).map((r) => r.po)).toEqual(["NC", "MA", "TX"]);
    expect(sortRows([nc, ma], "gap", true).map((r) => r.po)).toEqual(["MA", "NC"]);
    expect(sortRows([nc, ma], "name", false).map((r) => r.po)).toEqual(["MA", "NC"]);
  });
  it("turns the gap into seats", () => {
    // Proportional: D 47% of 14 = 6.58 seats, won 4
    expect(nc.seatGap).toBeCloseTo(nc.gap * 14);
    expect(nc.seatGap).toBeCloseTo(-2.58);
    const big = makeRow("CA", "California", { votes: { D: 60, R: 40, O: 0 }, seats: { D: 43, R: 9, O: 0 } });
    const small = makeRow("NH", "New Hampshire", { votes: { D: 52, R: 48, O: 0 }, seats: { D: 2, R: 0, O: 0 } });
    expect(Math.abs(small.gap)).toBeGreaterThan(Math.abs(big.gap));
    expect(Math.abs(big.seatGap)).toBeGreaterThan(Math.abs(small.seatGap));
  });
});

describe("formatting", () => {
  it("formats the gap with the party it favours", () => {
    expect(formatGap(0.123)).toBe("D +12.3");
    expect(formatGap(-0.04)).toBe("R +4.0");
    expect(formatGap(0.0001)).toBe("Even");
    expect(formatSeatGap(-2.58)).toBe("R +2.6");
    expect(formatSeatGap(0.01)).toBe("Even");
  });
  it("lists seats largest first and leaves out empty parties", () => {
    expect(formatSeats({ D: 4, R: 10, O: 0 })).toBe("10 R, 4 D");
    expect(formatSeats({ D: 0, R: 0, O: 1 })).toBe("1 Ind");
  });
  it("formats percentages", () => {
    expect(pct(0.5321)).toBe("53.2%");
  });
});

describe("state legislatures", () => {
  it("are the two state offices", () => {
    expect(isLegislature("statehouse")).toBe(true);
    expect(isLegislature("statesenate")).toBe(true);
    expect(isLegislature("house")).toBe(false);
  });
  it("call the votes unreliable when over half the seats have none", () => {
    const row = (noVotes: number) => makeRow("AR", "Arkansas", {
      votes: { D: 1, R: 1, O: 0 }, seats: { D: 30, R: 70, O: 0 }, noVotes,
    });
    expect(votesUnreliable(row(51))).toBe(true);
    expect(votesUnreliable(row(50))).toBe(false);
    expect(row(0).noVotes).toBe(0);
    expect(makeRow("MA", "Massachusetts", { votes: ma.votes, seats: ma.seats }).noVotes).toBe(0);
  });
});

describe("sorting with missing votes", () => {
  const ok = makeRow("WI", "Wisconsin", { votes: { D: 53, R: 47, O: 0 }, seats: { D: 36, R: 63, O: 0 } });
  const ok2 = makeRow("MI", "Michigan", { votes: { D: 50, R: 50, O: 0 }, seats: { D: 56, R: 54, O: 0 } });
  const ok3 = makeRow("OK", "Oklahoma", {
    votes: { D: 30, R: 70, O: 0 }, seats: { D: 20, R: 81, O: 0 }, noVotes: 70,
  });
  it("puts a state with mostly no votes last when sorting by the votes or a gap", () => {
    expect(sortRows([ok3, ok, ok2], "seatGap", true).map((r) => r.po)).toEqual(["WI", "MI", "OK"]);
    expect(sortRows([ok3, ok, ok2], "seatGap", false).map((r) => r.po)).toEqual(["MI", "WI", "OK"]);
    expect(sortRows([ok, ok2, ok3], "seats", true).map((r) => r.po)).toEqual(["MI", "OK", "WI"]);
  });
});
