import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { expenseCategoryCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  // Renaming only touches the display name, never `key`. Historical expenses keep pointing at the
  // same row, so a rename retroactively relabels them in reports -- which is what a shopkeeper
  // correcting a typo expects, and why this is a rename rather than "deactivate + create new".
  const { data, error } = await admin
    .from("expense_categories")
    .update({ name: parsed.data.name })
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Category not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("expenses.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Soft deactivate, never a hard delete. Expenses reference the category with `on delete restrict`,
  // so a real DELETE would either fail outright once the category had been used, or -- if the FK
  // were ever loosened -- silently orphan financial history. Deactivating removes it from the entry
  // form while every past expense keeps its real label in reports.
  const { data, error } = await admin
    .from("expense_categories")
    .update({ is_active: false })
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Category not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
