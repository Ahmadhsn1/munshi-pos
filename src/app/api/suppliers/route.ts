import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";
import { supplierCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("suppliers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = supplierCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("suppliers")
    .insert({
      tenant_id: context.tenantId,
      name: input.name,
      phone: input.phone || null,
      address: input.address || null,
      credit_terms_days: input.creditTermsDays ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create supplier" }, { status: 400 });
  }

  return NextResponse.json({ success: true, supplierId: data.id });
}
