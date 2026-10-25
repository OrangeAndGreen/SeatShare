import { describe, expect, it } from "vitest";
import { formatCompare, spreadLabels } from "./compare";

describe("spreadLabels", () => {
  it("pushes close labels apart, keeping their order", () => {
    expect(spreadLabels([100, 105, 300], 14)).toEqual([100, 114, 300]);
    expect(spreadLabels([110, 100, 104], 14)).toEqual([128, 100, 114]);
  });
  it("leaves labels that are far enough apart", () => {
    expect(spreadLabels([10, 50], 14)).toEqual([10, 50]);
  });
});

describe("formatCompare", () => {
  it("gives the gap as points and shares as percentages", () => {
    expect(formatCompare(0.123, "gap")).toBe("D +12.3");
    expect(formatCompare(0.471, "voteShare")).toBe("47.1%");
  });
});
