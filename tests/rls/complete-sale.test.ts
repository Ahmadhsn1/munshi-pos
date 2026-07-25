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

describe("complete_sale RPC", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;
  const openShiftIds: string[] = [];

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "checkout");
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

  it("happy path: completes a sale, deducts stock, assigns an invoice number", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 15000 });
    await giveProductStock(admin, tenant.tenantId, productId, 20, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 3, unitPricePaisa: 15000 },
    ]);

    const { data, error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 45000 }],
    });

    expect(error).toBeNull();
    expect(data.totalPaisa).toBe(45000);
    expect(data.invoiceNumber).toMatch(/^\d{8}-\d{5}$/);

    const { data: product } = await admin.from("products").select("current_stock").eq("id", productId).single();
    expect(product?.current_stock).toBe(17);

    const { data: sale } = await admin.from("sales").select("status, total_paisa").eq("id", saleId).single();
    expect(sale?.status).toBe("completed");
    expect(sale?.total_paisa).toBe(45000);
  });

  it("rejects checkout when requested quantity exceeds current stock", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 2, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 5, unitPricePaisa: 10000 },
    ]);

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 50000 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Insufficient stock/i);

    const { data: product } = await admin.from("products").select("current_stock").eq("id", productId).single();
    expect(product?.current_stock).toBe(2);
  });

  it("exactly one of two racing checkouts wins the last unit of stock", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 1, tenant.ownerId);

    const saleA = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 10000 },
    ]);
    const saleB = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 10000 },
    ]);

    const complete = (saleId: string) =>
      admin.rpc("complete_sale", {
        p_tenant_id: tenant.tenantId,
        p_sale_id: saleId,
        p_bill_discount_paisa: 0,
        p_round_off_paisa: 0,
        p_payments: [{ payment_mode: "cash", amount_paisa: 10000 }],
      });

    const [resultA, resultB] = await Promise.all([complete(saleA), complete(saleB)]);
    const errors = [resultA.error, resultB.error];
    const successes = errors.filter((e) => e === null).length;
    const failures = errors.filter((e) => e !== null).length;

    expect(successes).toBe(1);
    expect(failures).toBe(1);

    const { data: product } = await admin.from("products").select("current_stock").eq("id", productId).single();
    expect(product?.current_stock).toBe(0);
  });

  it("rejects a khata payment when the sale has no customer (surfaced through the RPC)", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 5, tenant.ownerId);

    const saleId = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: 10000 }],
      null,
    );

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "khata", amount_paisa: 10000 }],
    });

    expect(error).not.toBeNull();
  });

  it("allows a khata payment when the sale has a customer", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 5, tenant.ownerId);
    const customerId = await createTestCustomer(admin, tenant.tenantId);

    const saleId = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: 10000 }],
      customerId,
    );

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "khata", amount_paisa: 10000 }],
    });

    expect(error).toBeNull();
  });

  it("rejects checkout when payments do not sum to the computed total", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 5, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 2, unitPricePaisa: 10000 },
    ]);

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 15000 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/do not sum to the total/i);
  });

  it("rejects a round-off outside the +/- Rs 5 server-side bound", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 5, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 10000 },
    ]);

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 501,
      p_payments: [{ payment_mode: "cash", amount_paisa: 10501 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Round-off out of the allowed range/i);
  });

  it("rejects a non-zero round-off mixed with a non-cash payment", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 5, tenant.ownerId);
    const customerId = await createTestCustomer(admin, tenant.tenantId);

    const saleId = await createOpenSale(
      admin,
      tenant.tenantId,
      shiftId,
      tenant.ownerId,
      tenant.ownerId,
      [{ productId, quantity: 1, unitPricePaisa: 10000 }],
      customerId,
    );

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 5,
      p_payments: [{ payment_mode: "khata", amount_paisa: 10005 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/fully-cash sale/i);
  });

  it("rejects completing a sale whose shift has already been closed", async () => {
    const shiftId = await openShift();
    const productId = await createTestProduct(admin, tenant.tenantId, stockUnitId, { sale_price_paisa: 10000 });
    await giveProductStock(admin, tenant.tenantId, productId, 5, tenant.ownerId);

    const saleId = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId, quantity: 1, unitPricePaisa: 10000 },
    ]);

    await admin.from("shifts").update({ status: "closed", closed_at: new Date(0).toISOString() }).eq("id", shiftId);

    const { error } = await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: saleId,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 10000 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Shift is not open/i);
  });
});
