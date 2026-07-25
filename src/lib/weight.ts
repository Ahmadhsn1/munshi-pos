/**
 * Project-wide rule: weight is always an integer number of grams. Never a float, for the same
 * reason as money (see lib/money.ts) -- fractional-gram floats drift under repeated
 * addition/subtraction across a long stock ledger.
 */

export type Grams = number;

/** Parses a kilograms string/number (e.g. "1.250" or 1.25) into integer grams (1250). Throws on
 * a non-finite input or more than 3 decimal places. */
export function toGrams(kilograms: string | number): Grams {
  const value = typeof kilograms === "string" ? Number(kilograms) : kilograms;

  if (!Number.isFinite(value)) {
    throw new Error(`toGrams: not a finite number: ${kilograms}`);
  }

  const grams = Math.round(value * 1000);

  if (Math.abs(grams - value * 1000) > 1e-6) {
    throw new Error(`toGrams: input has sub-gram precision: ${kilograms}`);
  }

  return grams;
}

/** Converts integer grams back to a kilograms number, for display/export only. */
export function fromGrams(grams: Grams): number {
  if (!Number.isInteger(grams)) {
    throw new Error(`fromGrams: grams must be an integer: ${grams}`);
  }

  return grams / 1000;
}

/** Formats integer grams for display, e.g. 1250 -> "1.250 kg", 500 -> "500 g". */
export function formatWeight(grams: Grams): string {
  if (!Number.isInteger(grams)) {
    throw new Error(`formatWeight: grams must be an integer: ${grams}`);
  }

  if (Math.abs(grams) >= 1000) {
    return `${(grams / 1000).toFixed(3)} kg`;
  }

  return `${grams} g`;
}
