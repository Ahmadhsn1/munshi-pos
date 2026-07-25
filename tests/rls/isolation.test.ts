import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createTenantWithOwner,
  signIn,
  type TenantFixture,
} from "./helpers";

// Runs against the real Supabase project configured in .env.local, not a mock -- this is what
// makes "the isolation test must not fail" a meaningful guarantee rather than a tautology.
describe("cross-tenant isolation", () => {
  const admin = createAdminClient();
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    tenantA = await createTenantWithOwner(admin, "a");
    tenantB = await createTenantWithOwner(admin, "b");
    clientA = await signIn(tenantA.ownerEmail, tenantA.ownerPassword);
  });

  afterAll(async () => {
    await cleanupUser(admin, tenantA.ownerId);
    await cleanupUser(admin, tenantB.ownerId);
    await cleanupTenant(admin, tenantA.tenantId);
    await cleanupTenant(admin, tenantB.tenantId);
  });

  it("cannot see another tenant's row in `tenants`", async () => {
    const { data, error } = await clientA.from("tenants").select("*").eq("id", tenantB.tenantId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot see another tenant's row in `users`", async () => {
    // Selecting only the columns granted to `authenticated` (see
    // 20260725000009_column_privileges.sql) -- `select("*")` would hit pin_hash/pin_salt, which
    // aren't granted at all, and fail with a column-permission error before RLS even gets a
    // chance to filter rows. That's the intended behavior for the app; this test mirrors it.
    const { data, error } = await clientA
      .from("users")
      .select("id, full_name, tenant_id")
      .eq("id", tenantB.ownerId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("CAN see its own tenant and user rows (guards against a trivially-passing broken query)", async () => {
    const [tenantResult, userResult] = await Promise.all([
      clientA.from("tenants").select("id, name").eq("id", tenantA.tenantId),
      clientA.from("users").select("id, full_name").eq("id", tenantA.ownerId),
    ]);

    expect(tenantResult.error).toBeNull();
    expect(tenantResult.data).toHaveLength(1);
    expect(tenantResult.data?.[0].id).toBe(tenantA.tenantId);

    expect(userResult.error).toBeNull();
    expect(userResult.data).toHaveLength(1);
    expect(userResult.data?.[0].id).toBe(tenantA.ownerId);
  });

  it("an unfiltered select on `tenants`/`users` never returns another tenant's rows", async () => {
    const [tenantsResult, usersResult] = await Promise.all([
      clientA.from("tenants").select("id"),
      clientA.from("users").select("id"),
    ]);

    expect(tenantsResult.data?.every((row) => row.id === tenantA.tenantId)).toBe(true);
    expect(usersResult.data?.every((row) => row.id === tenantA.ownerId)).toBe(true);
  });

  it("cannot update another tenant's user row (0 rows affected, no error)", async () => {
    const { data, error } = await clientA
      .from("users")
      .update({ full_name: "Hacked via cross-tenant update" })
      .eq("id", tenantB.ownerId)
      .select("id, full_name");

    // RLS makes the target row invisible to the UPDATE's own USING clause, so this affects zero
    // rows rather than erroring -- both are correct here, but zero-rows-affected is what actually
    // matters for isolation.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: unchanged } = await admin
      .from("users")
      .select("full_name")
      .eq("id", tenantB.ownerId)
      .single();

    expect(unchanged?.full_name).toBe("Owner b");
  });

  it("roles/permissions catalog is visible identically regardless of tenant", async () => {
    const clientB = await signIn(tenantB.ownerEmail, tenantB.ownerPassword);

    const [rolesA, rolesB] = await Promise.all([
      clientA.from("roles").select("key").order("key"),
      clientB.from("roles").select("key").order("key"),
    ]);

    expect(rolesA.error).toBeNull();
    expect(rolesB.error).toBeNull();
    expect(rolesA.data).toEqual(rolesB.data);
    expect(rolesA.data?.map((r) => r.key)).toEqual(["cashier", "manager", "owner"]);
  });
});
