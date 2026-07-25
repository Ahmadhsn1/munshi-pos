import { describe, expect, it } from "vitest";
import { applyTaxRate } from "@/lib/tax";

describe("applyTaxRate: tax portion of a paisa amount", () => {
  it("computes tax at a whole-percent rate", () => {
    expect(applyTaxRate(10000, 1700)).toBe(1700); // Rs 100 @ 17% = Rs 17
  });

  it("computes tax at a fractional-percent rate", () => {
    expect(applyTaxRate(10000, 850)).toBe(850); // Rs 100 @ 8.5% = Rs 8.50
  });

  it("returns 0 for a 0% rate", () => {
    expect(applyTaxRate(10000, 0)).toBe(0);
  });

  it("rounds to the nearest paisa", () => {
    // 333 * 1700 / 10000 = 56.61 -> 57
    expect(applyTaxRate(333, 1700)).toBe(57);
  });

  it("rejects a non-integer amount", () => {
    expect(() => applyTaxRate(100.5, 1700)).toThrow();
  });

  it("rejects a negative or non-integer bps", () => {
    expect(() => applyTaxRate(10000, -100)).toThrow();
    expect(() => applyTaxRate(10000, 17.5)).toThrow();
  });
});
