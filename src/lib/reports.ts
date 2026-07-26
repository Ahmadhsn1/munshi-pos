import { reportRangeSchema } from "@/lib/validation";

export interface ReportRange {
  /** Inclusive business date, YYYY-MM-DD. */
  from: string;
  /** Inclusive business date, YYYY-MM-DD. */
  to: string;
}

/**
 * The shop's business timezone. Pakistan is UTC+5 with no DST, and the product is Pakistan-specific
 * by design (plan.md), so this is hard-coded to match public.business_date() on the SQL side. If the
 * product ever goes multi-region this belongs on the tenant record -- in BOTH places at once.
 */
const BUSINESS_TIMEZONE = "Asia/Karachi";

/**
 * Today's date as the SHOP sees it, not as the server does.
 *
 * Vercel runs in UTC. Between 00:00 and 05:00 Pakistan time it is still yesterday in UTC, so a
 * naive `new Date().toISOString().slice(0, 10)` would default every report to the wrong day for the
 * first five hours of trading -- the exact class of bug migration 20260726000007 fixed on the
 * database side. `en-CA` is used because it formats as YYYY-MM-DD, which is both what the SQL
 * `date` type expects and what sorts correctly as a string.
 */
export function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Adds (or subtracts, for a negative value) whole days to a YYYY-MM-DD business date. */
export function addBusinessDays(date: string, days: number): string {
  // Parsed as UTC midnight and shifted in whole days, so this is pure calendar arithmetic with no
  // timezone involved -- the input is already a business date, not an instant.
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Last 30 days inclusive of today -- a useful default window for every report screen. */
export function defaultReportRange(today: string): ReportRange {
  return { from: addBusinessDays(today, -29), to: today };
}

/**
 * Validates a user-supplied range from the query string.
 *
 * Returns null when absent or invalid so the caller can fall back to the default, rather than
 * throwing a 500 at someone who hand-edited a URL. Note the range is also clamped: an unbounded
 * `from` would let one request aggregate over the shop's entire history on every page load.
 */
export function resolveReportRange(
  from: string | undefined,
  to: string | undefined,
): ReportRange | null {
  const parsed = reportRangeSchema.safeParse({ from, to });
  if (!parsed.success) return null;

  const MAX_RANGE_DAYS = 366;
  if (daysBetween(parsed.data.from, parsed.data.to) > MAX_RANGE_DAYS) {
    return { from: addBusinessDays(parsed.data.to, -(MAX_RANGE_DAYS - 1)), to: parsed.data.to };
  }

  return parsed.data;
}

/** Inclusive day count between two YYYY-MM-DD business dates. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000;
  const diff = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(diff / MS_PER_DAY) + 1;
}

/**
 * Gross margin as basis points of revenue (10000 bps = 100%).
 *
 * Basis points rather than a float percentage keeps this consistent with `products.tax_rate_bps`
 * and avoids reintroducing floats into money-adjacent maths. Revenue of zero yields 0 rather than a
 * division by zero -- a day with no sales has no margin, not an infinite one.
 *
 * Margin can legitimately be NEGATIVE (selling below cost to clear stock), so this must not clamp.
 */
export function marginBps(revenuePaisa: number, cogsPaisa: number): number {
  if (revenuePaisa === 0) return 0;
  return Math.round(((revenuePaisa - cogsPaisa) / revenuePaisa) * 10000);
}

/** Formats basis points as a human percentage string, e.g. 2350 -> "23.5%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}
