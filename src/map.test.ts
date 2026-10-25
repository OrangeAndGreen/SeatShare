import { describe, expect, it } from "vitest";
import { extent, hatched, legendText } from "./map";
import { makeRow } from "./shares";

describe("map", () => {
  const ar = makeRow("AR", "Arkansas", { votes: { D: 1, R: 3, O: 0 }, seats: { D: 20, R: 80, O: 0 }, noVotes: 70 });
  it("hatches a missing state, and one with mostly no votes unless colouring by seats", () => {
    expect(hatched(undefined, "seats")).toBe(true);
    expect(hatched(ar, "seatGap")).toBe(true);
    expect(hatched(ar, "votes")).toBe(true);
    expect(hatched(ar, "seats")).toBe(false);
    expect(hatched({ ...ar, noVotes: 0 }, "seatGap")).toBe(false);
  });
  it("scales the gap in seats to the size of the chamber", () => {
    expect(extent("seatGap", "statehouse")).toBe(15);
    expect(extent("seatGap", "senate")).toBe(1);
    expect(extent("gap", "statehouse")).toBe(0.3);
    expect(legendText("seatGap", "statesenate")).toEqual(["R +5 seats or more", "D +5"]);
  });
});
