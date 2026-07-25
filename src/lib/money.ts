/**
 * Project-wide rule: money is always an integer number of paisa (1 PKR = 100 paisa). Never a
 * float, anywhere -- not in the database (use `integer`/`bigint`, never `float`/`real`), not in
 * application code. Floats cannot represent currency exactly and will eventually produce a bill
 * that doesn't reconcile.
 *
 * These helpers are the only sanctioned boundary between integer paisa and any float-ish
 * input/output (form fields, display strings).
 */

export type Paisa = number;

/** Parses a rupees string/number (e.g. "123.45" or 123.45) into integer paisa (12345). Throws on
 * a non-finite input or more than 2 decimal places, rather than silently rounding away real money. */
export function toPaisa(rupees: string | number): Paisa {
  const value = typeof rupees === "string" ? Number(rupees) : rupees;

  if (!Number.isFinite(value)) {
    throw new Error(`toPaisa: not a finite number: ${rupees}`);
  }

  const paisa = Math.round(value * 100);

  if (Math.abs(paisa - value * 100) > 1e-6) {
    throw new Error(`toPaisa: input has sub-paisa precision: ${rupees}`);
  }

  return paisa;
}

/** Converts integer paisa back to a rupees number, for display/export only -- never feed this
 * back into a calculation. */
export function fromPaisa(paisa: Paisa): number {
  if (!Number.isInteger(paisa)) {
    throw new Error(`fromPaisa: paisa must be an integer: ${paisa}`);
  }

  return paisa / 100;
}

/** Formats integer paisa as a PKR display string, e.g. 12345 -> "Rs 123.45". */
export function formatPKR(paisa: Paisa): string {
  if (!Number.isInteger(paisa)) {
    throw new Error(`formatPKR: paisa must be an integer: ${paisa}`);
  }

  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const rupees = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  const withCommas = rupees.toLocaleString("en-PK");

  return `${negative ? "-" : ""}Rs ${withCommas}.${remainder}`;
}

/** Adds integer paisa amounts. Present mainly so call sites never reach for `+` on raw numbers
 * out of habit and accidentally mix in a float. */
export function addPaisa(...amounts: Paisa[]): Paisa {
  return amounts.reduce((sum, amount) => {
    if (!Number.isInteger(amount)) {
      throw new Error(`addPaisa: all amounts must be integers: ${amount}`);
    }
    return sum + amount;
  }, 0);
}
