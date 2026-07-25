import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createOpenSale,
  createOpenShift,
  createTenantWithOwner,
  createTestProduct,
  getUnitIdByKey,
  giveProductStock,
  type TenantFixture,
} from "./helpers";

describe("record_sale_return RPC (return + void)", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;
  const openShiftIds: string[] = [];

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "return-void");
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

  async function completedSale(shiftId: string, productId: string, quantity: number, unitPricePaisa: number) {
    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity, unitPricePaisa },
    ]);
    const total = quantity * unitPricePaisa;
    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: total }],
    });
    if (error) throw error;

    const { data: lineItem } = await admin.from("sale_line_items").select("id").eq("sale_id", saleId).single();
    return { saleId, lineItemId: lineItem!.id as string };
  }

  it("partial return: restocks the returned quantity and leaves the sale completed (not void)", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 20, tenant.ownerId);

    const { saleId, lineItemId } = await completedSale(shiftId, productId, 5, 10000);

    const { data: stockAfterSale } = await admin.from("products").select("current_stock").eq("id", productId).single();
    expect(stockAfterSale?.current_stock).toBe(15);

    const { data, error } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "defective",
      p_note: "2 units damaged",
      p_lines: [{ sale_line_item_id: lineItemId, quantity: 2 }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 20000 }],
      p_mark_sale_void: false,
    });

    expect(error).toBeNull();
    expect(data.totalPaisa).toBe(20000);
    expect(data.returnNumber).toMatch(/^RET-\d{8}-\d{5}$/);

    const { data: stockAfterReturn } = await admin.from("products").select("current_stock").eq("id", productId).single();
    expect(stockAfterReturn?.current_stock).toBe(17);

    const { data: sale } = await admin.from("sales").select("status").eq("id", saleId).single();
    expect(sale?.status).toBe("completed");
  });

  it("rejects returning more than the remaining returnable quantity", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 20, tenant.ownerId);

    const { saleId, lineItemId } = await completedSale(shiftId, productId, 3, 10000);

    const { error: firstError } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "other",
      p_note: null,
      p_lines: [{ sale_line_item_id: lineItemId, quantity: 2 }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 20000 }],
      p_mark_sale_void: false,
    });
    expect(firstError).toBeNull();

    const { error: secondError } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "other",
      p_note: null,
      p_lines: [{ sale_line_item_id: lineItemId, quantity: 2 }], // only 1 remains
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 20000 }],
      p_mark_sale_void: false,
    });

    expect(secondError).not.toBeNull();
    expect(secondError?.message).toMatch(/only 1 remaining/i);
  });

  it("rejects a return whose refund payments do not sum to the return total", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 20, tenant.ownerId);

    const { saleId, lineItemId } = await completedSale(shiftId, productId, 2, 10000);

    const { error } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "other",
      p_note: null,
      p_lines: [{ sale_line_item_id: lineItemId, quantity: 1 }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 5000 }], // should be 10000
      p_mark_sale_void: false,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/do not sum to the return total/i);
  });

  it("rejects returning against a sale that isn't completed", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 20, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 10000 },
    ]);
    const { data: lineItem } = await admin.from("sale_line_items").select("id").eq("sale_id", saleId).single();

    const { error } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "other",
      p_note: null,
      p_lines: [{ sale_line_item_id: lineItem!.id, quantity: 1 }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 10000 }],
      p_mark_sale_void: false,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Can only return items from a completed sale/i);
  });

  it("void: fully reverses stock and payments, flips the sale to void", async () => {
    const shiftId = await openShift();
    const productA = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    const productB = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 25000 });
    await giveProductStock(admin, tenant.tenantId, productA, 20, tenant.ownerId);
    await giveProductStock(admin, tenant.tenantId, productB, 20, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId: productA, quantity: 4, unitPricePaisa: 10000 },
      { productId: productB, quantity: 2, unitPricePaisa: 25000 },
    ]);
    const total = 4 * 10000 + 2 * 25000;
    const { error: completeError } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: total }],
    });
    expect(completeError).toBeNull();

    const { data: stockAAfterSale } = await admin.from("products").select("current_stock").eq("id", productA).single();
    const { data: stockBAfterSale } = await admin.from("products").select("current_stock").eq("id", productB).single();
    expect(stockAAfterSale?.current_stock).toBe(16);
    expect(stockBAfterSale?.current_stock).toBe(18);

    const { data: lines } = await admin.from("sale_line_items").select("id, product_id, quantity").eq("sale_id", saleId);

    const { data, error } = await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "void",
      p_note: "cashier error",
      p_lines: (lines ?? []).map((l) => ({ sale_line_item_id: l.id, quantity: l.quantity })),
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: total }],
      p_mark_sale_void: true,
    });

    expect(error).toBeNull();
    expect(data.totalPaisa).toBe(total);

    const { data: stockAAfterVoid } = await admin.from("products").select("current_stock").eq("id", productA).single();
    const { data: stockBAfterVoid } = await admin.from("products").select("current_stock").eq("id", productB).single();
    expect(stockAAfterVoid?.current_stock).toBe(20);
    expect(stockBAfterVoid?.current_stock).toBe(20);

    const { data: sale } = await admin.from("sales").select("status, void_reason").eq("id", saleId).single();
    expect(sale?.status).toBe("void");
    expect(sale?.void_reason).toBe("void");
  });
});
