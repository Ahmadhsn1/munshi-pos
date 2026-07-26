import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addBusinessDays,
  businessToday,
  daysBetween,
  defaultReportRange,
  formatBps,
  marginBps,
  resolveReportRange,
} from "@/lib/reports";

describe("businessToday", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * THE bug this whole helper exists to prevent. Vercel runs in UTC; Pakistan is UTC+5. Between
   * 19:00 and 24:00 UTC it is already TOMORROW in Karachi, so the naive
   * `new Date().toISOString().slice(0, 10)` that every report would otherwise reach for reports the
   * wrong day for the last five hours of every UTC day -- which is prime trading time in a shop
   * that stays open late. Migration 20260726000007 fixed exactly this on the write side after it
   * was caught mis-dating real money; this is the read-side counterpart.
   */
  it("returns the Pakistan date, not the UTC date, during the late-evening UTC window", () => {
    vi.useFakeTimers();
    // 2026-07-25 22:56 UTC == 2026-07-26 03:56 in Karachi.
    vi.setSystemTime(new Date("2026-07-25T22:56:00Z"));

    expect(businessToday()).toBe("2026-07-26");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-07-25"); // what the naive version gives
  });

  it("agrees with UTC during the middle of the UTC day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T09:00:00Z")); // 14:00 Karachi, same calendar day
    expect(businessToday()).toBe("2026-07-25");
  });

  it("returns a YYYY-MM-DD string", () => {
    expect(businessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addBusinessDays", () => {
  it("moves forward and backward within a month", () => {
    expect(addBusinessDays("2026-07-10", 5)).toBe("2026-07-15");
    expect(addBusinessDays("2026-07-10", -5)).toBe("2026-07-05");
  });

  it("crosses month and year boundaries", () => {
    expect(addBusinessDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addBusinessDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(addBusinessDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addBusinessDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("is not shifted by the machine's local timezone", () => {
    // Pure calendar arithmetic on a date string -- if this were done with local-time Date parsing,
    // a machine west of UTC would land on the previous day.
    expect(addBusinessDays("2026-07-10", 0)).toBe("2026-07-10");
  });
});

describe("daysBetween", () => {
  it("counts inclusively", () => {
    expect(daysBetween("2026-07-10", "2026-07-10")).toBe(1);
    expect(daysBetween("2026-07-10", "2026-07-11")).toBe(2);
  });

  it("counts across a month boundary", () => {
    expect(daysBetween("2026-07-30", "2026-08-02")).toBe(4);
  });
});

describe("defaultReportRange", () => {
  it("spans 30 days inclusive, ending today", () => {
    const range = defaultReportRange("2026-07-26");
    expect(range.to).toBe("2026-07-26");
    expect(range.from).toBe("2026-06-27");
    expect(daysBetween(range.from, range.to)).toBe(30);
  });
});

describe("resolveReportRange", () => {
  it("accepts a valid range", () => {
    expect(resolveReportRange("2026-07-01", "2026-07-31")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("accepts a single-day range", () => {
    expect(resolveReportRange("2026-07-01", "2026-07-01")).toEqual({
      from: "2026-07-01",
      to: "2026-07-01",
    });
  });

  it("rejects a reversed range rather than silently returning nothing", () => {
    expect(resolveReportRange("2026-07-31", "2026-07-01")).toBeNull();
  });

  it("returns null for missing or malformed input so the caller can fall back", () => {
    expect(resolveReportRange(undefined, undefined)).toBeNull();
    expect(resolveReportRange("2026-7-1", "2026-07-31")).toBeNull();
    expect(resolveReportRange("not-a-date", "2026-07-31")).toBeNull();
    // A hand-edited URL must not produce a 500.
    expect(resolveReportRange("<script>", "2026-07-31")).toBeNull();
  });

  it("clamps an absurdly wide range instead of aggregating all history on every page load", () => {
    const clamped = resolveReportRange("1990-01-01", "2026-07-26");
    expect(clamped).not.toBeNull();
    expect(clamped!.to).toBe("2026-07-26");
    expect(daysBetween(clamped!.from, clamped!.to)).toBe(366);
  });
});

describe("marginBps", () => {
  it("computes margin as basis points of revenue", () => {
    // Sold for Rs 100, cost Rs 60 -> 40% margin.
    expect(marginBps(10000, 6000)).toBe(4000);
  });

  it("returns zero margin on zero revenue rather than dividing by zero", () => {
    expect(marginBps(0, 0)).toBe(0);
    expect(marginBps(0, 5000)).toBe(0);
    expect(Number.isFinite(marginBps(0, 5000))).toBe(true);
  });

  it("reports a NEGATIVE margin when stock is cleared below cost", () => {
    // Selling Rs 80 of stock that cost Rs 100 is a real thing shops do to clear old inventory --
    // clamping this to zero would hide the loss, which is the opposite of what the report is for.
    expect(marginBps(8000, 10000)).toBe(-2500);
  });

  it("reports full margin when cost is unknown/zero", () => {
    expect(marginBps(10000, 0)).toBe(10000);
  });
});

describe("formatBps", () => {
  it("renders basis points as a percentage", () => {
    expect(formatBps(2350)).toBe("23.5%");
    expect(formatBps(10000)).toBe("100.0%");
    expect(formatBps(-2500)).toBe("-25.0%");
    expect(formatBps(0)).toBe("0.0%");
  });
});
