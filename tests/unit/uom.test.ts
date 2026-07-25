import { describe, expect, it } from "vitest";
import { formatQuantity, fromStockQuantity, toStockQuantity } from "@/lib/uom";

describe("uom: purchase/sale unit <-> stock unit conversion", () => {
  it("converts a purchase quantity into stock units (carton -> packet example)", () => {
    // 1 carton = 24 packets
    expect(toStockQuantity(3, 24)).toBe(72);
  });

  it("converts a sale quantity into stock units", () => {
    // 1 packet = 250 grams
    expect(toStockQuantity(2, 250)).toBe(500);
  });

  it("round-trips an exact conversion", () => {
    const stock = toStockQuantity(3, 24);
    expect(fromStockQuantity(stock, 24)).toBe(3);
  });

  it("supports a chained conversion as composed factors (carton->packet->gram)", () => {
    // 1 carton = 24 packets, 1 packet = 250 grams -- selling by the gram from stock held in
    // grams, purchased by the carton: the flat model captures this as one factor per unit role
    // relative to stock_unit (here, stock_unit = gram), not a literal chain.
    const cartonToGramFactor = 24 * 250; // 1 carton = 6000 grams
    expect(toStockQuantity(1, cartonToGramFactor)).toBe(6000);
  });

  it("allows a non-integer result when converting stock units back for display (not for storage)", () => {
    expect(fromStockQuantity(80, 24)).toBeCloseTo(3.333, 3);
  });

  it("treats a factor of 1 as a same-unit passthrough", () => {
    expect(toStockQuantity(5, 1)).toBe(5);
    expect(fromStockQuantity(5, 1)).toBe(5);
  });

  it("rejects a non-integer or negative quantity", () => {
    expect(() => toStockQuantity(2.5, 24)).toThrow();
    expect(() => toStockQuantity(-1, 24)).toThrow();
  });

  it("rejects a conversion factor below 1", () => {
    expect(() => toStockQuantity(3, 0)).toThrow();
    expect(() => toStockQuantity(3, -2)).toThrow();
    expect(() => toStockQuantity(3, 1.5)).toThrow();
  });

  it("formats a stock quantity with its unit name", () => {
    expect(formatQuantity(72, "packet")).toBe("72 packet");
  });

  it("rejects formatting a non-integer stock quantity", () => {
    expect(() => formatQuantity(3.5, "packet")).toThrow();
  });
});
