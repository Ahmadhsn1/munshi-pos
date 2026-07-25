import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";

export const runtime = "nodejs";

// Held bills are scoped to the caller's own current shift -- matches the everyday POS mental
// model ("bills I put on hold this shift"), not a tenant-wide list.
export async function GET() {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: shift } = await admin
    .from("shifts")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("cashier_user_id", context.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!shift) {
    return NextResponse.json({ sales: [] });
  }

  const { data: sales } = await admin
    .from("sales")
    .select("id, held_label, created_at, customer_id")
    .eq("shift_id", shift.id)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  return NextResponse.json({ sales: sales ?? [] });
}
