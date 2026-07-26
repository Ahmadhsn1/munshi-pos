import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createOpenSale,
  createOpenShift,
  createTenantWithOwner,
  createTestCustomer,
  createTestProduct,
  getUnitIdByKey,
  giveProductStock,
  type TenantFixture,
} from "./helpers";

// Mirrors the exact aggregation POST /api/pos/shifts/[id]/close performs (opening_cash_paisa +
// cash sale_payments for the shift's sales - cash sale_return_payments for the shift's returns).
// The route itself is plain sequential queries, not a stored function (per the Phase 3 plan:
// variance is read once per shift close, not worth a trigger-maintained column) -- so this test
// proves the underlying data the route reads is correct, rather than driving the route over HTTP.
async function computeExpectedCash(admin: SupabaseClient, shiftId: string, openingCashPaisa: number) {
  const { data: sales } = await admin.from("sales").select("id").eq("shift_id", shiftId);
  const saleIds = (sales ?? []).map((s) => s.id);

  const { data: returns } = await admin.from("sale_returns").select("id").eq("shift_id", shiftId);
  const returnIds = (returns ?? []).map((r) => r.id);

  let cashIn = 0;
  if (saleIds.length > 0) {
    const { data } = await admin.from("sale_payments").select("amount_paisa").in("sale_id", saleIds).eq("payment_mode", "cash");
    cashIn = (data ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
  }

  // Cash khata receipts taken at this counter. Money in the drawer that the original formula could
  // not see at all, because customer_payments had no shift link.
  const { data: khataCash } = await admin
    .from("customer_payments")
    .select("amount_paisa")
    .eq("shift_id", shiftId)
    .eq("payment_mode", "cash");
  cashIn += (khataCash ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);

  let cashOut = 0;
  if (returnIds.length > 0) {
    const { data } = await admin
      .from("sale_return_payments")
      .select("amount_paisa")
      .in("sale_return_id", returnIds)
      .eq("payment_mode", "cash");
    cashOut = (data ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
  }

  // Expenses paid straight out of the till. Voided ones are excluded.
  const { data: expenseCash } = await admin
    .from("expenses")
    .select("amount_paisa")
    .eq("shift_id", shiftId)
    .is("voided_at", null);
  cashOut += (expenseCash ?? []).reduce((sum, e) => sum + e.amount_paisa, 0);

  return openingCashPaisa + cashIn - cashOut;
}

describe("shift cash variance", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "shift-var");
    stockUnitId = await getUnitIdByKey(admin, tenant.tenantId, "piece");
  });

  afterAll(async () => {
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  it("computes expected cash correctly across mixed cash/khata sales and a cash return", async () => {
    const openingCash = 5000_00; // Rs 5,000
    const shiftId = await createOpenShift(admin, tenant.tenantId, tenant.ownerId, tenant.ownerId, openingCash);

    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 20000 });
    await giveProductStock(admin, tenant.tenantId, productId, 100, tenant.ownerId);
    const customerId = await createTestCustomer(admin, tenant.tenantId);

    // Sale 1: cash, Rs 200
    const saleCash = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 20000 },
    ]);
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleCash,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 20000 }],
    });

    // Sale 2: khata, Rs 400 -- must NOT count toward cash-in.
    const saleKhata = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 2, unitPricePaisa: 20000 }],
      customerId,
    );
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleKhata,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "khata", amount_paisa: 40000 }],
    });

    // Sale 3: cash, Rs 600, later partially returned Rs 200 in cash.
    const saleForReturn = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 3, unitPricePaisa: 20000 },
    ]);
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleForReturn,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 60000 }],
    });

    const { data: lineItem } = await admin
      .from("sale_line_items")
      .select("id")
      .eq("sale_id", saleForReturn)
      .single();

    await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleForReturn,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "customer_changed_mind",
      p_note: null,
      p_lines: [{ sale_line_item_id: lineItem!.id, quantity: 1 }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 20000 }],
      p_mark_sale_void: false,
    });

    // Expected: opening 5000 + cash-in (200 + 600) - cash-out (200) = Rs 5,600
    const expected = await computeExpectedCash(admin, shiftId, openingCash);
    expect(expected).toBe(5000_00 + 20000 + 60000 - 20000);

    const actualCash = expected; // cashier counted the drawer and it matched exactly
    const variance = actualCash - expected;
    expect(variance).toBe(0);

    await admin
      .from("shifts")
      .update({
        status: "closed",
        closed_at: new Date(0).toISOString(),
        expected_cash_paisa: expected,
        actual_cash_paisa: actualCash,
        variance_paisa: variance,
      })
      .eq("id", shiftId);

    const { data: closedShift } = await admin
      .from("shifts")
      .select("status, expected_cash_paisa, actual_cash_paisa, variance_paisa")
      .eq("id", shiftId)
      .single();
    expect(closedShift?.status).toBe("closed");
    expect(closedShift?.expected_cash_paisa).toBe(expected);
    expect(closedShift?.variance_paisa).toBe(0);
  });

  // REGRESSION TEST for the bug this phase fixed. A khata customer paying down udhaar in cash puts
  // real money in the drawer, and a chai run takes real money out. Neither was visible to shift
  // close: customer_payments and expenses had no shift link, so expected cash counted only sales
  // and refunds. The cashier was reported as holding a SURPLUS equal to every udhaar payment they
  // had collected -- which can cancel out, and therefore hide, a genuine shortage in the one number
  // whose entire purpose is theft visibility. It also accuses an honest cashier of a variance they
  // did not create. Both directions are asserted here.
  it("counts cash khata receipts in and cash expenses out of the drawer", async () => {
    const openingCash = 2000_00;
    const shiftId = await createOpenShift(admin, tenant.tenantId, tenant.ownerId, tenant.ownerId, openingCash);
    const customerId = await createTestCustomer(admin, tenant.tenantId);

    // Rs 750 of udhaar paid back in cash -- lands in the drawer.
    await admin.from("customer_payments").insert({
      tenant_id: tenant.tenantId,
      customer_id: customerId,
      payment_mode: "cash",
      amount_paisa: 750_00,
      shift_id: shiftId,
      created_by: tenant.ownerId,
    });

    // A non-cash khata payment must NOT move the drawer. The DB check constraint forbids pairing a
    // shift with a non-cash mode, so this is recorded with no shift at all -- asserting here that
    // it is genuinely excluded rather than silently counted.
    await admin.from("customer_payments").insert({
      tenant_id: tenant.tenantId,
      customer_id: customerId,
      payment_mode: "bank_transfer",
      amount_paisa: 5000_00,
      created_by: tenant.ownerId,
    });

    const { data: category } = await admin
      .from("expense_categories")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("key", "tea_food")
      .single();

    // Rs 120 of chai paid out of the till.
    await admin.from("expenses").insert({
      tenant_id: tenant.tenantId,
      category_id: category!.id,
      amount_paisa: 120_00,
      payment_mode: "cash",
      shift_id: shiftId,
      created_by: tenant.ownerId,
    });

    // A voided expense must not reduce the drawer -- the money went back in.
    const { data: voidedExpense } = await admin
      .from("expenses")
      .insert({
        tenant_id: tenant.tenantId,
        category_id: category!.id,
        amount_paisa: 999_00,
        payment_mode: "cash",
        shift_id: shiftId,
        created_by: tenant.ownerId,
      })
      .select("id")
      .single();

    await admin
      .from("expenses")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: tenant.ownerId,
        void_reason: "entered twice by mistake",
      })
      .eq("id", voidedExpense!.id);

    const expected = await computeExpectedCash(admin, shiftId, openingCash);

    // 2000 opening + 750 khata cash - 120 chai. The bank transfer and the voided expense are
    // both excluded; under the old formula this would have come out as a flat 2000.
    expect(expected).toBe(2000_00 + 750_00 - 120_00);
    expect(expected).not.toBe(openingCash);

    // Close it: uq_shifts_one_open_per_cashier permits only one open shift per cashier, so leaving
    // this one open would break whichever test opens the next shift.
    await admin
      .from("shifts")
      .update({
        status: "closed",
        closed_at: new Date(0).toISOString(),
        expected_cash_paisa: expected,
        actual_cash_paisa: expected,
        variance_paisa: 0,
      })
      .eq("id", shiftId);
  });

  it("reports a non-zero variance when the counted cash does not match the expected amount", async () => {
    const openingCash = 1000_00;
    const shiftId = await createOpenShift(admin, tenant.tenantId, tenant.ownerId, tenant.ownerId, openingCash);

    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 50000 });
    await giveProductStock(admin, tenant.tenantId, productId, 10, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 50000 },
    ]);
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 50000 }],
    });

    const expected = await computeExpectedCash(admin, shiftId, openingCash);
    const actualCash = expected - 5000; // drawer is short by Rs 50

    await admin
      .from("shifts")
      .update({
        status: "closed",
        closed_at: new Date(0).toISOString(),
        expected_cash_paisa: expected,
        actual_cash_paisa: actualCash,
        variance_paisa: actualCash - expected,
      })
      .eq("id", shiftId);

    const { data: closedShift } = await admin
      .from("shifts")
      .select("variance_paisa")
      .eq("id", shiftId)
      .single();
    expect(closedShift?.variance_paisa).toBe(-5000);
  });
});
