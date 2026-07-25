/**
 * Cash round-off policy for a checkout. Only ever applied to a 100%-cash sale -- splitting
 * cash+khata and rounding would desync the exact khata debt Phase 5's ledger needs to reconcile
 * (also enforced server-side, independently, inside the complete_sale RPC).
 *
 * Policy lives here in TypeScript, not as a generated Postgres column: "nearest rupee" is a
 * business rule that can change (a future shop preference might want nearest-5-rupee), while the
 * *result* -- an integer round_off_paisa -- is what actually gets persisted and is what
 * complete_sale bounds to a small sane range server-side.
 */

export type RoundOffPolicy = "nearest-rupee" | "none";

const PAISA_PER_RUPEE = 100;

/** Computes the signed paisa adjustment needed to round totalPaisa to the nearest rupee (or 0 for
 * "none"). Negative shortens the bill (rounds down), positive lengthens it (rounds up). Exactly
 * halfway (50 paisa) rounds up, matching standard cash-rounding convention. */
export function computeRoundOff(totalPaisa: number, policy: RoundOffPolicy = "nearest-rupee"): number {
  if (!Number.isInteger(totalPaisa)) {
    throw new Error(`computeRoundOff: totalPaisa must be an integer: ${totalPaisa}`);
  }

  if (policy === "none") {
    return 0;
  }

  const remainder = ((totalPaisa % PAISA_PER_RUPEE) + PAISA_PER_RUPEE) % PAISA_PER_RUPEE;
  if (remainder === 0) {
    return 0;
  }

  return remainder >= PAISA_PER_RUPEE / 2 ? PAISA_PER_RUPEE - remainder : -remainder;
}

/** Applies a computed round-off to a total, for display/preview only. */
export function applyRoundOff(totalPaisa: number, roundOffPaisa: number): number {
  if (!Number.isInteger(totalPaisa) || !Number.isInteger(roundOffPaisa)) {
    throw new Error("applyRoundOff: both arguments must be integers");
  }

  return totalPaisa + roundOffPaisa;
}
