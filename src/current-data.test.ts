import { describe, expect, it } from "vitest";
import { currentLines, currentSeats, isCurrentKey, nextRegular, nextUp, sortCurrent } from "./current-data";
import builtJson from "../public/data/summary.json";
import type { Summary } from "./shares";

const v = (D: number, R: number, O = 0) => ({ D, R, O });

const summary: Summary = {
  states: [
    { po: "GA", name: "Georgia", fips: "13" },
    { po: "CA", name: "California", fips: "06" },
    { po: "OH", name: "Ohio", fips: "39" },
  ],
  offices: { house: [2022, 2024], senate: [2018, 2020, 2022, 2024], president: [2024], statehouse: [], statesenate: [] },
  nominees: {},
  source: "",
  results: {
    house: {
      2022: { GA: { votes: v(1, 1), seats: v(1, 1) } },
      2024: {
        GA: { votes: v(45, 55), seats: v(5, 9) },
        CA: { votes: v(60, 40), seats: v(43, 9), uncontested: 2 },
      },
    },
    senate: {
      2018: { OH: { votes: v(53, 47), seats: v(1, 0), races: [{ winner: "Sherrod Brown", party: "D", special: false, votes: v(53, 47), class: 1 }] } },
      2020: {
        GA: {
          votes: v(95, 105), seats: v(2, 0), races: [
            { winner: "Jon Ossoff", party: "D", special: false, votes: v(48, 50), class: 2 },
            { winner: "Raphael Warnock", party: "D", special: true, votes: v(47, 55), class: 3 },
          ],
        },
      },
      2022: {
        GA: { votes: v(49, 48), seats: v(1, 0), races: [{ winner: "Raphael Warnock", party: "D", special: false, votes: v(49, 48), class: 3 }] },
        OH: { votes: v(47, 53), seats: v(0, 1), races: [{ winner: "JD Vance", party: "R", special: false, votes: v(47, 53), class: 3 }] },
        CA: { votes: v(60, 40), seats: v(1, 0), races: [{ winner: "Alex Padilla", party: "D", special: false, votes: v(60, 40), class: 3 }] },
      },
      2024: {
        OH: { votes: v(46, 50, 4), seats: v(0, 1), races: [{ winner: "Bernie Moreno", party: "R", special: false, votes: v(46, 50, 4), class: 1 }] },
        CA: {
          votes: v(118, 82), seats: v(2, 0), races: [
            { winner: "Adam Schiff (special)", party: "D", special: true, votes: v(58, 42), class: 1 },
            { winner: "Adam Schiff", party: "D", special: false, votes: v(60, 40), class: 1 },
          ],
        },
      },
    },
    president: {
      2024: {
        GA: { votes: v(49, 51), seats: v(0, 16) },
        CA: { votes: v(58, 38, 4), seats: v(54, 0) },
        OH: { votes: v(44, 55, 1), seats: v(0, 17) },
      },
    },
    statehouse: {},
    statesenate: {},
  },
};

describe("nextRegular", () => {
  it("follows each class's six-year cycle", () => {
    expect(nextRegular(1, 2024)).toBe(2030);
    expect(nextRegular(2, 2020)).toBe(2026);
    expect(nextRegular(3, 2020)).toBe(2022);
    expect(nextRegular(3, 2022)).toBe(2028);
  });
});

describe("currentSeats", () => {
  it("takes each class's latest race, a later regular replacing a special", () => {
    const seats = currentSeats(summary, "GA");
    expect(seats.map((s) => [s.winner, s.year, s.next])).toEqual([["Jon Ossoff", 2020, 2026], ["Raphael Warnock", 2022, 2028]]);
  });
  it("prefers the regular race when a special filled the same seat that year", () => {
    expect(currentSeats(summary, "CA").map((s) => s.winner)).toEqual(["Alex Padilla", "Adam Schiff"]);
  });
  it("marks appointees and the special that will settle the seat", () => {
    const vance = currentSeats(summary, "OH").find((s) => s.seatClass === 3)!;
    expect(vance.winner).toBe("JD Vance");
    expect(vance.appointed).toBe("Jon Husted");
    expect(vance.next).toBe(2026);
  });
});

describe("currentLines", () => {
  const { national, states } = currentLines(summary);
  it("adds a state's two current Senate races up, one seat each", () => {
    const ga = states.find((l) => l.po === "GA")!;
    expect(ga.rows.senate!.votes).toEqual(v(97, 98));
    expect(ga.rows.senate!.seats).toEqual(v(2, 0));
    expect(ga.rows.house!.seats).toEqual(v(5, 9));
  });
  it("puts the Senate and House together for the delegation", () => {
    const ga = states.find((l) => l.po === "GA")!.delegation!;
    expect(ga.seats).toEqual(v(7, 9));
    const s = states.find((l) => l.po === "GA")!.rows;
    expect(ga.seatGap).toBeCloseTo(s.senate!.seatGap + s.house!.seatGap);
  });
  it("adds the nation up from the states", () => {
    expect(national.rows.senate!.seats).toEqual(v(4, 2));
    expect(national.rows.president!.seats).toEqual(v(54, 33));
    expect(national.rows.house!.uncontested).toBe(2);
    expect(national.senators).toHaveLength(6);
  });
  it("sorts by margin, gap size or the next Senate race, missing values last", () => {
    expect(sortCurrent(states, "president:votes", true).map((l) => l.po)).toEqual(["CA", "GA", "OH"]);
    expect(sortCurrent(states, "house:seats", true).map((l) => l.po)).toEqual(["CA", "GA", "OH"]);
    expect(sortCurrent(states, "house:seats", false).map((l) => l.po)).toEqual(["GA", "CA", "OH"]);
    expect(sortCurrent(states, "senate:next", false).map((l) => [l.po, nextUp(l)])).toEqual([["GA", 2026], ["OH", 2026], ["CA", 2028]]);
  });
  it("knows its sort keys", () => {
    expect(isCurrentKey("delegation:seatGap")).toBe(true);
    expect(isCurrentKey("president:uncontested")).toBe(false);
    expect(isCurrentKey("statehouse:votes")).toBe(false);
  });
});

describe("the built data", () => {
  const built = builtJson as unknown as Summary;
  const { national, states } = currentLines(built);
  it("gives every state two senators and the Senate as it stands", () => {
    for (const l of states.filter((l) => l.po !== "DC")) {
      expect(l.senators, l.po).toHaveLength(2);
      // Every seat has been up since 2018, so an older one means a race is missing.
      for (const seat of l.senators) expect(seat.year, `${l.po} ${seat.winner}`).toBeGreaterThanOrEqual(2018);
    }
    expect(national.rows.senate!.seats).toEqual(v(45, 53, 2));
    expect(national.rows.house!.seats.D + national.rows.house!.seats.R).toBe(435);
  });
});
