import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { purchaseDraftCreateSchema } from "@/lib/validation";

// Draft building (start/edit a purchase invoice before confirming) is plain sequential
// admin-client calls, not a stored function -- a partial edit failure has no financial/stock
// consequence, same reasoning as Phase 3's cart building. Only confirm_purchase and onward touch
// money/stock atomically.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = purchaseDraftCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  const { data: purchase, error: purchaseError } = await admin
    .from("purchases")
    .insert({
      tenant_id: context.tenantId,
      supplier_id: input.supplierId,
      supplier_invoice_number: input.supplierInvoiceNumber || null,
      purchase_date: input.purchaseDate || undefined,
      notes: input.notes || null,
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (purchaseError || !purchase) {
    return NextResponse.json({ error: purchaseError?.message ?? "Failed to start purchase" }, { status: 400 });
  }

  const lineRows = input.lines.map((line) => ({
    tenant_id: context.tenantId,
    purchase_id: purchase.id,
    product_id: line.productId,
    batch_number: line.batchNumber || null,
    expiry_date: line.expiryDate || null,
    quantity: line.quantity,
    unit_cost_paisa: line.unitCostPaisa,
    discount_paisa: line.discountPaisa,
    is_free_goods: line.isFreeGoods,
    line_total_paisa: line.unitCostPaisa * line.quantity - line.discountPaisa,
  }));

  const { error: linesError } = await admin.from("purchase_line_items").insert(lineRows);

  if (linesError) {
    await admin.from("purchases").delete().eq("id", purchase.id);
    return NextResponse.json({ error: "Failed to save purchase line items" }, { status: 400 });
  }

  return NextResponse.json({ success: true, purchaseId: purchase.id });
}
