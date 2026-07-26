import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { goodsReceiptSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = goodsReceiptSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("record_goods_receipt", {
    p_tenant_id: context.tenantId,
    p_purchase_id: id,
    p_received_by: context.userId,
    p_note: parsed.data.note || null,
    p_lines: parsed.data.lines.map((line) => ({
      purchase_line_item_id: line.purchaseLineItemId,
      quantity_received_purchase_units: line.quantityReceivedPurchaseUnits,
    })),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, ...data });
}
