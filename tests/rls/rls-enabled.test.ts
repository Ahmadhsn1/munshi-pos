import { describe, expect, it } from "vitest";
import { createAdminClient } from "./helpers";

// Formalizes what was previously only checked ad hoc via the Supabase security advisor
// (get_advisors) -- a migration that creates a tenant-scoped table and forgets
// `ENABLE ROW LEVEL SECURITY` should fail a test, not wait for a manual advisor run.
const TENANT_SCOPED_TABLES = [
  "tenants",
  "users",
  "units",
  "categories",
  "products",
  "product_barcodes",
  "stock_ledger",
  "customers",
  "shifts",
  "sale_number_counters",
  "sales",
  "sale_line_items",
  "sale_payments",
  "sale_returns",
  "sale_return_line_items",
  "sale_return_payments",
  "suppliers",
  "purchases",
  "purchase_line_items",
  "purchase_receipts",
  "purchase_receipt_line_items",
  "purchase_returns",
  "purchase_return_line_items",
  "purchase_payments",
  "customer_payments",
];

describe("row level security is enabled on every tenant-scoped table", () => {
  it("reports rls_enabled = true for all tenant-scoped tables", async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rls_enabled", {
      p_table_names: TENANT_SCOPED_TABLES,
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(TENANT_SCOPED_TABLES.length);

    for (const row of data as { table_name: string; rls_enabled: boolean }[]) {
      expect(row.rls_enabled, `${row.table_name} should have RLS enabled`).toBe(true);
    }
  });
});
