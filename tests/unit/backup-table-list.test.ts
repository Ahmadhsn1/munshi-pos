import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the full-data backup export (/api/backup/export, plan.md Phase 7: "export all my data")
 * against silently missing a table.
 *
 * Its TENANT_SCOPED_TABLES list is maintained BY HAND, separately from
 * tests/rls/rls-enabled.test.ts's own canonical list -- and manually diffing the two while writing
 * the backup route found two real gaps (sale_number_counters and tenants were both missing) on the
 * very first attempt. A shopkeeper's "export everything" button quietly leaving out a table is
 * exactly the kind of failure that erodes the trust this feature exists to build, and it would
 * never be caught by tsc/lint/build/tests -- only by this list staying in sync.
 *
 * `tenants` and `users` are deliberately excluded from the backup's per-tenant-table loop (tenants
 * is fetched separately since it's keyed by `id` not `tenant_id`; users is excluded so the backup
 * can never become a path around the pin_hash/pin_salt column lockdown) -- both are asserted here
 * too, so removing either exclusion by accident is caught.
 */
describe("backup export table list stays in sync with the canonical RLS table list", () => {
  const rlsTestSource = readFileSync(
    join(process.cwd(), "tests", "rls", "rls-enabled.test.ts"),
    "utf8",
  );
  const backupRouteSource = readFileSync(
    join(process.cwd(), "src", "app", "api", "backup", "export", "route.ts"),
    "utf8",
  );

  function extractTableArray(source: string, arrayName: string): string[] {
    // Matches up to the array's own closing `]`, not just the next `];` anywhere in the file --
    // the backup route's array is `[...] as const;`, not `[...];`, so a regex ending on `\];`
    // would run straight past the real closing bracket and keep matching into unrelated code
    // further down the file (caught live: it picked up "owner" and "tenant_id" from a later
    // string literal and a later .eq() call before this was fixed).
    const match = source.match(new RegExp(`${arrayName}[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\]`));
    if (!match) throw new Error(`Could not find ${arrayName} in source`);
    return [...match[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  }

  const rlsTables = new Set(extractTableArray(rlsTestSource, "TENANT_SCOPED_TABLES"));
  const backupTables = new Set(extractTableArray(backupRouteSource, "TENANT_SCOPED_TABLES"));

  // Present in RLS's list but deliberately not looped over generically in the backup route.
  const DELIBERATELY_EXCLUDED = new Set(["tenants", "users"]);

  it("finds both table lists (guards against the regex silently matching nothing)", () => {
    expect(rlsTables.size).toBeGreaterThan(15);
    expect(backupTables.size).toBeGreaterThan(15);
  });

  it("every RLS-covered tenant table is either backed up or deliberately excluded", () => {
    const missing = [...rlsTables].filter((t) => !backupTables.has(t) && !DELIBERATELY_EXCLUDED.has(t));
    expect(missing, "these tables are in the RLS list but missing from the backup export").toEqual([]);
  });

  it("the backup route does not export a table that isn't even tenant-scoped/RLS-checked", () => {
    // A table backed up but absent from the RLS list would mean either the RLS test forgot it
    // (its own job to catch) or the backup route is exporting something non-tenant-scoped, which
    // deserves a second look before assuming it's fine.
    const unexpected = [...backupTables].filter((t) => !rlsTables.has(t));
    expect(unexpected, "these backup tables are not in the canonical RLS-scoped table list").toEqual([]);
  });

  it("tenants and users remain deliberately excluded, not silently dropped or silently added back in", () => {
    for (const table of DELIBERATELY_EXCLUDED) {
      expect(backupTables.has(table), `${table} should not be in the generic per-tenant loop`).toBe(false);
    }
  });
});
