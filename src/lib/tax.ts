/**
 * Tax rate helpers. A percentage is dimensionless, not currency -- this deliberately does NOT
 * reuse lib/money.ts's Paisa-typed helpers, that would be a modeling error. Stored as integer
 * basis points out of 10,000 (1 bp = 0.01%), which gives headroom for fractional rates (e.g.
 * 8.5%) that do exist in Pakistani retail, without ever needing a schema change -- same "scaled
 * integer" philosophy as money.ts/weight.ts.
 *
 * FBR/tax compliance itself is still out of scope for the whole project (see plan.md section 4) --
 * applyTaxRate below is just "how much tax on this line," not a compliance engine.
 */

export type BasisPoints = number;

/** Parses a percent string/number (e.g. "17.5" or 17.5) into integer basis points (1750). Throws
 * on a non-finite input, out-of-range value, or more than 2 decimal places. */
export function toBps(percent: string | number): BasisPoints {
  const value = typeof percent === "string" ? Number(percent) : percent;

  if (!Number.isFinite(value)) {
    throw new Error(`toBps: not a finite number: ${percent}`);
  }

  if (value < 0 || value > 100) {
    throw new Error(`toBps: percent must be between 0 and 100: ${percent}`);
  }

  const bps = Math.round(value * 100);

  if (Math.abs(bps - value * 100) > 1e-6) {
    throw new Error(`toBps: input has sub-basis-point precision: ${percent}`);
  }

  return bps;
}

/** Converts integer basis points back to a percent number, for display/export only. */
export function fromBps(bps: BasisPoints): number {
  if (!Number.isInteger(bps)) {
    throw new Error(`fromBps: bps must be an integer: ${bps}`);
  }

  return bps / 100;
}

/** Formats integer basis points as a percentage string, e.g. 1750 -> "17.50%". */
export function formatTaxRate(bps: BasisPoints): string {
  if (!Number.isInteger(bps)) {
    throw new Error(`formatTaxRate: bps must be an integer: ${bps}`);
  }

  return `${(bps / 100).toFixed(2)}%`;
}

/** Applies a tax rate (basis points) to an integer paisa amount, returning just the tax portion
 * in paisa, rounded to the nearest paisa (money must stay integer everywhere). */
export function applyTaxRate(amountPaisa: number, bps: BasisPoints): number {
  if (!Number.isInteger(amountPaisa)) {
    throw new Error(`applyTaxRate: amountPaisa must be an integer: ${amountPaisa}`);
  }

  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error(`applyTaxRate: bps must be a non-negative integer: ${bps}`);
  }

  return Math.round((amountPaisa * bps) / 10000);
}
