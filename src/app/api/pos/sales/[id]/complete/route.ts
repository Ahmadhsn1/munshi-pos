import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { checkoutSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (parsed.data.billDiscountPaisa > 0 && !context.permissions.has("sales.discount")) {
    return NextResponse.json({ error: "You are not allowed to apply a discount" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Confirm the sale belongs to this tenant before handing its id to the RPC -- the RPC itself
  // also re-checks tenant_id, this is just a cleaner 404 than a generic RPC error.
  const { data: sale } = await admin
    .from("sales")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!sale) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  }

  const { data, error } = await admin.rpc("complete_sale", {
    p_tenant_id: context.tenantId,
    p_sale_id: id,
    p_bill_discount_paisa: parsed.data.billDiscountPaisa,
    p_round_off_paisa: parsed.data.roundOffPaisa,
    p_payments: parsed.data.payments.map((p) => ({
      payment_mode: p.paymentMode,
      amount_paisa: p.amountPaisa,
      reference_text: p.referenceText || null,
    })),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, ...data });
}
