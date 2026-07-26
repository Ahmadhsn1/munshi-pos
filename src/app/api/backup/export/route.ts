import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { businessToday } from "@/lib/reports";

export const runtime = "nodejs";

// Every tenant-scoped table (see tests/rls/rls-enabled.test.ts, which is the canonical list this
// mirrors -- add a new table there AND here). `users` is deliberately excluded: it carries
// pin_hash/pin_salt, which are additionally locked down with column-level REVOKE/GRANT (see
// AGENTS.md) specifically so no authenticated client can ever read them -- a backup export must
// not become the one path that defeats that. A shopkeeper's actual backup need (products,
// customers, sales, purchases, the full khata/ledger history) has nothing to do with staff
// credentials anyway.
const TENANT_SCOPED_TABLES = [
  "units",
  "categories",
  "products",
  "product_barcodes",
  "stock_ledger",
  "customers",
  "customer_payments",
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
  "expense_categories",
  "expenses",
  "audit_log",
] as const;

/**
 * Full per-tenant data backup (plan.md: "Backup: manual export all my data button per tenant").
 * Owner-only -- this is the single most complete export the app can produce (every ledger, every
 * cost figure, the full audit trail in one file), which is a strictly higher trust bar than any
 * individual report's `reports.view`.
 *
 * A single JSON file rather than a multi-file ZIP: this repo has no zip dependency today, and one
 * JSON document keyed by table name is both simpler to produce correctly and directly
 * re-importable by a script later, which is the actual point of a "get my data out" backup.
 */
export async function GET() {
  const context = await getActingUserContext();

  if (!context || context.roleKey !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const backup: Record<string, unknown[]> = {};

  for (const table of TENANT_SCOPED_TABLES) {
    const { data, error } = await admin.from(table).select("*").eq("tenant_id", context.tenantId);

    if (error) {
      return NextResponse.json(
        { error: `Failed to export ${table}: ${error.message}` },
        { status: 500 },
      );
    }

    backup[table] = data ?? [];
  }

  // The tenant's own profile row (shop name, slug, trial dates) is keyed by `id`, not `tenant_id`
  // -- outside the generic loop above on purpose, not an oversight.
  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .select("*")
    .eq("id", context.tenantId)
    .single();

  if (tenantError) {
    return NextResponse.json({ error: `Failed to export tenant profile: ${tenantError.message}` }, { status: 500 });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    tenantId: context.tenantId,
    tenantName: context.tenantName,
    tenant: tenantRow,
    tables: backup,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="backup-${context.tenantName.replace(/[^a-zA-Z0-9]+/g, "-")}-${businessToday()}.json"`,
    },
  });
}
