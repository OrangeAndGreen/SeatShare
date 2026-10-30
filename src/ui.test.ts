import { describe, expect, it } from "vitest";
import { shade, shadeLevel } from "./ui";

describe("shade", () => {
  it("runs from even to the extent, clamped, signed by party", () => {
    expect(shadeLevel(0.15, 0.3)).toBeCloseTo(0.5);
    expect(shadeLevel(-0.6, 0.3)).toBe(-1);
    expect(shadeLevel(0.004, 0.3)).toBe(0);
  });
  it("leaves an even cell unshaded and lightens the text only on the deepest", () => {
    expect(shade(0, 0.3)).toBe("");
    expect(shade(0.15, 0.3)).toContain("var(--dem-cell) 50%");
    expect(shade(0.15, 0.3)).not.toContain("--shade-ink");
    expect(shade(-0.3, 0.3)).toContain("var(--rep-cell) 100%");
    expect(shade(-0.3, 0.3)).toContain("color:var(--shade-ink)");
  });
});
