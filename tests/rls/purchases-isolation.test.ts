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
  signIn,
  type TenantFixture,
} from "./helpers";

describe("purchases/suppliers cross-tenant isolation", () => {
  const admin = createAdminClient();
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let clientA: SupabaseClient;

  let supplierB: string;
  let productB: string;
  let purchaseB: string;
  let lineItemB: string;
  let receiptB: string;
  let receiptLineItemB: string;
  let purchaseReturnB: string;
  let purchaseReturnLineItemB: string;
  let paymentB: string;

  beforeAll(async () => {
    tenantA = await createTenantWithOwner(admin, "purch-a");
    tenantB = await createTenantWithOwner(admin, "purch-b");
    clientA = await signIn(tenantA.ownerEmail, tenantA.ownerPassword);

    const stockUnitB = await getUnitIdByKey(admin, tenantB.tenantId, "piece");
    productB = await createTestProduct(admin, tenantB.tenantId, stockUnitB);
    supplierB = await createSupplier(admin, tenantB.tenantId);

    const draft = await createDraftPurchase(admin, tenantB.tenantId, supplierB, tenantB.ownerId, [
      { productId: productB, quantity: 10, unitCostPaisa: 5000 },
    ]);
    purchaseB = draft.purchaseId;
    lineItemB = draft.lineItemIds[0];

    const { data: confirmResult, error: confirmError } = await admin.rpc("confirm_purchase", {
      p_tenant_id: tenantB.tenantId,
      p_purchase_id: purchaseB,
    });
    if (confirmError) throw confirmError;
    void confirmResult;

    const { data: receiveResult, error: receiveError } = await admin.rpc("record_goods_receipt", {
      p_tenant_id: tenantB.tenantId,
      p_purchase_id: purchaseB,
      p_received_by: tenantB.ownerId,
      p_note: null,
      p_lines: [{ purchase_line_item_id: lineItemB, quantity_received_purchase_units: 10 }],
    });
    if (receiveError) throw receiveError;

    const { data: receipt } = await admin
      .from("purchase_receipts")
      .select("id")
      .eq("purchase_id", purchaseB)
      .single();
    receiptB = receipt!.id;

    const { data: receiptLine } = await admin
      .from("purchase_receipt_line_items")
      .select("id")
      .eq("purchase_receipt_id", receiptB)
      .single();
    receiptLineItemB = receiptLine!.id;

    const { data: returnResult, error: returnError } = await admin.rpc("record_purchase_return", {
      p_tenant_id: tenantB.tenantId,
      p_purchase_id: purchaseB,
      p_reason_code: "damaged",
      p_note: null,
      p_created_by: tenantB.ownerId,
      p_lines: [{ purchase_line_item_id: lineItemB, quantity: 2 }],
    });
    if (returnError) throw returnError;
    purchaseReturnB = returnResult.purchaseReturnId;

    const { data: returnLine } = await admin
      .from("purchase_return_line_items")
      .select("id")
      .eq("purchase_return_id", purchaseReturnB)
      .single();
    purchaseReturnLineItemB = returnLine!.id;

    const { data: payment } = await admin
      .from("purchase_payments")
      .insert({
        tenant_id: tenantB.tenantId,
        purchase_id: purchaseB,
        payment_mode: "cash",
        amount_paisa: 10000,
        created_by: tenantB.ownerId,
      })
      .select("id")
      .single();
    paymentB = payment!.id;

    void receiveResult;
  });

  afterAll(async () => {
    await cleanupUser(admin, tenantA.ownerId);
    await cleanupUser(admin, tenantB.ownerId);
    await cleanupTenant(admin, tenantA.tenantId);
    await cleanupTenant(admin, tenantB.tenantId);
  });

  it("cannot see another tenant's suppliers", async () => {
    const { data, error } = await clientA.from("suppliers").select("id").eq("id", supplierB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchases", async () => {
    const { data, error } = await clientA.from("purchases").select("id").eq("id", purchaseB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchase_line_items", async () => {
    const { data, error } = await clientA.from("purchase_line_items").select("id").eq("id", lineItemB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchase_receipts", async () => {
    const { data, error } = await clientA.from("purchase_receipts").select("id").eq("id", receiptB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchase_receipt_line_items", async () => {
    const { data, error } = await clientA
      .from("purchase_receipt_line_items")
      .select("id")
      .eq("id", receiptLineItemB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchase_returns", async () => {
    const { data, error } = await clientA.from("purchase_returns").select("id").eq("id", purchaseReturnB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchase_return_line_items", async () => {
    const { data, error } = await clientA
      .from("purchase_return_line_items")
      .select("id")
      .eq("id", purchaseReturnLineItemB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's purchase_payments", async () => {
    const { data, error } = await clientA.from("purchase_payments").select("id").eq("id", paymentB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("rejects a purchase_line_items insert with a cross-tenant product", async () => {
    const supplierA = await createSupplier(admin, tenantA.tenantId);
    const { data: purchaseA } = await admin
      .from("purchases")
      .insert({ tenant_id: tenantA.tenantId, supplier_id: supplierA, created_by: tenantA.ownerId })
      .select("id")
      .single();

    const { error } = await admin.from("purchase_line_items").insert({
      tenant_id: tenantA.tenantId,
      purchase_id: purchaseA!.id,
      product_id: productB, // belongs to tenant B
      quantity: 1,
      unit_cost_paisa: 100,
      line_total_paisa: 100,
    });

    expect(error).not.toBeNull();
  });

  it("a free-goods line requires zero unit cost and zero discount", async () => {
    const stockUnitA = await getUnitIdByKey(admin, tenantA.tenantId, "piece");
    const productA = await createTestProduct(admin, tenantA.tenantId, stockUnitA);
    const supplierA = await createSupplier(admin, tenantA.tenantId);

    const { error } = await admin.from("purchase_line_items").insert({
      tenant_id: tenantA.tenantId,
      purchase_id: (
        await admin
          .from("purchases")
          .insert({ tenant_id: tenantA.tenantId, supplier_id: supplierA, created_by: tenantA.ownerId })
          .select("id")
          .single()
      ).data!.id,
      product_id: productA,
      quantity: 1,
      unit_cost_paisa: 500, // should be 0 for free goods
      is_free_goods: true,
      line_total_paisa: 500,
    });

    expect(error).not.toBeNull();
  });
});
