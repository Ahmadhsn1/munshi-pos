import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

describe("complete_sale: khata credit-limit / blacklist enforcement", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;
  const openShiftIds: string[] = [];

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "khata-limit");
    stockUnitId = await getUnitIdByKey(admin, tenant.tenantId, "piece");
  });

  afterAll(async () => {
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  afterEach(async () => {
    for (const id of openShiftIds.splice(0)) {
      await admin.from("shifts").update({ status: "closed", closed_at: new Date(0).toISOString() }).eq("id", id);
    }
  });

  async function openShift() {
    const id = await createOpenShift(admin, tenant.tenantId, tenant.ownerId, tenant.ownerId);
    openShiftIds.push(id);
    return id;
  }

  async function khataSale(customerId: string, amountPaisa: number, shiftId?: string) {
    const resolvedShiftId = shiftId ?? (await openShift());
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await giveProductStock(admin, tenant.tenantId, productId, 1000, tenant.ownerId);
    return createOpenSale(
      admin,
      tenant.tenantId,
      resolvedShiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: amountPaisa }],
      customerId,
    );
  }

  function complete(saleId: string, amountPaisa: number, overrideKhataLimit: boolean) {
    return admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "khata", amount_paisa: amountPaisa }],
      p_override_khata_limit: overrideKhataLimit,
    });
  }

  it("a khata sale under the credit limit succeeds with no warning", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { credit_limit_paisa: 100000 });
    const saleId = await khataSale(customerId, 5000);

    const { data, error } = await complete(saleId, 5000, false);

    expect(error).toBeNull();
    expect(data.khataWarning).toBe(false);
  });

  it("a khata sale with no credit limit set (unlimited) always succeeds", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId); // credit_limit_paisa left null
    const saleId = await khataSale(customerId, 500000);

    const { data, error } = await complete(saleId, 500000, false);

    expect(error).toBeNull();
    expect(data.khataWarning).toBe(false);
  });

  it("blocks a khata sale that would exceed the credit limit, without override", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { credit_limit_paisa: 10000 });
    const saleId = await khataSale(customerId, 15000);

    const { error } = await complete(saleId, 15000, false);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/over their credit limit/i);
  });

  it("allows a khata sale over the credit limit WITH override, and flags khataWarning", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { credit_limit_paisa: 10000 });
    const saleId = await khataSale(customerId, 15000);

    const { data, error } = await complete(saleId, 15000, true);

    expect(error).toBeNull();
    expect(data.khataWarning).toBe(true);
  });

  it("blocks any khata sale to a blacklisted customer, without override", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { is_blacklisted: true });
    const saleId = await khataSale(customerId, 100);

    const { error } = await complete(saleId, 100, false);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/blacklisted/i);
  });

  it("allows a khata sale to a blacklisted customer WITH override, and flags khataWarning", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { is_blacklisted: true });
    const saleId = await khataSale(customerId, 100);

    const { data, error } = await complete(saleId, 100, true);

    expect(error).toBeNull();
    expect(data.khataWarning).toBe(true);
  });

  it("rejects a khata payment on a sale with no customer", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await giveProductStock(admin, tenant.tenantId, productId, 10, tenant.ownerId);
    const saleId = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: 500 }],
      null,
    );

    const { error } = await complete(saleId, 500, false);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/requires the sale to have a customer/i);
  });

  it("a non-khata (cash) sale ignores credit limit and blacklist entirely", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, {
      credit_limit_paisa: 100,
      is_blacklisted: true,
    });
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await giveProductStock(admin, tenant.tenantId, productId, 10, tenant.ownerId);
    const saleId = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: 999999 }],
      customerId,
    );

    const { data, error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 999999 }],
      p_override_khata_limit: false,
    });

    expect(error).toBeNull();
    expect(data.khataWarning).toBe(false);
  });

  it("the balance formula correctly nets a prior khata sale against its own full-void reversal", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { credit_limit_paisa: 6000 });
    const shiftId = await openShift();

    // First sale: khata Rs 50 (5000 paisa) -- would leave only Rs 10 of headroom.
    const firstSaleId = await khataSale(customerId, 5000, shiftId);
    const { error: firstError } = await complete(firstSaleId, 5000, false);
    expect(firstError).toBeNull();

    // Void it in full -- balance should return to 0.
    const { data: lineItem } = await admin.from("sale_line_items").select("id").eq("sale_id", firstSaleId).single();
    const { data: shiftRow } = await admin.from("sales").select("shift_id").eq("id", firstSaleId).single();
    const { error: voidError } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: firstSaleId,
      p_shift_id: shiftRow!.shift_id,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "void",
      p_note: "test void",
      p_lines: [{ sale_line_item_id: lineItem!.id, quantity: 1 }],
      p_refund_payments: [{ payment_mode: "khata", amount_paisa: 5000 }],
      p_mark_sale_void: true,
    });
    expect(voidError).toBeNull();

    // Second sale: khata Rs 55 (5500 paisa) -- would be REJECTED if the voided sale still counted
    // against the limit (5000 + 5500 = 10500 > 6000), but must succeed since the void nets to zero.
    const secondSaleId = await khataSale(customerId, 5500, shiftId);
    const { error: secondError } = await complete(secondSaleId, 5500, false);
    expect(secondError).toBeNull();
  });

  it("row lock serializes two concurrent khata checkouts for the same customer -- exactly one succeeds", async () => {
    const customerId = await createTestCustomer(admin, tenant.tenantId, { credit_limit_paisa: 10000 });
    const shiftId = await openShift();
    const saleA = await khataSale(customerId, 6000, shiftId);
    const saleB = await khataSale(customerId, 6000, shiftId);

    // Individually each is within the Rs 100 limit; together (12000) they exceed it. Without the
    // customer row lock serializing these two transactions, both could read a pre-commit balance
    // of 0 and both succeed, pushing the customer to 12000 -- 20% over limit.
    const [resultA, resultB] = await Promise.all([complete(saleA, 6000, false), complete(saleB, 6000, false)]);
    const errors = [resultA.error, resultB.error];
    const successes = errors.filter((e) => e === null).length;
    const failures = errors.filter((e) => e !== null).length;

    expect(successes).toBe(1);
    expect(failures).toBe(1);

    const { data: khataPayments } = await admin
      .from("sale_payments")
      .select("amount_paisa, sale_id")
      .eq("payment_mode", "khata")
      .in("sale_id", [saleA, saleB]);
    // Only the winning sale's payment row should exist.
    expect(khataPayments).toHaveLength(1);
  });

  it("sale_return_payments rejects a khata refund when the original sale has no customer", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await giveProductStock(admin, tenant.tenantId, productId, 10, tenant.ownerId);
    const saleId = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: 1000 }],
      null,
    );
    const { error: completeError } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 1000 }],
      p_override_khata_limit: false,
    });
    expect(completeError).toBeNull();

    const { data: saleReturn } = await admin
      .from("sale_returns")
      .insert({
        tenant_id: tenant.tenantId,
        sale_id: saleId,
        shift_id: shiftId,
        cashier_user_id: tenant.ownerId,
        session_user_id: tenant.ownerId,
        reason_code: "other",
        subtotal_paisa: 1000,
        total_paisa: 1000,
      })
      .select("id")
      .single();

    const { error } = await admin.from("sale_return_payments").insert({
      tenant_id: tenant.tenantId,
      sale_return_id: saleReturn!.id,
      payment_mode: "khata",
      amount_paisa: 1000,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/requires the original sale to have a customer/i);
  });
});
