import { describe, expect, it } from "vitest";
import { createAdminClient } from "./helpers";

// Locks down the seeded role -> permission matrix. This is the authorization model the entire
// app's Route Handlers gate on, so silently widening a role here (e.g. granting cashier
// sales.discount) would expand the blast radius of every permission check at once with nothing
// else failing. Added after an audit found a cashier could bypass sales.discount entirely via
// unguarded line discounts on the sale-draft routes -- the route guard is fixed, and this test
// makes sure the underlying grant it depends on stays as intended.
const EXPECTED: Record<string, string[]> = {
  cashier: ["roles.view", "sales.create", "products.view", "shifts.open_close"],
  manager: [
    "users.manage", "users.view", "roles.view", "cost_price.view", "sales.create",
    "products.view", "products.manage", "inventory.view", "inventory.adjust",
    "sales.discount", "sales.return", "sales.void", "shifts.open_close", "shifts.view",
    "customers.manage", "suppliers.manage", "purchases.manage",
  ],
};

// Permissions a cashier must NEVER hold -- anything that moves money or stock outside the normal
// sale flow, or that hides/reveals cost. Spelled out explicitly (rather than derived) so adding a
// new sensitive permission forces a deliberate decision here.
const CASHIER_MUST_NOT_HAVE = [
  "sales.discount", "sales.return", "sales.void",
  "inventory.adjust", "products.manage", "cost_price.view",
  "customers.manage", "suppliers.manage", "purchases.manage",
  "users.manage", "settings.manage", "shifts.view",
];

async function permissionsFor(admin: ReturnType<typeof createAdminClient>, roleKey: string) {
  const { data, error } = await admin
    .from("role_permissions")
    .select("permissions:permission_id(key), roles:role_id(key)")
    .returns<{ permissions: { key: string } | null; roles: { key: string } | null }[]>();

  if (error) throw error;

  return (data ?? [])
    .filter((row) => row.roles?.key === roleKey)
    .map((row) => row.permissions?.key)
    .filter((k): k is string => Boolean(k))
    .sort();
}

describe("seeded role -> permission matrix", () => {
  const admin = createAdminClient();

  it("cashier holds exactly the minimal counter-operation permissions", async () => {
    const actual = await permissionsFor(admin, "cashier");
    expect(actual).toEqual([...EXPECTED.cashier].sort());
  });

  it("cashier holds none of the money/stock/cost-sensitive permissions", async () => {
    const actual = await permissionsFor(admin, "cashier");
    for (const forbidden of CASHIER_MUST_NOT_HAVE) {
      expect(actual, `cashier must not have ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("manager holds exactly its intended permission set", async () => {
    const actual = await permissionsFor(admin, "manager");
    expect(actual).toEqual([...EXPECTED.manager].sort());
  });

  it("owner holds every permission in the catalog", async () => {
    const { data: allPerms } = await admin.from("permissions").select("key");
    const expected = (allPerms ?? []).map((p) => p.key).sort();
    const actual = await permissionsFor(admin, "owner");
    expect(actual).toEqual(expected);
  });
});
