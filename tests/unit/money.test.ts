import { describe, expect, it } from "vitest";
import { addPaisa, formatPKR, fromPaisa, toPaisa } from "@/lib/money";

describe("money: integer paisa, never float", () => {
  it("round-trips rupees -> paisa -> rupees", () => {
    expect(toPaisa("123.45")).toBe(12345);
    expect(toPaisa(123.45)).toBe(12345);
    expect(fromPaisa(12345)).toBe(123.45);
  });

  it("round-trips whole rupees", () => {
    expect(toPaisa("100")).toBe(10000);
    expect(fromPaisa(10000)).toBe(100);
  });

  it("round-trips zero and negative amounts (returns/refunds)", () => {
    expect(toPaisa("0")).toBe(0);
    expect(toPaisa("-50.25")).toBe(-5025);
    expect(fromPaisa(-5025)).toBe(-50.25);
  });

  it("rejects sub-paisa precision instead of silently rounding money away", () => {
    expect(() => toPaisa("1.005")).toThrow();
  });

  it("rejects non-finite input", () => {
    expect(() => toPaisa("not-a-number")).toThrow();
    expect(() => toPaisa(Infinity)).toThrow();
  });

  it("rejects non-integer paisa going into fromPaisa/formatPKR", () => {
    expect(() => fromPaisa(12.5)).toThrow();
    expect(() => formatPKR(12.5)).toThrow();
  });

  it("formats PKR with comma grouping and 2 decimals", () => {
    expect(formatPKR(12345)).toBe("Rs 123.45");
    expect(formatPKR(100000)).toBe("Rs 1,000.00");
    expect(formatPKR(5)).toBe("Rs 0.05");
    expect(formatPKR(-5025)).toBe("-Rs 50.25");
  });

  it("adds paisa amounts without float drift", () => {
    // The classic float trap: 0.1 + 0.2 !== 0.3 in IEEE 754. In paisa this must be exact.
    const a = toPaisa("0.10");
    const b = toPaisa("0.20");
    expect(addPaisa(a, b)).toBe(30);
  });

  it("rejects adding a non-integer amount", () => {
    expect(() => addPaisa(100, 12.5 as unknown as number)).toThrow();
  });
});
