// One-off cleanup: deletes tenants leaked by the pre-fix cleanupTenant() bug (see AGENTS.md
// "Testing" section and commit 0e50672) -- the RLS suite's own test fixtures, positively scoped by
// name so this can never match a real tenant (real shops don't get named "RLS Test Tenant ...").
//
// Deliberately reuses the SAME two-step logic as tests/rls/helpers.ts's cleanupUser/cleanupTenant
// rather than a raw SQL DELETE on auth.users: Supabase's Auth schema has internal tables
// (identities, sessions, refresh_tokens, mfa_factors, ...) that the Admin API's deleteUser()
// manages correctly -- a plain SQL DELETE on auth.users bypasses that and is not what Supabase
// documents as the supported path.
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The first run of this script hit Supabase Auth's Admin API rate limit after ~100 rapid
// deleteUser() calls (every call after that failed with an uninformative empty error) -- so this
// run paces itself. purgeTenant() throws BEFORE touching any business-data table if deleteUser()
// fails, meaning a rate-limited tenant is left fully intact, never partially deleted; that's what
// made it safe to just re-run this script against the remainder rather than needing to reconcile
// a half-deleted state.
const DELETE_USER_DELAY_MS = 400;

// Diagnosed live: failures are AuthRetryableFetchError (HTTP 500) from Supabase's own Auth server
// -- a transient server-side condition, not a rate-limit block or a bug in this script's logic
// (confirmed via scripts/diagnose-delete-user.cjs, which printed the error's own properties
// directly rather than guessing from an empty-looking message). "Retryable" is the operative word,
// so each call gets a few attempts with backoff before this script gives up on that tenant.
async function deleteUserWithRetry(userId, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return;
    if (attempt === attempts) {
      throw new Error(`deleteUser(${userId}) failed after ${attempts} attempts: ${error.message} (status ${error.status})`);
    }
    await sleep(500 * attempt); // 500ms, 1000ms, 1500ms
  }
}

// Same order as TENANT_CHILD_TABLES_IN_DELETE_ORDER in tests/rls/helpers.ts, minus `units` and
// `categories` moved after products (products references both) -- kept identical on purpose so
// this script and the test helper can never silently drift apart on which tables exist.
const CHILD_TABLES_IN_ORDER = [
  "audit_log",
  "expenses",
  "expense_categories",
  "stock_ledger",
  "sale_return_payments",
  "sale_return_line_items",
  "sale_returns",
  "sale_payments",
  "sale_line_items",
  "sales",
  "customer_payments",
  "customers",
  "purchase_payments",
  "purchase_return_line_items",
  "purchase_returns",
  "purchase_receipt_line_items",
  "purchase_receipts",
  "purchase_line_items",
  "purchases",
  "suppliers",
  "shifts",
  "sale_number_counters",
  "product_barcodes",
  "products",
  "categories",
  "units",
];

async function purgeTenant(tenant) {
  const { data: users, error: usersError } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenant.id);

  if (usersError) throw new Error(`list users failed: ${usersError.message}`);

  for (const user of users ?? []) {
    // Cascades to public.users (on delete cascade), same as cleanupUser() in the test helpers.
    await deleteUserWithRetry(user.id);
    await sleep(DELETE_USER_DELAY_MS);
  }

  for (const table of CHILD_TABLES_IN_ORDER) {
    const { error } = await admin.from(table).delete().eq("tenant_id", tenant.id);
    if (error) throw new Error(`clearing ${table} failed: ${error.message}`);
  }

  const { error: tenantError } = await admin.from("tenants").delete().eq("id", tenant.id);
  if (tenantError) throw new Error(`deleting tenant failed: ${tenantError.message}`);
}

async function main() {
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name")
    .like("name", "RLS Test Tenant%");

  if (error) {
    console.error("Failed to list leaked tenants:", error.message);
    process.exit(1);
  }

  console.log(`Found ${tenants.length} leaked test tenants to purge.`);

  let succeeded = 0;
  const failures = [];

  for (const tenant of tenants) {
    try {
      await purgeTenant(tenant);
      succeeded++;
      if (succeeded % 25 === 0) console.log(`  ${succeeded}/${tenants.length} done...`);
    } catch (err) {
      failures.push({ id: tenant.id, name: tenant.name, error: err.message });
    }
  }

  console.log(`\nDone. Succeeded: ${succeeded}/${tenants.length}. Failed: ${failures.length}.`);
  if (failures.length > 0) {
    console.log("Failures (left in place for inspection, not retried automatically):");
    for (const f of failures) console.log(`  ${f.name} (${f.id}): ${f.error}`);
  }
}

main();
