import { describe, expect, it } from "vitest";
import { formatTaxRate, fromBps, toBps } from "@/lib/tax";

describe("tax: integer basis points, never float", () => {
  it("round-trips a whole-number percent", () => {
    expect(toBps("17")).toBe(1700);
    expect(fromBps(1700)).toBe(17);
  });

  it("round-trips a fractional percent", () => {
    expect(toBps("8.5")).toBe(850);
    expect(fromBps(850)).toBe(8.5);
  });

  it("round-trips zero", () => {
    expect(toBps("0")).toBe(0);
    expect(fromBps(0)).toBe(0);
  });

  it("rejects a percent outside 0-100", () => {
    expect(() => toBps("101")).toThrow();
    expect(() => toBps("-1")).toThrow();
  });

  it("rejects sub-basis-point precision", () => {
    expect(() => toBps("17.505")).toThrow();
  });

  it("rejects non-finite input", () => {
    expect(() => toBps("not-a-number")).toThrow();
  });

  it("rejects a non-integer bps going into fromBps/formatTaxRate", () => {
    expect(() => fromBps(17.5)).toThrow();
    expect(() => formatTaxRate(17.5)).toThrow();
  });

  it("formats basis points as a percentage string", () => {
    expect(formatTaxRate(1750)).toBe("17.50%");
    expect(formatTaxRate(0)).toBe("0.00%");
    expect(formatTaxRate(10000)).toBe("100.00%");
  });
});
