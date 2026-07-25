import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createDraftPurchase,
  createSupplier,
  createTenantWithOwner,
  createTestProduct,
  getUnitIdByKey,
  type TenantFixture,
} from "./helpers";

describe("record_purchase_return RPC", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;
  let supplierId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "purch-return");
    stockUnitId = await getUnitIdByKey(admin, tenant.tenantId, "piece");
    supplierId = await createSupplier(admin, tenant.tenantId);
  });

  afterAll(async () => {
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  async function receivedPurchase(productId: string, quantity: number, unitCostPaisa: number) {
    const draft = await createDraftPurchase(admin, tenant.tenantId, supplierId, tenant.ownerId, [
      { productId, quantity, unitCostPaisa },
    ]);
    await admin.rpc("confirm_purchase", { p_tenant_id: tenant.tenantId, p_purchase_id: draft.purchaseId });
    const { error } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: quantity }],
    });
    if (error) throw error;
    return draft;
  }

  it("partial return: reduces stock and leaves avg_cost_paisa completely unchanged", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await receivedPurchase(productId, 10, 2000);

    const { data: before } = await admin.from("products").select("current_stock, avg_cost_paisa").eq("id", productId).single();
    expect(before?.current_stock).toBe(10);
    expect(before?.avg_cost_paisa).toBe(2000);

    const { data, error } = await admin.rpc("record_purchase_return", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_reason_code: "damaged",
      p_note: "3 units damaged in transit",
      p_created_by: tenant.ownerId,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity: 3 }],
    });

    expect(error).toBeNull();
    expect(data.purchaseReturnId).toBeTruthy();

    const { data: after } = await admin.from("products").select("current_stock, avg_cost_paisa").eq("id", productId).single();
    expect(after?.current_stock).toBe(7);
    // The key assertion: average cost is mathematically required to stay unchanged by a return
    // (S*A - k*A = (S-k)*A) -- touching it here would be the bug, not a missing feature.
    expect(after?.avg_cost_paisa).toBe(2000);

    const { data: ledgerRow } = await admin
      .from("stock_ledger")
      .select("quantity_delta, movement_type, purchase_return_id")
      .eq("product_id", productId)
      .eq("movement_type", "purchase_return")
      .single();
    expect(ledgerRow?.quantity_delta).toBe(-3);
    expect(ledgerRow?.purchase_return_id).toBe(data.purchaseReturnId);
  });

  it("rejects returning more than was received (net of prior returns)", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await receivedPurchase(productId, 5, 1000);

    const { error: firstError } = await admin.rpc("record_purchase_return", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_reason_code: "other",
      p_note: null,
      p_created_by: tenant.ownerId,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity: 3 }],
    });
    expect(firstError).toBeNull();

    const { error: secondError } = await admin.rpc("record_purchase_return", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_reason_code: "other",
      p_note: null,
      p_created_by: tenant.ownerId,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity: 3 }], // only 2 remain returnable
    });

    expect(secondError).not.toBeNull();
    expect(secondError?.message).toMatch(/only \d+ remaining/i);
  });

  it("returns a friendly error (not a raw constraint violation) when stock was already depleted elsewhere", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await receivedPurchase(productId, 10, 1000);

    // Simulate the stock having been sold/consumed elsewhere -- current_stock is a single
    // cross-source aggregate with no per-batch tracking, so this purchase's own bookkeeping
    // (10 received, 0 returned) can pass while physical stock has already been depleted.
    const { error: adjustError } = await admin.from("stock_ledger").insert({
      tenant_id: tenant.tenantId,
      product_id: productId,
      movement_type: "adjustment",
      quantity_delta: -9,
      reason_code: "recount",
      created_by: tenant.ownerId,
    });
    expect(adjustError).toBeNull();

    const { data: stockNow } = await admin.from("products").select("current_stock").eq("id", productId).single();
    expect(stockNow?.current_stock).toBe(1);

    const { error } = await admin.rpc("record_purchase_return", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_reason_code: "other",
      p_note: null,
      p_created_by: tenant.ownerId,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity: 5 }], // this purchase says 5 is fine, but only 1 physically remains
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient stock/i);
  });

  it("rejects returning against a purchase that has never been received", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await createDraftPurchase(admin, tenant.tenantId, supplierId, tenant.ownerId, [
      { productId, quantity: 5, unitCostPaisa: 1000 },
    ]);
    await admin.rpc("confirm_purchase", { p_tenant_id: tenant.tenantId, p_purchase_id: draft.purchaseId });

    const { error } = await admin.rpc("record_purchase_return", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_reason_code: "other",
      p_note: null,
      p_created_by: tenant.ownerId,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity: 1 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/at least one receipt/i);
  });
});
