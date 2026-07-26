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

  // Cash IN #1: sales rung up on this shift and paid in cash.
  let saleCashIn = 0;
  if (saleIds.length > 0) {
    const { data: cashPayments } = await admin
      .from("sale_payments")
      .select("amount_paisa")
      .in("sale_id", saleIds)
      .eq("payment_mode", "cash");
    saleCashIn = (cashPayments ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
  }

  // Cash IN #2: khata customers paying down their udhaar in cash at this counter. Previously
  // missing entirely -- customer_payments had no shift link -- so every such payment inflated the
  // drawer without inflating the expectation, reporting a phantom SURPLUS. That is the worst
  // possible failure for the one number meant to expose theft: a real shortage could be cancelled
  // out by an unrelated udhaar payment landing in the same shift, and an honest cashier could be
  // accused of a variance they did not cause.
  const { data: khataCashIn } = await admin
    .from("customer_payments")
    .select("amount_paisa")
    .eq("shift_id", id)
    .eq("payment_mode", "cash");
  const customerPaymentCashIn = (khataCashIn ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);

  // Cash OUT #1: refunds handed back in cash. A void is recorded as a full return, so a voided
  // sale's original cash-in is cancelled by its refund here.
  let refundCashOut = 0;
  if (returnIds.length > 0) {
    const { data: cashRefunds } = await admin
      .from("sale_return_payments")
      .select("amount_paisa")
      .in("sale_return_id", returnIds)
      .eq("payment_mode", "cash");
    refundCashOut = (cashRefunds ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
  }

  // Cash OUT #2: shop expenses paid straight out of the till -- chai, a rickshaw fare, a small
  // repair. Extremely common in a Pakistani shop and, until expenses existed, invisible: the money
  // left the drawer and the cashier absorbed it as an unexplained shortage. Voided expenses are
  // excluded; only cash can carry a shift_id (enforced by a DB check constraint).
  const { data: expenseCashOut } = await admin
    .from("expenses")
    .select("amount_paisa")
    .eq("shift_id", id)
    .is("voided_at", null);
  const expenseCash = (expenseCashOut ?? []).reduce((sum, e) => sum + e.amount_paisa, 0);

  const cashIn = saleCashIn + customerPaymentCashIn;
  const cashOut = refundCashOut + expenseCash;

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

  // The breakdown ships with the result, not just the bottom line. A cashier told only "expected
  // Rs 8,400, you are Rs 300 short" has no way to check the claim or spot which component is off --
  // and an unexplainable variance is one nobody trusts or acts on. Itemising it turns the number
  // into something a shopkeeper can actually reconcile against the drawer.
  return NextResponse.json({
    success: true,
    expectedCashPaisa,
    actualCashPaisa: parsed.data.actualCashPaisa,
    variancePaisa,
    breakdown: {
      openingCashPaisa: shift.opening_cash_paisa,
      saleCashInPaisa: saleCashIn,
      customerPaymentCashInPaisa: customerPaymentCashIn,
      refundCashOutPaisa: refundCashOut,
      expenseCashOutPaisa: expenseCash,
    },
  });
}
