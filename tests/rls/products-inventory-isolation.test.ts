import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createTenantWithOwner,
  createTestProduct,
  getUnitIdByKey,
  signIn,
  type TenantFixture,
} from "./helpers";

describe("products/inventory cross-tenant isolation", () => {
  const admin = createAdminClient();
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let clientA: SupabaseClient;
  let stockUnitA: string;
  let stockUnitB: string;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    tenantA = await createTenantWithOwner(admin, "inv-a");
    tenantB = await createTenantWithOwner(admin, "inv-b");
    clientA = await signIn(tenantA.ownerEmail, tenantA.ownerPassword);

    stockUnitA = await getUnitIdByKey(admin, tenantA.tenantId, "piece");
    stockUnitB = await getUnitIdByKey(admin, tenantB.tenantId, "piece");

    productA = await createTestProduct(admin, tenantA.tenantId, stockUnitA);
    productB = await createTestProduct(admin, tenantB.tenantId, stockUnitB);
  });

  afterAll(async () => {
    await cleanupUser(admin, tenantA.ownerId);
    await cleanupUser(admin, tenantB.ownerId);
    await cleanupTenant(admin, tenantA.tenantId);
    await cleanupTenant(admin, tenantB.tenantId);
  });

  it("cannot see another tenant's units", async () => {
    const { data, error } = await clientA.from("units").select("id").eq("tenant_id", tenantB.tenantId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's categories", async () => {
    const { data, error } = await clientA
      .from("categories")
      .select("id")
      .eq("tenant_id", tenantB.tenantId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's products", async () => {
    const { data, error } = await clientA.from("products").select("id").eq("id", productB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's stock_ledger entries", async () => {
    await admin.from("stock_ledger").insert({
      tenant_id: tenantB.tenantId,
      product_id: productB,
      movement_type: "opening_stock",
      quantity_delta: 50,
      created_by: tenantB.ownerId,
    });

    const { data, error } = await clientA.from("stock_ledger").select("id").eq("product_id", productB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("CAN see its own tenant's products (guards against a trivially-passing broken query)", async () => {
    const { data, error } = await clientA.from("products").select("id").eq("id", productA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("barcode uniqueness is per-tenant, not global -- two tenants can share a barcode", async () => {
    const sharedBarcode = `SHARED-${Date.now()}`;

    const { error: errorA } = await admin
      .from("product_barcodes")
      .insert({ tenant_id: tenantA.tenantId, product_id: productA, barcode: sharedBarcode });
    const { error: errorB } = await admin
      .from("product_barcodes")
      .insert({ tenant_id: tenantB.tenantId, product_id: productB, barcode: sharedBarcode });

    expect(errorA).toBeNull();
    expect(errorB).toBeNull();
  });

  it("barcode uniqueness IS enforced within a single tenant", async () => {
    const barcode = `DUP-${Date.now()}`;
    const otherProduct = await createTestProduct(admin, tenantA.tenantId, stockUnitA);

    const { error: first } = await admin
      .from("product_barcodes")
      .insert({ tenant_id: tenantA.tenantId, product_id: productA, barcode: `${barcode}-x` });
    const { error: second } = await admin
      .from("product_barcodes")
      .insert({ tenant_id: tenantA.tenantId, product_id: otherProduct, barcode: `${barcode}-x` });

    expect(first).toBeNull();
    expect(second).not.toBeNull();
  });

  it("caps category nesting at 2 levels", async () => {
    const { data: top } = await admin
      .from("categories")
      .insert({ tenant_id: tenantA.tenantId, name: `Top ${Date.now()}` })
      .select("id")
      .single();
    const { data: sub } = await admin
      .from("categories")
      .insert({ tenant_id: tenantA.tenantId, name: `Sub ${Date.now()}`, parent_category_id: top!.id })
      .select("id")
      .single();

    const { error } = await admin
      .from("categories")
      .insert({ tenant_id: tenantA.tenantId, name: `SubSub ${Date.now()}`, parent_category_id: sub!.id });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/2 levels deep/i);
  });

  it("rejects a cross-tenant category parent", async () => {
    const { data: parentB } = await admin
      .from("categories")
      .insert({ tenant_id: tenantB.tenantId, name: `ParentB ${Date.now()}` })
      .select("id")
      .single();

    const { error } = await admin
      .from("categories")
      .insert({ tenant_id: tenantA.tenantId, name: `ChildA ${Date.now()}`, parent_category_id: parentB!.id });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/same tenant/i);
  });

  it("enforces opening stock only once per product", async () => {
    const product = await createTestProduct(admin, tenantA.tenantId, stockUnitA);

    const { error: first } = await admin.from("stock_ledger").insert({
      tenant_id: tenantA.tenantId,
      product_id: product,
      movement_type: "opening_stock",
      quantity_delta: 10,
      created_by: tenantA.ownerId,
    });
    const { error: second } = await admin.from("stock_ledger").insert({
      tenant_id: tenantA.tenantId,
      product_id: product,
      movement_type: "opening_stock",
      quantity_delta: 5,
      created_by: tenantA.ownerId,
    });

    expect(first).toBeNull();
    expect(second).not.toBeNull();
  });

  it("maintains products.current_stock via the stock_ledger trigger", async () => {
    const product = await createTestProduct(admin, tenantA.tenantId, stockUnitA);

    await admin.from("stock_ledger").insert({
      tenant_id: tenantA.tenantId,
      product_id: product,
      movement_type: "opening_stock",
      quantity_delta: 100,
      created_by: tenantA.ownerId,
    });

    const { data: afterOpening } = await admin
      .from("products")
      .select("current_stock")
      .eq("id", product)
      .single();
    expect(afterOpening?.current_stock).toBe(100);

    await admin.from("stock_ledger").insert({
      tenant_id: tenantA.tenantId,
      product_id: product,
      movement_type: "adjustment",
      quantity_delta: -20,
      reason_code: "wastage",
      created_by: tenantA.ownerId,
    });

    const { data: afterAdjustment } = await admin
      .from("products")
      .select("current_stock")
      .eq("id", product)
      .single();
    expect(afterAdjustment?.current_stock).toBe(80);
  });

  it("rejects a stock_ledger adjustment without a reason_code", async () => {
    const product = await createTestProduct(admin, tenantA.tenantId, stockUnitA);

    const { error } = await admin.from("stock_ledger").insert({
      tenant_id: tenantA.tenantId,
      product_id: product,
      movement_type: "adjustment",
      quantity_delta: -5,
      created_by: tenantA.ownerId,
    });

    expect(error).not.toBeNull();
  });
});
