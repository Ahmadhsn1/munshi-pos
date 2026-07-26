import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { saleReturnSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { formatPKR } from "@/lib/money";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.return")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = saleReturnSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: sale } = await admin
    .from("sales")
    .select("id, invoice_number")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!sale) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  }

  const { data: shift } = await admin
    .from("shifts")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("cashier_user_id", context.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!shift) {
    return NextResponse.json({ error: "Open a shift before processing a return" }, { status: 409 });
  }

  const { data, error } = await admin.rpc("record_sale_return", {
    p_tenant_id: context.tenantId,
    p_sale_id: id,
    p_shift_id: shift.id,
    p_cashier_user_id: context.userId,
    p_session_user_id: context.sessionUserId,
    p_reason_code: parsed.data.reasonCode,
    p_note: parsed.data.note || null,
    p_lines: parsed.data.lines.map((l) => ({
      sale_line_item_id: l.saleLineItemId,
      quantity: l.quantity,
    })),
    p_refund_payments: parsed.data.refundPayments.map((p) => ({
      payment_mode: p.paymentMode,
      amount_paisa: p.amountPaisa,
      reference_text: p.referenceText || null,
    })),
    p_mark_sale_void: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const returnTotalPaisa = (data as { totalPaisa?: number } | null)?.totalPaisa ?? 0;

  await writeAuditLog(admin, context, {
    action: "sale.return",
    entityType: "sale",
    entityId: id,
    summary: `Returned ${formatPKR(returnTotalPaisa)} from sale ${sale.invoice_number ?? id} (${parsed.data.reasonCode})`,
    afterData: {
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note || null,
      totalPaisa: returnTotalPaisa,
      lineCount: parsed.data.lines.length,
    },
  });

  return NextResponse.json({ success: true, ...data });
}
