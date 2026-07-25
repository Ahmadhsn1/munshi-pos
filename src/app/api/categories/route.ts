import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";
import { categoryCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("products.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = categoryCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("categories")
    .insert({
      tenant_id: context.tenantId,
      name: parsed.data.name,
      parent_category_id: parsed.data.parentCategoryId || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error?.message.includes("duplicate")
      ? "A category with this name already exists here"
      : (error?.message ?? "Failed to create category");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true, categoryId: data.id });
}
