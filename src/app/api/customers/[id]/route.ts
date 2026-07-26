import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";
import { customerUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("customers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customerUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.phone !== undefined) update.phone = input.phone || null;
  if (input.creditLimitPaisa !== undefined) update.credit_limit_paisa = input.creditLimitPaisa;
  if (input.priceTier !== undefined) update.price_tier = input.priceTier || null;
  if (input.isBlacklisted !== undefined) update.is_blacklisted = input.isBlacklisted;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customers")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    const message = error.message.includes("duplicate")
      ? "A customer with this phone number already exists"
      : "Failed to update customer";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
