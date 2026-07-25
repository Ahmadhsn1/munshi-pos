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

// The real correctness suite for the costing engine (plan.md: "unit tested -- highest-risk logic
// in the whole app"). Calls the actual record_goods_receipt/confirm_purchase RPCs and asserts on
// products.avg_cost_paisa afterward -- a pure-TS reimplementation of the math would not have
// caught the unit-mismatch or division-truncation bugs found during design review.
describe("record_goods_receipt: weighted-average costing engine", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;
  let supplierId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "purch-costing");
    stockUnitId = await getUnitIdByKey(admin, tenant.tenantId, "piece");
    supplierId = await createSupplier(admin, tenant.tenantId);
  });

  afterAll(async () => {
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  async function confirmAndReceive(
    productId: string,
    lines: { quantity: number; unitCostPaisa: number; discountPaisa?: number; isFreeGoods?: boolean }[],
    receiveEach = true,
  ) {
    const draft = await createDraftPurchase(
      admin,
      tenant.tenantId,
      supplierId,
      tenant.ownerId,
      lines.map((l) => ({ productId, quantity: l.quantity, unitCostPaisa: l.unitCostPaisa, discountPaisa: l.discountPaisa, isFreeGoods: l.isFreeGoods })),
    );

    const { error: confirmError } = await admin.rpc("confirm_purchase", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
    });
    if (confirmError) throw confirmError;

    if (receiveEach) {
      for (let i = 0; i < draft.lineItemIds.length; i++) {
        const { error } = await admin.rpc("record_goods_receipt", {
          p_tenant_id: tenant.tenantId,
          p_purchase_id: draft.purchaseId,
          p_received_by: tenant.ownerId,
          p_note: null,
          p_lines: [{ purchase_line_item_id: draft.lineItemIds[i], quantity_received_purchase_units: lines[i].quantity }],
        });
        if (error) throw error;
      }
    }

    return draft;
  }

  it("first purchase into empty stock: average equals the unit cost", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await confirmAndReceive(productId, [{ quantity: 10, unitCostPaisa: 2000 }]);

    const { data: product } = await admin.from("products").select("avg_cost_paisa, current_stock").eq("id", productId).single();
    expect(product?.avg_cost_paisa).toBe(2000);
    expect(product?.current_stock).toBe(10);
  });

  it("second purchase at a different rate converges to the correct weighted average", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await confirmAndReceive(productId, [{ quantity: 10, unitCostPaisa: 2000 }]);
    await confirmAndReceive(productId, [{ quantity: 10, unitCostPaisa: 3000 }]);

    // (10*2000 + 10*3000) / 20 = 50000/20 = 2500
    const { data: product } = await admin.from("products").select("avg_cost_paisa, current_stock").eq("id", productId).single();
    expect(product?.avg_cost_paisa).toBe(2500);
    expect(product?.current_stock).toBe(20);
  });

  it("a free-goods receipt dilutes the average correctly", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    await confirmAndReceive(productId, [{ quantity: 10, unitCostPaisa: 2000 }]);
    await confirmAndReceive(productId, [{ quantity: 10, unitCostPaisa: 0, isFreeGoods: true }]);

    // (10*2000 + 0) / 20 = 1000
    const { data: product } = await admin.from("products").select("avg_cost_paisa, current_stock").eq("id", productId).single();
    expect(product?.avg_cost_paisa).toBe(1000);
    expect(product?.current_stock).toBe(20);
  });

  it("uses the net (discounted) cost, not the gross unit cost", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    // 5 units @ 1000 paisa gross = 5000, discount 500 -> net 4500 -> 900/unit
    await confirmAndReceive(productId, [{ quantity: 5, unitCostPaisa: 1000, discountPaisa: 500 }]);

    const { data: product } = await admin.from("products").select("avg_cost_paisa").eq("id", productId).single();
    expect(product?.avg_cost_paisa).toBe(900);
  });

  it("partial receipt across 2 separate events accumulates the correct average and stock", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await createDraftPurchase(admin, tenant.tenantId, supplierId, tenant.ownerId, [
      { productId, quantity: 20, unitCostPaisa: 1000 },
    ]);
    await admin.rpc("confirm_purchase", { p_tenant_id: tenant.tenantId, p_purchase_id: draft.purchaseId });

    // Receive 12 of 20 first
    const { error: firstError } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: "first delivery",
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 12 }],
    });
    expect(firstError).toBeNull();

    let { data: product } = await admin.from("products").select("current_stock, avg_cost_paisa").eq("id", productId).single();
    expect(product?.current_stock).toBe(12);
    expect(product?.avg_cost_paisa).toBe(1000);

    const { data: purchaseAfterFirst } = await admin.from("purchases").select("status").eq("id", draft.purchaseId).single();
    expect(purchaseAfterFirst?.status).toBe("partially_received");

    // Receive the remaining 8
    const { error: secondError } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: "second delivery",
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 8 }],
    });
    expect(secondError).toBeNull();

    ({ data: product } = await admin.from("products").select("current_stock, avg_cost_paisa").eq("id", productId).single());
    expect(product?.current_stock).toBe(20);
    expect(product?.avg_cost_paisa).toBe(1000);

    const { data: purchaseAfterSecond } = await admin.from("purchases").select("status").eq("id", draft.purchaseId).single();
    expect(purchaseAfterSecond?.status).toBe("received");
  });

  it("rejects receiving more than the remaining invoiced quantity", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await createDraftPurchase(admin, tenant.tenantId, supplierId, tenant.ownerId, [
      { productId, quantity: 5, unitCostPaisa: 1000 },
    ]);
    await admin.rpc("confirm_purchase", { p_tenant_id: tenant.tenantId, p_purchase_id: draft.purchaseId });

    const { error } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 6 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only \d+ remaining/i);
  });

  it("rejects receiving against a draft (unconfirmed) purchase", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await createDraftPurchase(admin, tenant.tenantId, supplierId, tenant.ownerId, [
      { productId, quantity: 5, unitCostPaisa: 1000 },
    ]);

    const { error } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 5 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not receivable/i);
  });

  it("correctly converts purchase units to stock units when purchase_to_stock_factor <> 1", async () => {
    // Cartons of 20 pieces each -- this is exactly the unit-mismatch bug class caught in review:
    // comparing purchase-unit quantities directly against a stock-unit-denominated sum silently
    // breaks for any product with a non-1 factor.
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, {
      purchase_to_stock_factor: 20,
    });

    const draft = await createDraftPurchase(admin, tenant.tenantId, supplierId, tenant.ownerId, [
      { productId, quantity: 3, unitCostPaisa: 40000 }, // 3 cartons @ Rs 400/carton
    ]);
    await admin.rpc("confirm_purchase", { p_tenant_id: tenant.tenantId, p_purchase_id: draft.purchaseId });

    // Receive 2 of 3 cartons first (40 stock units) -- should succeed and leave 1 carton (20 units) remaining.
    const { error: firstError } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 2 }],
    });
    expect(firstError).toBeNull();

    const { data: productAfterFirst } = await admin
      .from("products")
      .select("current_stock, avg_cost_paisa")
      .eq("id", productId)
      .single();
    expect(productAfterFirst?.current_stock).toBe(40); // 2 cartons * 20 = 40 pieces
    expect(productAfterFirst?.avg_cost_paisa).toBe(2000); // Rs 400/carton / 20 pieces = Rs 20/piece = 2000 paisa

    // Attempting to receive the last carton (1 more) should succeed -- proves the remaining-qty
    // check correctly tracked 1 carton (20 stock units) still outstanding, not a negative/garbage
    // value from a unit mismatch.
    const { error: secondError } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 1 }],
    });
    expect(secondError).toBeNull();

    const { data: productAfterSecond } = await admin
      .from("products")
      .select("current_stock, avg_cost_paisa")
      .eq("id", productId)
      .single();
    expect(productAfterSecond?.current_stock).toBe(60); // 3 cartons * 20 = 60 pieces
    expect(productAfterSecond?.avg_cost_paisa).toBe(2000);

    // A further attempt to receive even 1 more carton must now fail -- nothing left to receive.
    const { error: overReceiveError } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenant.tenantId,
      p_purchase_id: draft.purchaseId,
      p_received_by: tenant.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: draft.lineItemIds[0], quantity_received_purchase_units: 1 }],
    });
    expect(overReceiveError).not.toBeNull();
  });

  it("stamps the net per-unit cost onto the stock_ledger row for audit", async () => {
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId);
    const draft = await confirmAndReceive(productId, [{ quantity: 4, unitCostPaisa: 2500 }]);

    const { data: ledgerRow } = await admin
      .from("stock_ledger")
      .select("unit_cost_paisa, quantity_delta, movement_type, purchase_id")
      .eq("product_id", productId)
      .eq("movement_type", "purchase")
      .single();

    expect(ledgerRow?.unit_cost_paisa).toBe(2500);
    expect(ledgerRow?.quantity_delta).toBe(4);
    expect(ledgerRow?.purchase_id).toBe(draft.purchaseId);
  });
});
