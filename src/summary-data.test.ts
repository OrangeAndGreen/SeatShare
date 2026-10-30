import { describe, expect, it } from "vitest";
import type { Summary } from "./shares";
import {
  areaRow, columnValue, formatMargin, isSummaryKey, seatMargin, sortLines, stateLines, summaryPoints, summaryYears,
  voteMargin,
} from "./summary-data";

const summary: Summary = {
  states: [
    { po: "VT", name: "Vermont", fips: "50" },
    { po: "NC", name: "North Carolina", fips: "37" },
    { po: "OH", name: "Ohio", fips: "39" },
  ],
  offices: { house: [2002, 2004], senate: [2004], president: [2004], statehouse: [2002], statesenate: [] },
  nominees: {},
  source: "",
  results: {
    house: {
      2002: {
        NC: { votes: { D: 45, R: 55, O: 0 }, seats: { D: 6, R: 7, O: 0 } },
      },
      2004: {
        VT: { votes: { D: 20, R: 30, O: 50 }, seats: { D: 0, R: 0, O: 1 } },
        NC: { votes: { D: 50, R: 50, O: 0 }, seats: { D: 3, R: 10, O: 0 } },
        OH: { votes: { D: 48, R: 52, O: 0 }, seats: { D: 6, R: 12, O: 0 } },
      },
    },
    senate: {
      2004: {
        NC: { votes: { D: 40, R: 60, O: 0 }, seats: { D: 0, R: 1, O: 0 } },
        VT: { votes: { D: 70, R: 30, O: 0 }, seats: { D: 1, R: 0, O: 0 } },
      },
    },
    president: {
      2004: {
        VT: { votes: { D: 60, R: 40, O: 0 }, seats: { D: 3, R: 0, O: 0 } },
        NC: { votes: { D: 44, R: 56, O: 0 }, seats: { D: 0, R: 15, O: 0 } },
        OH: { votes: { D: 49, R: 51, O: 0 }, seats: { D: 0, R: 20, O: 0 } },
      },
    },
    statehouse: { 2002: { VT: { votes: { D: 1, R: 1, O: 0 }, seats: { D: 1, R: 1, O: 0 } } } },
    statesenate: {},
  },
};

describe("summaryYears", () => {
  it("joins the federal offices' years, leaving state legislatures out", () => {
    expect(summaryYears({ ...summary, offices: { ...summary.offices, statehouse: [1990] } })).toEqual([2002, 2004]);
  });
});

describe("areaRow", () => {
  it("adds the states up for the nation", () => {
    const row = areaRow(summary, "president", "US", 2004)!;
    expect(row.seats).toEqual({ D: 3, R: 35, O: 0 });
  });
  it("is missing when the office had no election", () => {
    expect(areaRow(summary, "senate", "US", 2002)).toBeUndefined();
    expect(areaRow(summary, "senate", "OH", 2004)).toBeUndefined();
  });
  it("is missing for a year with an empty result set", () => {
    expect(areaRow({ ...summary, results: { ...summary.results, president: { 2004: {} } } }, "president", "US", 2004))
      .toBeUndefined();
  });
});

describe("margins", () => {
  it("are D share less R share, of all votes and seats", () => {
    const vt = areaRow(summary, "house", "VT", 2004)!;
    expect(voteMargin(vt)).toBeCloseTo(-0.1);
    expect(seatMargin(vt)).toBe(0);
    const nc = areaRow(summary, "house", "NC", 2004)!;
    expect(columnValue(nc, "votes")).toBe(0);
    expect(columnValue(nc, "seats")).toBeCloseTo(-7 / 13);
    expect(columnValue(nc, "gap")).toBeCloseTo(-7 / 26);
    expect(columnValue(nc, "seatGap")).toBeCloseTo(-3.5);
  });
});

describe("summaryPoints", () => {
  it("has a point per year with whichever offices were up", () => {
    const points = summaryPoints(summary, "NC");
    expect(points.map((p) => p.year)).toEqual([2002, 2004]);
    expect(Object.keys(points[0].rows)).toEqual(["house"]);
    expect(Object.keys(points[1].rows)).toEqual(["president", "senate", "house"]);
  });
  it("skips years a state has nothing", () => {
    expect(summaryPoints(summary, "OH").map((p) => p.year)).toEqual([2004]);
  });
});

describe("stateLines", () => {
  it("lists only the states with a result that year", () => {
    const { national, states } = stateLines(summary, 2002);
    expect(states.map((s) => s.po)).toEqual(["NC"]);
    expect(national.rows.house!.seats).toEqual({ D: 6, R: 7, O: 0 });
  });
});

describe("sortLines", () => {
  const { states } = stateLines(summary, 2004);
  const order = (key: Parameters<typeof sortLines>[1], desc: boolean) => sortLines(states, key, desc).map((s) => s.po);

  it("sorts margins from most Democratic", () => {
    expect(order("president:votes", true)).toEqual(["VT", "OH", "NC"]);
  });
  it("sorts gaps by size, whichever party they favour", () => {
    expect(order("house:seatGap", true)).toEqual(["NC", "OH", "VT"]);
  });
  it("puts states with no race last, both ways", () => {
    expect(order("senate:votes", true)).toEqual(["VT", "NC", "OH"]);
    expect(order("senate:votes", false)).toEqual(["NC", "VT", "OH"]);
  });
  it("sorts by name", () => {
    expect(order("name", false)).toEqual(["NC", "OH", "VT"]);
    expect(order("name", true)).toEqual(["VT", "OH", "NC"]);
  });
});

describe("isSummaryKey", () => {
  it("knows the House's gap in seats but no other office's", () => {
    expect(isSummaryKey("house:seatGap")).toBe(true);
    expect(isSummaryKey("senate:seatGap")).toBe(false);
    expect(isSummaryKey("nonsense")).toBe(false);
  });
});

describe("formatMargin", () => {
  it("names the party ahead", () => {
    expect(formatMargin(0.042)).toBe("D +4.2");
    expect(formatMargin(-0.12)).toBe("R +12.0");
    expect(formatMargin(0.0004)).toBe("Even");
    expect(formatMargin(-0.5, 0)).toBe("R +50");
  });
});
