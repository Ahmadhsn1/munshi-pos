import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createTenantWithOwner,
  type TenantFixture,
} from "./helpers";

interface ImportResult {
  totalRows: number;
  productsCreated: number;
  openingStockRecorded: number;
  skipped: { row: number; message: string }[];
  errors: { row: number; message: string }[];
}

function buildRow(row: number, overrides: Record<string, unknown> = {}) {
  return {
    row,
    name_en: `Bulk Product ${row}`,
    name_ur: null,
    category_name: null,
    brand: null,
    barcode: `BULK-${row}-${Date.now()}`,
    stock_unit_key: "piece",
    purchase_unit_key: null,
    purchase_to_stock_factor: null,
    sale_unit_key: null,
    sale_to_stock_factor: null,
    tax_rate_bps: 0,
    reorder_level: 5,
    opening_quantity: 10,
    unit_cost_paisa: 500,
    ...overrides,
  };
}

// Exercises the "1000+ rows without failure" requirement directly at the import_opening_stock
// RPC level (fast, deterministic) rather than driving a real multipart HTTP upload from Vitest --
// see ENGINEERING.md/the Phase 2 plan for why the HTTP wiring path is a manual QA item instead.
describe("import_opening_stock: 1000+ row batch", () => {
  const admin = createAdminClient();
  let tenant: TenantFixture;

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "bulk-import");
  }, 30000);

  afterAll(async () => {
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  it("imports 1000 rows without the batch failing", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => buildRow(i + 2));

    const { data, error } = await admin.rpc("import_opening_stock", {
      p_tenant_id: tenant.tenantId,
      p_created_by: tenant.ownerId,
      p_rows: rows,
    });

    expect(error).toBeNull();

    const result = data as ImportResult;
    expect(result.totalRows).toBe(1000);
    expect(result.productsCreated).toBe(1000);
    expect(result.openingStockRecorded).toBe(1000);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
  }, 30000);

  it("rolls back only the bad row when one row in a batch is invalid (per-row savepoint)", async () => {
    const rows = [
      buildRow(2),
      buildRow(3, { stock_unit_key: "this-unit-does-not-exist" }),
      buildRow(4),
    ];

    const { data, error } = await admin.rpc("import_opening_stock", {
      p_tenant_id: tenant.tenantId,
      p_created_by: tenant.ownerId,
      p_rows: rows,
    });

    expect(error).toBeNull();

    const result = data as ImportResult;
    expect(result.totalRows).toBe(3);
    expect(result.productsCreated).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].message).toMatch(/unknown stock unit/i);
  });

  it("re-uploading the same barcodes reports them as skipped, not double-counted", async () => {
    const barcode = `REUPLOAD-${Date.now()}`;
    const row = buildRow(2, { barcode });

    const first = await admin.rpc("import_opening_stock", {
      p_tenant_id: tenant.tenantId,
      p_created_by: tenant.ownerId,
      p_rows: [row],
    });
    const firstResult = first.data as ImportResult;
    expect(firstResult.productsCreated).toBe(1);
    expect(firstResult.openingStockRecorded).toBe(1);

    const second = await admin.rpc("import_opening_stock", {
      p_tenant_id: tenant.tenantId,
      p_created_by: tenant.ownerId,
      p_rows: [row],
    });
    const secondResult = second.data as ImportResult;
    expect(secondResult.productsCreated).toBe(0);
    expect(secondResult.openingStockRecorded).toBe(0);
    expect(secondResult.skipped).toHaveLength(1);
  });

  it("creates a product with zero opening stock without inserting a no-op ledger row", async () => {
    const row = buildRow(2, { opening_quantity: 0 });

    const { data } = await admin.rpc("import_opening_stock", {
      p_tenant_id: tenant.tenantId,
      p_created_by: tenant.ownerId,
      p_rows: [row],
    });

    const result = data as ImportResult;
    expect(result.productsCreated).toBe(1);
    expect(result.openingStockRecorded).toBe(0);
  });
});
