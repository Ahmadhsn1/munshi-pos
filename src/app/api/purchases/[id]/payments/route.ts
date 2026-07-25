import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";
import { purchasePaymentSchema } from "@/lib/validation";

// A plain insert, not an RPC -- a supplier payment is a standalone event against an already-
// confirmed purchase, no multi-table atomicity concern (unlike sale_payments, which only ever
// gets inserted from inside complete_sale's own atomicity). Payables aging is computed at query
// time from these rows, not a stored running balance.
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = purchasePaymentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: purchase } = await admin
    .from("purchases")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  if (purchase.status === "draft" || purchase.status === "cancelled") {
    return NextResponse.json({ error: "Cannot record a payment against this purchase" }, { status: 409 });
  }

  const input = parsed.data;

  const { data, error } = await admin
    .from("purchase_payments")
    .insert({
      tenant_id: context.tenantId,
      purchase_id: id,
      payment_mode: input.paymentMode,
      amount_paisa: input.amountPaisa,
      reference_text: input.referenceText || null,
      paid_at: input.paidAt || undefined,
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to record payment" }, { status: 400 });
  }

  return NextResponse.json({ success: true, paymentId: data.id });
}
