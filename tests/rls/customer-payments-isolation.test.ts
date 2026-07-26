import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createTenantWithOwner,
  createTestCustomer,
  signIn,
  type TenantFixture,
} from "./helpers";

describe("customer_payments cross-tenant isolation", () => {
  const admin = createAdminClient();
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let clientA: SupabaseClient;
  let customerB: string;
  let paymentB: string;

  beforeAll(async () => {
    tenantA = await createTenantWithOwner(admin, "custpay-a");
    tenantB = await createTenantWithOwner(admin, "custpay-b");
    clientA = await signIn(tenantA.ownerEmail, tenantA.ownerPassword);

    customerB = await createTestCustomer(admin, tenantB.tenantId);

    const { data: payment } = await admin
      .from("customer_payments")
      .insert({
        tenant_id: tenantB.tenantId,
        customer_id: customerB,
        payment_mode: "cash",
        amount_paisa: 5000,
        created_by: tenantB.ownerId,
      })
      .select("id")
      .single();
    paymentB = payment!.id;
  });

  afterAll(async () => {
    await cleanupUser(admin, tenantA.ownerId);
    await cleanupUser(admin, tenantB.ownerId);
    await cleanupTenant(admin, tenantA.tenantId);
    await cleanupTenant(admin, tenantB.tenantId);
  });

  it("cannot see another tenant's customer_payments", async () => {
    const { data, error } = await clientA.from("customer_payments").select("id").eq("id", paymentB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("rejects a customer_payments insert with a cross-tenant customer_id", async () => {
    const { error } = await admin.from("customer_payments").insert({
      tenant_id: tenantA.tenantId,
      customer_id: customerB, // belongs to tenant B
      payment_mode: "cash",
      amount_paisa: 1000,
      created_by: tenantA.ownerId,
    });

    expect(error).not.toBeNull();
  });

  it("rejects a customer_payments insert with a cross-tenant created_by", async () => {
    const customerA = await createTestCustomer(admin, tenantA.tenantId);

    const { error } = await admin.from("customer_payments").insert({
      tenant_id: tenantA.tenantId,
      customer_id: customerA,
      payment_mode: "cash",
      amount_paisa: 1000,
      created_by: tenantB.ownerId, // belongs to tenant B
    });

    expect(error).not.toBeNull();
  });
});
