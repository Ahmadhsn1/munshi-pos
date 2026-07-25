import { describe, expect, it } from "vitest";
import { applyRoundOff, computeRoundOff } from "@/lib/round-off";

describe("round-off: cash-only, nearest-rupee policy", () => {
  it("rounds down when under the halfway point", () => {
    expect(computeRoundOff(12734)).toBe(-34); // Rs 127.34 -> Rs 127.00
  });

  it("rounds up when at or over the halfway point", () => {
    expect(computeRoundOff(12750)).toBe(50); // Rs 127.50 -> Rs 128.00
    expect(computeRoundOff(12799)).toBe(1); // Rs 127.99 -> Rs 128.00
  });

  it("returns 0 for an already-whole-rupee total", () => {
    expect(computeRoundOff(12700)).toBe(0);
    expect(computeRoundOff(0)).toBe(0);
  });

  it("returns 0 when policy is 'none'", () => {
    expect(computeRoundOff(12734, "none")).toBe(0);
  });

  it("rejects a non-integer total", () => {
    expect(() => computeRoundOff(127.5)).toThrow();
  });

  it("applies a round-off to a total for preview", () => {
    expect(applyRoundOff(12734, -34)).toBe(12700);
    expect(applyRoundOff(12750, 50)).toBe(12800);
  });

  it("round-trips: total + computeRoundOff(total) is always a whole rupee", () => {
    for (const total of [1, 50, 99, 100, 12734, 12750, 12799, 999999]) {
      const rounded = applyRoundOff(total, computeRoundOff(total));
      expect(rounded % 100).toBe(0);
    }
  });
});
