import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createCashier,
  createTenantWithOwner,
  signIn,
  type TenantFixture,
} from "./helpers";

describe("role-escalation trigger", () => {
  const admin = createAdminClient();
  let tenant: TenantFixture;
  let cashier: { userId: string; email: string; password: string };
  let cashierClient: SupabaseClient;
  let ownerRoleId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "esc");
    cashier = await createCashier(admin, tenant.tenantId, "esc");
    cashierClient = await signIn(cashier.email, cashier.password);

    const { data: ownerRole } = await admin.from("roles").select("id").eq("key", "owner").single();
    ownerRoleId = ownerRole!.id;
  });

  afterAll(async () => {
    await cleanupUser(admin, cashier.userId);
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  it("a user cannot change their own role_id", async () => {
    const { error } = await cashierClient
      .from("users")
      .update({ role_id: ownerRoleId })
      .eq("id", cashier.userId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot change your own role/i);

    const { data: unchanged } = await admin
      .from("users")
      .select("role_id")
      .eq("id", cashier.userId)
      .single();

    expect(unchanged?.role_id).not.toBe(ownerRoleId);
  });

  it("a user cannot change their own tenant_id", async () => {
    const otherTenant = await createTenantWithOwner(admin, "esc-other");

    const { error } = await cashierClient
      .from("users")
      .update({ tenant_id: otherTenant.tenantId })
      .eq("id", cashier.userId);

    // Defense in depth means this can be blocked by either layer: `tenant_id` isn't in the
    // column-level UPDATE grant for `authenticated` at all (20260725000009), so it's normally
    // caught there before the enforce_role_change_rules trigger (20260725000007) would even run.
    // What actually matters for this test is that it's blocked one way or another and the row is
    // provably unchanged.
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/tenant_id is immutable|permission denied/i);

    const { data: unchanged } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", cashier.userId)
      .single();

    expect(unchanged?.tenant_id).toBe(tenant.tenantId);

    await cleanupUser(admin, otherTenant.ownerId);
    await cleanupTenant(admin, otherTenant.tenantId);
  });

  it("an owner CAN change another staff member's role in the same tenant", async () => {
    const ownerClient = await signIn(tenant.ownerEmail, tenant.ownerPassword);
    const { data: managerRole } = await admin.from("roles").select("id").eq("key", "manager").single();

    const { error } = await ownerClient
      .from("users")
      .update({ role_id: managerRole!.id })
      .eq("id", cashier.userId);

    expect(error).toBeNull();

    const { data: updated } = await admin
      .from("users")
      .select("role_id")
      .eq("id", cashier.userId)
      .single();

    expect(updated?.role_id).toBe(managerRole!.id);
  });
});
