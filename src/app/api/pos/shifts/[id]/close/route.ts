import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { shiftCloseSchema } from "@/lib/validation";

// expected_cash_paisa is computed here, once, at close time -- not incrementally maintained like
// products.current_stock. This isn't a hot path (read ~once per shift close) and a small shop's
// per-shift transaction volume makes the aggregate trivially fast -- not worth three write paths
// (sale, return, void) staying transactionally perfect for a value read once.
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("shifts.open_close")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = shiftCloseSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: shift } = await admin
    .from("shifts")
    .select("id, cashier_user_id, status, opening_cash_paisa")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  // Closing someone else's shift requires oversight visibility (shifts.view), not just the
  // ability to open/close your own.
  if (shift.cashier_user_id !== context.userId && !context.permissions.has("shifts.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (shift.status !== "open") {
    return NextResponse.json({ error: "Shift is already closed" }, { status: 409 });
  }

  const { data: sales } = await admin.from("sales").select("id").eq("shift_id", id);
  const saleIds = (sales ?? []).map((s) => s.id);

  const { data: returns } = await admin.from("sale_returns").select("id").eq("shift_id", id);
  const returnIds = (returns ?? []).map((r) => r.id);

  let cashIn = 0;
  if (saleIds.length > 0) {
    const { data: cashPayments } = await admin
      .from("sale_payments")
      .select("amount_paisa")
      .in("sale_id", saleIds)
      .eq("payment_mode", "cash");
    cashIn = (cashPayments ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
  }

  let cashOut = 0;
  if (returnIds.length > 0) {
    const { data: cashRefunds } = await admin
      .from("sale_return_payments")
      .select("amount_paisa")
      .in("sale_return_id", returnIds)
      .eq("payment_mode", "cash");
    cashOut = (cashRefunds ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
  }

  const expectedCashPaisa = shift.opening_cash_paisa + cashIn - cashOut;
  const variancePaisa = parsed.data.actualCashPaisa - expectedCashPaisa;

  // The WHERE status='open' guard makes a racing double-close a clean no-op (0 rows affected)
  // instead of overwriting an already-computed close.
  const { data: updated, error } = await admin
    .from("shifts")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      expected_cash_paisa: expectedCashPaisa,
      actual_cash_paisa: parsed.data.actualCashPaisa,
      variance_paisa: variancePaisa,
      closing_note: parsed.data.closingNote || null,
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to close shift" }, { status: 400 });
  }

  if (!updated) {
    return NextResponse.json({ error: "Shift is already closed" }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    expectedCashPaisa,
    actualCashPaisa: parsed.data.actualCashPaisa,
    variancePaisa,
  });
}
