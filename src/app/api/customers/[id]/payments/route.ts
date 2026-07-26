import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { findOpenShiftIdForUser } from "@/lib/shifts";
import { customerPaymentSchema } from "@/lib/validation";

// A plain insert, not an RPC -- a "paid on account" pool payment against a customer's running
// khata balance, not scoped to any specific sale. Same reasoning/shape as Phase 4's
// purchase_payments (also a plain insert, owner/manager-gated, no locking) -- customer_payments
// only ever REDUCES balance, so it can't cause complete_sale's khata-limit check to see a false
// negative even without its own lock (see the plan's documented accepted gap).
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("customers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customerPaymentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const input = parsed.data;

  // A khata payment taken in CASH physically lands in the counter drawer, so it has to be part of
  // that shift's expected-cash reconciliation. Before this, customer_payments had no shift link at
  // all and shift close only counted `opening + cash sales - cash refunds` -- so every cash udhaar
  // payment made the cashier look like they had a SURPLUS, which can mask a genuine shortage in the
  // one report whose whole job is theft visibility. Non-cash never touches the drawer, and the
  // DB-level check constraint enforces that pairing independently of this code.
  const shiftId =
    input.paymentMode === "cash"
      ? await findOpenShiftIdForUser(admin, context.tenantId, context.userId)
      : null;

  const { data, error } = await admin
    .from("customer_payments")
    .insert({
      tenant_id: context.tenantId,
      customer_id: id,
      payment_mode: input.paymentMode,
      amount_paisa: input.amountPaisa,
      reference_text: input.referenceText || null,
      paid_at: input.paidAt || undefined,
      shift_id: shiftId,
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to record payment" }, { status: 400 });
  }

  return NextResponse.json({ success: true, paymentId: data.id });
}
