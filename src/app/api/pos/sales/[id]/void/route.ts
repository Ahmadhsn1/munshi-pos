import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";

// Void = a full return of every not-yet-returned line (reason_code='void') plus
// sales.status='void' -- record_sale_return covers both in one RPC, no separate stock-movement
// concept needed. Only allowed while the sale is still fully intact (no prior partial returns) --
// keeps this route simple; a sale that's already been partially returned should be finished off
// via the normal return flow instead, which already knows how to compute remaining quantities
// per line.
export const runtime = "nodejs";

const voidSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.void")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = voidSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: sale } = await admin
    .from("sales")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!sale) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  }

  if (sale.status !== "completed") {
    return NextResponse.json({ error: "Only a completed sale can be voided" }, { status: 409 });
  }

  const { data: lineItems } = await admin
    .from("sale_line_items")
    .select("id, quantity")
    .eq("sale_id", id);

  const { data: existingReturns } = await admin
    .from("sale_return_line_items")
    .select("sale_line_item_id")
    .in("sale_line_item_id", (lineItems ?? []).map((l) => l.id));

  if ((existingReturns ?? []).length > 0) {
    return NextResponse.json(
      { error: "This sale already has a partial return -- process the remaining items as a return instead" },
      { status: 409 },
    );
  }

  const { data: payments } = await admin
    .from("sale_payments")
    .select("payment_mode, amount_paisa, reference_text")
    .eq("sale_id", id);

  const { data: shift } = await admin
    .from("shifts")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("cashier_user_id", context.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!shift) {
    return NextResponse.json({ error: "Open a shift before voiding a sale" }, { status: 409 });
  }

  const { data, error } = await admin.rpc("record_sale_return", {
    p_tenant_id: context.tenantId,
    p_sale_id: id,
    p_shift_id: shift.id,
    p_cashier_user_id: context.userId,
    p_session_user_id: context.sessionUserId,
    p_reason_code: "void",
    p_note: parsed.data.note || null,
    p_lines: (lineItems ?? []).map((l) => ({ sale_line_item_id: l.id, quantity: l.quantity })),
    p_refund_payments: (payments ?? []).map((p) => ({
      payment_mode: p.payment_mode,
      amount_paisa: p.amount_paisa,
      reference_text: p.reference_text,
    })),
    p_mark_sale_void: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, ...data });
}
