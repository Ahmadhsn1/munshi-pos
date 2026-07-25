import { describe, expect, it } from "vitest";
import { formatWeight, fromGrams, toGrams } from "@/lib/weight";

describe("weight: integer grams, never float", () => {
  it("round-trips kilograms -> grams -> kilograms", () => {
    expect(toGrams("1.250")).toBe(1250);
    expect(fromGrams(1250)).toBe(1.25);
  });

  it("round-trips small weights", () => {
    expect(toGrams("0.005")).toBe(5);
    expect(fromGrams(5)).toBe(0.005);
  });

  it("rejects sub-gram precision", () => {
    expect(() => toGrams("1.2505")).toThrow();
  });

  it("rejects non-integer grams going into fromGrams/formatWeight", () => {
    expect(() => fromGrams(1.5)).toThrow();
    expect(() => formatWeight(1.5)).toThrow();
  });

  it("formats under 1kg in grams, 1kg and over in kilograms", () => {
    expect(formatWeight(500)).toBe("500 g");
    expect(formatWeight(1000)).toBe("1.000 kg");
    expect(formatWeight(1250)).toBe("1.250 kg");
  });
});
