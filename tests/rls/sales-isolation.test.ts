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
  signIn,
  type TenantFixture,
} from "./helpers";

describe("POS (sales/shifts/customers/returns) cross-tenant isolation", () => {
  const admin = createAdminClient();
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let clientA: SupabaseClient;

  let customerB: string;
  let shiftB: string;
  let productB: string;
  let saleB: string;
  let saleLineItemB: string;
  let salePaymentB: string;
  let saleReturnB: string;
  let saleReturnLineItemB: string;
  let saleReturnPaymentB: string;

  beforeAll(async () => {
    tenantA = await createTenantWithOwner(admin, "pos-a");
    tenantB = await createTenantWithOwner(admin, "pos-b");
    clientA = await signIn(tenantA.ownerEmail, tenantA.ownerPassword);

    const stockUnitB = await getUnitIdByKey(admin, tenantB.tenantId, "piece");
    productB = await createTestProduct(admin, tenantB.tenantId, stockUnitB, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenantB.tenantId, productB, 50, tenantB.ownerId);

    customerB = await createTestCustomer(admin, tenantB.tenantId);
    shiftB = await createOpenShift(admin, tenantB.tenantId, tenantB.ownerId, tenantB.ownerId, 5000_00);

    saleB = await createOpenSale(
      admin,
      tenantB.tenantId,
      shiftB,
      tenantB.ownerId,
      tenantB.ownerId,
      [{ productId: productB, quantity: 2, unitPricePaisa: 10000 }],
      customerB,
    );

    const { data: line } = await admin
      .from("sale_line_items")
      .select("id")
      .eq("sale_id", saleB)
      .single();
    saleLineItemB = line!.id;

    const { data: payment } = await admin
      .from("sale_payments")
      .insert({ tenant_id: tenantB.tenantId, sale_id: saleB, payment_mode: "cash", amount_paisa: 20000 })
      .select("id")
      .single();
    salePaymentB = payment!.id;

    // Sale must be completed for a return to reference it meaningfully, but the isolation test
    // only cares that RLS hides the rows -- flip status directly rather than going through the RPC.
    await admin.from("sales").update({ status: "completed", completed_at: new Date(0).toISOString() }).eq("id", saleB);

    const { data: saleReturn } = await admin
      .from("sale_returns")
      .insert({
        tenant_id: tenantB.tenantId,
        sale_id: saleB,
        shift_id: shiftB,
        cashier_user_id: tenantB.ownerId,
        session_user_id: tenantB.ownerId,
        reason_code: "other",
        subtotal_paisa: 10000,
        total_paisa: 10000,
      })
      .select("id")
      .single();
    saleReturnB = saleReturn!.id;

    const { data: returnLine } = await admin
      .from("sale_return_line_items")
      .insert({
        tenant_id: tenantB.tenantId,
        sale_return_id: saleReturnB,
        sale_line_item_id: saleLineItemB,
        product_id: productB,
        quantity: 1,
        unit_price_paisa: 10000,
        line_total_paisa: 10000,
      })
      .select("id")
      .single();
    saleReturnLineItemB = returnLine!.id;

    const { data: returnPayment } = await admin
      .from("sale_return_payments")
      .insert({ tenant_id: tenantB.tenantId, sale_return_id: saleReturnB, payment_mode: "cash", amount_paisa: 10000 })
      .select("id")
      .single();
    saleReturnPaymentB = returnPayment!.id;
  });

  afterAll(async () => {
    await cleanupUser(admin, tenantA.ownerId);
    await cleanupUser(admin, tenantB.ownerId);
    await cleanupTenant(admin, tenantA.tenantId);
    await cleanupTenant(admin, tenantB.tenantId);
  });

  it("cannot see another tenant's customers", async () => {
    const { data, error } = await clientA.from("customers").select("id").eq("id", customerB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's shifts", async () => {
    const { data, error } = await clientA.from("shifts").select("id").eq("id", shiftB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sale_number_counters", async () => {
    const { data, error } = await clientA
      .from("sale_number_counters")
      .select("tenant_id")
      .eq("tenant_id", tenantB.tenantId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sales", async () => {
    const { data, error } = await clientA.from("sales").select("id").eq("id", saleB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sale_line_items", async () => {
    const { data, error } = await clientA.from("sale_line_items").select("id").eq("id", saleLineItemB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sale_payments", async () => {
    const { data, error } = await clientA.from("sale_payments").select("id").eq("id", salePaymentB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sale_returns", async () => {
    const { data, error } = await clientA.from("sale_returns").select("id").eq("id", saleReturnB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sale_return_line_items", async () => {
    const { data, error } = await clientA
      .from("sale_return_line_items")
      .select("id")
      .eq("id", saleReturnLineItemB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's sale_return_payments", async () => {
    const { data, error } = await clientA
      .from("sale_return_payments")
      .select("id")
      .eq("id", saleReturnPaymentB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("rejects a customer phone that collides with another tenant's -- guards uniqueness is per-tenant not global (control: should succeed)", async () => {
    const sharedPhone = `0300${Date.now().toString().slice(-7)}`;
    const { error: errorA } = await admin
      .from("customers")
      .insert({ tenant_id: tenantA.tenantId, name: "Shared Phone A", phone: sharedPhone });
    const { error: errorB } = await admin
      .from("customers")
      .insert({ tenant_id: tenantB.tenantId, name: "Shared Phone B", phone: sharedPhone });

    expect(errorA).toBeNull();
    expect(errorB).toBeNull();
  });

  it("enforces only one open shift per cashier", async () => {
    const openedShiftId = await createOpenShift(admin, tenantA.tenantId, tenantA.ownerId, tenantA.ownerId);

    const { error: second } = await admin
      .from("shifts")
      .insert({
        tenant_id: tenantA.tenantId,
        cashier_user_id: tenantA.ownerId,
        session_user_id: tenantA.ownerId,
        opening_cash_paisa: 0,
        created_by: tenantA.ownerId,
      });

    expect(second).not.toBeNull();

    await admin.from("shifts").update({ status: "closed", closed_at: new Date(0).toISOString() }).eq("id", openedShiftId);
  });

  it("rejects a khata sale_payment when the sale has no customer", async () => {
    const stockUnitA = await getUnitIdByKey(admin, tenantA.tenantId, "piece");
    const productA = await createTestProduct(admin, tenantA.tenantId, stockUnitA, { sale_price_paisa: 5000 });
    await giveProductStock(admin, tenantA.tenantId, productA, 10, tenantA.ownerId);
    const shiftId = await createOpenShift(admin, tenantA.tenantId, tenantA.ownerId, tenantA.ownerId);
    const saleNoCustomer = await createOpenSale(
      admin,
      tenantA.tenantId,
      shiftId,
      tenantA.ownerId,
      tenantA.ownerId,
      [{ productId: productA, quantity: 1, unitPricePaisa: 5000 }],
      null,
    );

    const { error } = await admin
      .from("sale_payments")
      .insert({ tenant_id: tenantA.tenantId, sale_id: saleNoCustomer, payment_mode: "khata", amount_paisa: 5000 });

    expect(error).not.toBeNull();

    await admin.from("shifts").update({ status: "closed", closed_at: new Date(0).toISOString() }).eq("id", shiftId);
  });
});
