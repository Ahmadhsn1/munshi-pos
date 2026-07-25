import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";
import { purchaseDraftUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: purchase } = await admin
    .from("purchases")
    .select("id, status, supplier_id, supplier_invoice_number, purchase_date, subtotal_paisa, discount_paisa, total_paisa, notes")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  const { data: lines } = await admin
    .from("purchase_line_items")
    .select(
      "id, product_id, batch_number, expiry_date, quantity, unit_cost_paisa, discount_paisa, is_free_goods, line_total_paisa, products:product_id(name_en, name_ur)",
    )
    .eq("purchase_id", id);

  return NextResponse.json({ purchase, lines: lines ?? [] });
}

// Replaces the full line-item set for a draft purchase -- same "here's the new full cart"
// approach as Phase 3's sale draft PATCH. Only valid while status='draft';
// enforce_purchase_line_items_tenant_consistency also backstops this at the DB level.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = purchaseDraftUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
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

  if (purchase.status !== "draft") {
    return NextResponse.json({ error: "Only a draft purchase can be edited" }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("purchases")
    .update({
      supplier_id: input.supplierId,
      supplier_invoice_number: input.supplierInvoiceNumber || null,
      purchase_date: input.purchaseDate || undefined,
      notes: input.notes || null,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to update purchase" }, { status: 400 });
  }

  await admin.from("purchase_line_items").delete().eq("purchase_id", id);

  const lineRows = input.lines.map((line) => ({
    tenant_id: context.tenantId,
    purchase_id: id,
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
    return NextResponse.json({ error: "Failed to save purchase line items" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
