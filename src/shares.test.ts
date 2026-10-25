import { describe, expect, it } from "vitest";
import {
  buildRows, formatGap, formatSeats, makeRow, nationalRow, pct, seatBonus, shares, sortRows,
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
  it("sorts by gap size either way", () => {
    expect(sortRows([nc, ma], "absGap", true).map((r) => r.po)).toEqual(["MA", "NC"]);
    expect(sortRows([ma, nc], "name", false).map((r) => r.po)).toEqual(["MA", "NC"]);
    expect(sortRows([ma, nc], "gap", false)[0].po).toBe("NC");
  });
});

describe("formatting", () => {
  it("formats the gap with the party it favours", () => {
    expect(formatGap(0.123)).toBe("D +12.3");
    expect(formatGap(-0.04)).toBe("R +4.0");
    expect(formatGap(0.0001)).toBe("Even");
  });
  it("lists seats largest first and leaves out empty parties", () => {
    expect(formatSeats({ D: 4, R: 10, O: 0 })).toBe("10 R, 4 D");
    expect(formatSeats({ D: 0, R: 0, O: 1 })).toBe("1 Ind");
  });
  it("formats percentages", () => {
    expect(pct(0.5321)).toBe("53.2%");
  });
});
