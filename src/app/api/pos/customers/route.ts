import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { customerQuickAddSchema } from "@/lib/validation";

// Checkout-time quick-add only needs sales.create (already granted to cashier) -- deliberately
// not gated behind customers.manage, which is reserved for a future full customer/khata page
// (Phase 5's territory). Blocking quick-add here would break the realistic "new customer walks
// in wanting khata, cashier is alone" case.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customerQuickAddSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customers")
    .insert({
      tenant_id: context.tenantId,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
    })
    .select("id, name, phone")
    .single();

  if (error || !data) {
    const message = error?.message.includes("duplicate")
      ? "A customer with this phone number already exists"
      : (error?.message ?? "Failed to add customer");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true, customer: data });
}
