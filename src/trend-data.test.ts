import { describe, expect, it } from "vitest";
import type { Summary } from "./shares";
import {
  clampRange, compareSeries, formatOffices, gapValue, isCompareMetric, parseOffices, partiesShown, partyValue, trendPoints,
  trendYears,
} from "./trend-data";

const summary: Summary = {
  states: [
    { po: "VT", name: "Vermont", fips: "50" },
    { po: "NC", name: "North Carolina", fips: "37" },
  ],
  offices: {
    house: [2000, 2002, 2004], senate: [2000, 2002], president: [2000, 2004], statehouse: [2002], statesenate: [],
  },
  nominees: {},
  source: "",
  results: {
    house: {
      2000: {
        VT: { votes: { D: 10, R: 30, O: 60 }, seats: { D: 0, R: 0, O: 1 } },
        NC: { votes: { D: 50, R: 50, O: 0 }, seats: { D: 5, R: 7, O: 0 } },
      },
      2002: {
        NC: { votes: { D: 45, R: 55, O: 0 }, seats: { D: 6, R: 7, O: 0 } },
      },
      2004: {
        VT: { votes: { D: 20, R: 30, O: 50 }, seats: { D: 0, R: 0, O: 1 } },
        NC: { votes: { D: 48, R: 52, O: 0 }, seats: { D: 6, R: 7, O: 0 } },
      },
    },
    senate: {
      2000: {
        NC: {
          votes: { D: 90, R: 110, O: 0 },
          seats: { D: 0, R: 2, O: 0 },
          races: [
            { winner: "A", party: "R", special: false },
            { winner: "B", party: "R", special: true },
          ],
        },
      },
      2002: {
        VT: { votes: { D: 10, R: 40, O: 50 }, seats: { D: 0, R: 0, O: 1 } },
      },
    },
    president: { 2000: {}, 2004: {} },
    statehouse: {
      2002: {
        VT: { votes: { D: 60, R: 40, O: 0 }, seats: { D: 90, R: 60, O: 0 }, uncontested: 30, noVotes: 10 },
        NC: { votes: { D: 40, R: 60, O: 0 }, seats: { D: 50, R: 70, O: 0 }, uncontested: 70, noVotes: 65 },
      },
    },
    statesenate: {},
  },
};

describe("trendPoints", () => {
  it("adds the states up for the nation", () => {
    const points = trendPoints(summary, "house", "US", 2000, 2004);
    expect(points.map((p) => p.year)).toEqual([2000, 2002, 2004]);
    expect(points[0].row.seats).toEqual({ D: 5, R: 7, O: 1 });
    expect(points[0].row.votes).toEqual({ D: 60, R: 80, O: 60 });
  });
  it("skips years a state has no result", () => {
    expect(trendPoints(summary, "house", "VT", 2000, 2004).map((p) => p.year)).toEqual([2000, 2004]);
  });
  it("keeps to the range, either way round", () => {
    expect(trendPoints(summary, "house", "NC", 2004, 2002).map((p) => p.year)).toEqual([2002, 2004]);
  });
});

describe("senate", () => {
  it("counts a regular and a special race as two seats", () => {
    const [nc] = trendPoints(summary, "senate", "NC", 2000, 2002);
    expect(nc.row.totalSeats).toBe(2);
    expect(gapValue(nc.row, "seatGap")).toBeCloseTo(-0.9);
  });
  it("adds up only the states with a race", () => {
    const points = trendPoints(summary, "senate", "US", 2000, 2002);
    expect(points.map((p) => p.row.totalSeats)).toEqual([2, 1]);
  });
});

describe("state legislatures", () => {
  it("adds up the seats with no votes for the nation", () => {
    const [us] = trendPoints(summary, "statehouse", "US", 2002, 2002);
    expect(us.row.noVotes).toBe(75);
    expect(us.row.uncontested).toBe(100);
    expect(us.row.totalSeats).toBe(270);
  });
});

describe("metric values", () => {
  const [nc2000] = trendPoints(summary, "house", "NC", 2000, 2000);
  it("reads a party's value", () => {
    expect(partyValue(nc2000.row, "seats", "R")).toBe(7);
    expect(partyValue(nc2000.row, "voteShare", "D")).toBe(0.5);
    expect(partyValue(nc2000.row, "seatShare", "D")).toBeCloseTo(5 / 12);
  });
  it("reads the gap in points or seats", () => {
    expect(gapValue(nc2000.row, "gap")).toBeCloseTo(5 / 12 - 0.5);
    expect(gapValue(nc2000.row, "seatGap")).toBeCloseTo(-1);
  });
  it("shows Other only when it has any", () => {
    expect(partiesShown(trendPoints(summary, "house", "NC", 2000, 2004), "seats")).toEqual(["D", "R"]);
    expect(partiesShown(trendPoints(summary, "house", "US", 2000, 2004), "seats")).toEqual(["D", "R", "O"]);
  });
});

describe("clampRange", () => {
  const years = [1976, 1980, 2024];
  it("orders and clamps", () => {
    expect(clampRange(years, 2030, 1970)).toEqual([1976, 2024]);
    expect(clampRange(years, 1980, 1976)).toEqual([1976, 1980]);
  });
});

describe("comparing offices", () => {
  it("draws each office's years, leaving out state legislatures with mostly no votes", () => {
    const series = compareSeries(summary, ["house", "statehouse"], "NC", "voteShare", 2000, 2004);
    expect(series.map((s) => s.office)).toEqual(["house", "statehouse"]);
    expect(series[0].points.map((p) => [p.year, p.value])).toEqual([[2000, 0.5], [2002, 0.45], [2004, 0.48]]);
    expect(series[1].points).toEqual([]);
  });
  it("keeps the seat share where the votes are missing", () => {
    const [nc] = compareSeries(summary, ["statehouse"], "NC", "seatShare", 2002, 2002);
    expect(nc.points[0].value).toBeCloseTo(50 / 120);
  });
  it("gives the gap in points, + for Democrats", () => {
    const [vt] = compareSeries(summary, ["statehouse"], "VT", "gap", 2002, 2002);
    expect(vt.points[0].value).toBeCloseTo((0.6 - 0.6 - (0.4 - 0.4)) / 2);
  });
  it("only offers metrics that don't depend on an office's size", () => {
    expect(isCompareMetric("gap")).toBe(true);
    expect(isCompareMetric("seatGap")).toBe(false);
    expect(isCompareMetric("split")).toBe(false);
  });
  it("takes the years of every office compared", () => {
    expect(trendYears(summary, "compare", ["senate", "president"])).toEqual([2000, 2002, 2004]);
    expect(trendYears(summary, "statehouse", ["house"])).toEqual([2002]);
  });
  it("reads and writes the office list, all of them by default", () => {
    expect(parseOffices(null)).toEqual(["house", "senate", "president", "statehouse", "statesenate"]);
    expect(parseOffices("statesenate,house,bogus")).toEqual(["house", "statesenate"]);
    expect(formatOffices(["house", "statesenate"])).toBe("house,statesenate");
    expect(formatOffices(parseOffices(""))).toBe("");
  });
});
