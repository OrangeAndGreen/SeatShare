import { describe, expect, it } from "vitest";
import { senateWinners } from "./state";

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
