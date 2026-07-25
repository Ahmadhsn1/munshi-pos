import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY " +
        "must all be set in .env.local to run RLS tests against the real database.",
    );
  }

  return { url, anonKey, serviceKey };
}

export function createAdminClient(): SupabaseClient {
  const { url, serviceKey } = getEnv();
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function createAnonClient(): SupabaseClient {
  const { url, anonKey } = getEnv();
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

export interface TenantFixture {
  tenantId: string;
  ownerId: string;
  ownerEmail: string;
  ownerPassword: string;
  slug: string;
}

export async function createTenantWithOwner(
  admin: SupabaseClient,
  label: string,
): Promise<TenantFixture> {
  const suffix = randomSuffix();
  const email = `owner-${label}-${suffix}@rls-test.internal`;
  const password = `Test-${suffix}-Aa1!`;
  const slug = `rls-test-${label}-${suffix}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    throw new Error(`Failed to create test owner: ${createError?.message}`);
  }

  const { data: bootstrap, error: bootstrapError } = await admin.rpc("bootstrap_tenant", {
    p_owner_id: created.user.id,
    p_tenant_name: `RLS Test Tenant ${label} ${suffix}`,
    p_tenant_slug: slug,
    p_owner_full_name: `Owner ${label}`,
    p_owner_email: email,
    p_owner_phone: null,
  });

  if (bootstrapError || !bootstrap?.[0]) {
    throw new Error(`Failed to bootstrap test tenant: ${bootstrapError?.message}`);
  }

  return {
    tenantId: bootstrap[0].tenant_id,
    ownerId: created.user.id,
    ownerEmail: email,
    ownerPassword: password,
    slug,
  };
}

export async function createCashier(admin: SupabaseClient, tenantId: string, label: string) {
  const suffix = randomSuffix();
  const email = `cashier-${label}-${suffix}@rls-test.internal`;
  const password = `Test-${suffix}-Aa1!`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    throw new Error(`Failed to create test cashier: ${createError?.message}`);
  }

  const { data: role } = await admin.from("roles").select("id").eq("key", "cashier").single();

  if (!role) {
    throw new Error("cashier role is not seeded");
  }

  const { error: insertError } = await admin.from("users").insert({
    id: created.user.id,
    tenant_id: tenantId,
    role_id: role.id,
    full_name: `Cashier ${label}`,
    email,
  });

  if (insertError) {
    throw new Error(`Failed to insert test cashier profile: ${insertError.message}`);
  }

  return { userId: created.user.id, email, password };
}

export async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  }

  return client;
}

export async function cleanupUser(admin: SupabaseClient, userId: string) {
  // Deleting the auth.users row cascades to public.users (on delete cascade).
  await admin.auth.admin.deleteUser(userId);
}

export async function cleanupTenant(admin: SupabaseClient, tenantId: string) {
  // Users must already be gone -- public.users.tenant_id is `on delete restrict`.
  await admin.from("tenants").delete().eq("id", tenantId);
}

// bootstrap_tenant seeds a default unit catalog (piece, kg, g, ...) -- tests reuse those rather
// than creating their own units for every fixture.
export async function getUnitIdByKey(admin: SupabaseClient, tenantId: string, key: string): Promise<string> {
  const { data } = await admin
    .from("units")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .single();

  if (!data) {
    throw new Error(`Unit "${key}" not found for tenant ${tenantId} -- was bootstrap_tenant's default seed applied?`);
  }

  return data.id;
}

export async function createTestProduct(
  admin: SupabaseClient,
  tenantId: string,
  stockUnitId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name_en: `Test Product ${randomSuffix()}`,
      stock_unit_id: stockUnitId,
      ...overrides,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test product: ${error?.message}`);
  }

  return data.id;
}

/** Gives a product opening stock via a real stock_ledger row (exercises the same trigger-
 * maintained current_stock projection Phase 2 established, rather than writing current_stock
 * directly). */
export async function giveProductStock(
  admin: SupabaseClient,
  tenantId: string,
  productId: string,
  quantity: number,
  createdBy: string,
) {
  const { error } = await admin.from("stock_ledger").insert({
    tenant_id: tenantId,
    product_id: productId,
    movement_type: "opening_stock",
    quantity_delta: quantity,
    created_by: createdBy,
  });

  if (error) {
    throw new Error(`Failed to give product stock: ${error.message}`);
  }
}

export async function createOpenShift(
  admin: SupabaseClient,
  tenantId: string,
  cashierUserId: string,
  sessionUserId: string,
  openingCashPaisa = 0,
): Promise<string> {
  const { data, error } = await admin
    .from("shifts")
    .insert({
      tenant_id: tenantId,
      cashier_user_id: cashierUserId,
      session_user_id: sessionUserId,
      opening_cash_paisa: openingCashPaisa,
      created_by: cashierUserId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to open test shift: ${error?.message}`);
  }

  return data.id;
}

export interface OpenSaleLine {
  productId: string;
  quantity: number;
  unitPricePaisa: number;
  taxPaisa?: number;
}

/** Creates an 'open' sale + its line items directly (bypassing the Route Handler, since these
 * tests exercise RLS/RPC behavior, not HTTP wiring). */
export async function createOpenSale(
  admin: SupabaseClient,
  tenantId: string,
  shiftId: string,
  cashierUserId: string,
  sessionUserId: string,
  lines: OpenSaleLine[],
  customerId: string | null = null,
): Promise<string> {
  const { data: sale, error: saleError } = await admin
    .from("sales")
    .insert({
      tenant_id: tenantId,
      shift_id: shiftId,
      cashier_user_id: cashierUserId,
      session_user_id: sessionUserId,
      customer_id: customerId,
    })
    .select("id")
    .single();

  if (saleError || !sale) {
    throw new Error(`Failed to create test sale: ${saleError?.message}`);
  }

  const { error: linesError } = await admin.from("sale_line_items").insert(
    lines.map((line) => ({
      tenant_id: tenantId,
      sale_id: sale.id,
      product_id: line.productId,
      quantity: line.quantity,
      unit_price_paisa: line.unitPricePaisa,
      tax_paisa: line.taxPaisa ?? 0,
      line_total_paisa: line.unitPricePaisa * line.quantity + (line.taxPaisa ?? 0),
    })),
  );

  if (linesError) {
    throw new Error(`Failed to create test sale line items: ${linesError.message}`);
  }

  return sale.id;
}

export async function createSupplier(
  admin: SupabaseClient,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("suppliers")
    .insert({ tenant_id: tenantId, name: `Test Supplier ${randomSuffix()}`, ...overrides })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test supplier: ${error?.message}`);
  }

  return data.id;
}

export interface DraftPurchaseLine {
  productId: string;
  quantity: number; // purchase_unit terms
  unitCostPaisa: number;
  discountPaisa?: number;
  isFreeGoods?: boolean;
  batchNumber?: string;
  expiryDate?: string;
}

/** Creates a 'draft' purchase + its line items directly (bypassing the Route Handler, since these
 * tests exercise RLS/RPC behavior, not HTTP wiring). Returns the purchase id and the inserted
 * line item ids in the same order as `lines`. */
export async function createDraftPurchase(
  admin: SupabaseClient,
  tenantId: string,
  supplierId: string,
  createdBy: string,
  lines: DraftPurchaseLine[],
): Promise<{ purchaseId: string; lineItemIds: string[] }> {
  const { data: purchase, error: purchaseError } = await admin
    .from("purchases")
    .insert({ tenant_id: tenantId, supplier_id: supplierId, created_by: createdBy })
    .select("id")
    .single();

  if (purchaseError || !purchase) {
    throw new Error(`Failed to create test purchase: ${purchaseError?.message}`);
  }

  const lineItemIds: string[] = [];
  for (const line of lines) {
    const { data: lineItem, error: lineError } = await admin
      .from("purchase_line_items")
      .insert({
        tenant_id: tenantId,
        purchase_id: purchase.id,
        product_id: line.productId,
        batch_number: line.batchNumber ?? null,
        expiry_date: line.expiryDate ?? null,
        quantity: line.quantity,
        unit_cost_paisa: line.unitCostPaisa,
        discount_paisa: line.discountPaisa ?? 0,
        is_free_goods: line.isFreeGoods ?? false,
        line_total_paisa: line.unitCostPaisa * line.quantity - (line.discountPaisa ?? 0),
      })
      .select("id")
      .single();

    if (lineError || !lineItem) {
      throw new Error(`Failed to create test purchase line item: ${lineError?.message}`);
    }

    lineItemIds.push(lineItem.id);
  }

  return { purchaseId: purchase.id, lineItemIds };
}

export async function createTestCustomer(
  admin: SupabaseClient,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, name: `Test Customer ${randomSuffix()}`, ...overrides })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test customer: ${error?.message}`);
  }

  return data.id;
}
