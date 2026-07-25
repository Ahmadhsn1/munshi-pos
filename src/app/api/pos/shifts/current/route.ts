import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET() {
  const context = await getActingUserContext();

  if (!context) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: shift } = await admin
    .from("shifts")
    .select("id, opening_cash_paisa, opened_at")
    .eq("tenant_id", context.tenantId)
    .eq("cashier_user_id", context.userId)
    .eq("status", "open")
    .maybeSingle();

  return NextResponse.json({ shift: shift ?? null });
}
