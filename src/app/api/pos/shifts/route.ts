import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { shiftOpenSchema } from "@/lib/validation";

// Uses getActingUserContext() (not getCurrentUserContext()) -- the person opening a shift is
// whoever is actually at the counter, which may be a cashier riding on an owner/manager's real
// session via PIN counter-login.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("shifts.open_close")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = shiftOpenSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("shifts")
    .insert({
      tenant_id: context.tenantId,
      cashier_user_id: context.userId,
      session_user_id: context.sessionUserId,
      opening_cash_paisa: parsed.data.openingCashPaisa,
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "You already have an open shift" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to open shift" }, { status: 400 });
  }

  return NextResponse.json({ success: true, shiftId: data.id });
}
