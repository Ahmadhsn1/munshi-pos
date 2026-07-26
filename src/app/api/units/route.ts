import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { unitCreateSchema } from "@/lib/validation";

// Backs the inline "+ create unit" affordance in the product form -- units are tenant-scoped and
// freely extensible (see 20260725000010_units.sql), not a fixed global catalog.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("products.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = unitCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("units")
    .insert({ tenant_id: context.tenantId, key: parsed.data.key, name: parsed.data.name })
    .select("id, key, name")
    .single();

  if (error || !data) {
    const message = error?.message.includes("duplicate")
      ? "A unit with this key already exists"
      : (error?.message ?? "Failed to create unit");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true, unit: data });
}
