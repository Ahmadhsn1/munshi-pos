import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { customerCreateSchema } from "@/lib/validation";

// Full customer management (credit limit, price tier, blacklist) -- distinct from the existing
// POS quick-add route (/api/pos/customers, name+phone only, sales.create-gated), which keeps
// serving its narrower Phase 3 purpose unchanged.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("customers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customerCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customers")
    .insert({
      tenant_id: context.tenantId,
      name: input.name,
      phone: input.phone || null,
      credit_limit_paisa: input.creditLimitPaisa ?? null,
      price_tier: input.priceTier || null,
      is_blacklisted: input.isBlacklisted ?? false,
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error?.message.includes("duplicate")
      ? "A customer with this phone number already exists"
      : (error?.message ?? "Failed to create customer");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true, customerId: data.id });
}
