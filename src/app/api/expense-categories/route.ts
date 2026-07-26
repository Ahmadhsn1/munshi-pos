import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { expenseCategoryCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("expenses.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data } = await admin
    .from("expense_categories")
    .select("id, key, name, is_active")
    .eq("tenant_id", context.tenantId)
    .eq("is_active", true)
    .order("name");

  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("expenses.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = expenseCategoryCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // `key` is derived from the name rather than asked for: shopkeepers should not have to invent a
  // slug. The uniqueness index is on lower(key) per tenant, so this is also what makes "Bijli" and
  // "bijli" collide as intended.
  const key = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  if (!key) {
    return NextResponse.json(
      { error: "Please use at least one letter or number in the name" },
      { status: 400 },
    );
  }

  // A category the shop previously deactivated still occupies its key. Reactivating it (rather than
  // failing with "already exists", which would be baffling for a name the user cannot see anywhere)
  // also preserves the link from every historical expense filed under it.
  const { data: existing } = await admin
    .from("expense_categories")
    .select("id, is_active")
    .eq("tenant_id", context.tenantId)
    .ilike("key", key)
    .maybeSingle();

  if (existing) {
    if (existing.is_active) {
      return NextResponse.json({ error: "This category already exists" }, { status: 400 });
    }

    await admin
      .from("expense_categories")
      .update({ name: parsed.data.name, is_active: true })
      .eq("id", existing.id);

    return NextResponse.json({ success: true, categoryId: existing.id, reactivated: true });
  }

  const { data, error } = await admin
    .from("expense_categories")
    .insert({ tenant_id: context.tenantId, key, name: parsed.data.name })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create category" },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, categoryId: data.id });
}
