import { describe, expect, it } from "vitest";
import { createAdminClient } from "./helpers";

/**
 * Money-correctness reconciliation against the REAL database.
 *
 * Every other check in this repo -- tsc, eslint, the unit suite, `next build` -- verifies that the
 * code as written behaves. None of them can see stored data drifting away from its own source of
 * truth: a `products.current_stock` that no longer equals the sum of its ledger, a sale whose
 * stored total stopped matching its own line items, a refund that doesn't add up. Those are
 * precisely the failures a shopkeeper hits first and forgives last, because by the time anyone
 * notices, the wrong number is already in a customer's hand.
 *
 * Each row from check_money_integrity() is a violation COUNT that must be zero. New invariants are
 * added to the SQL function, not here, so this test strengthens automatically.
 *
 * The assertion is deliberately written to print WHICH invariant broke and by how many rows --
 * "expected 3 to be 0" on an anonymous number would send the next reader hunting.
 */
describe("stored money still reconciles against its own source of truth", () => {
  it("reports zero violations for every money invariant", async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_money_integrity");

    expect(error).toBeNull();

    const rows = (data ?? []) as { check_name: string; violation_count: number }[];

    // Guards against the RPC silently returning nothing (e.g. renamed/dropped) and this test
    // then passing vacuously forever.
    expect(rows.length).toBeGreaterThanOrEqual(9);

    const violations = rows
      .filter((row) => Number(row.violation_count) > 0)
      .map((row) => `${row.check_name}: ${row.violation_count} row(s)`);

    expect(violations, "money integrity violations found in the live database").toEqual([]);
  });
});
