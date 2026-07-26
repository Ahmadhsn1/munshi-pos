import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { applyTaxRate } from "@/lib/tax";
import { saleDraftUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

// Recall: load an open (or, read-only, any) sale + its lines back for the cart UI.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: sale } = await admin
    .from("sales")
    .select(
      "id, status, invoice_number, customer_id, held_label, shift_id, subtotal_paisa, line_discount_paisa, bill_discount_paisa, tax_paisa, round_off_paisa, total_paisa, completed_at, customers:customer_id(id, name)",
    )
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!sale) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  }

  const { data: lines } = await admin
    .from("sale_line_items")
    .select(
      "id, product_id, quantity, unit_price_paisa, line_discount_paisa, tax_paisa, line_total_paisa, products:product_id(name_en, name_ur, sale_unit:sale_unit_id(name))",
    )
    .eq("sale_id", id);

  return NextResponse.json({ sale, lines: lines ?? [] });
}

// Replaces the full line-item set for an open draft -- simplest correct approach for a cart that
// gets rebuilt from client-side state on every edit (add/remove/change quantity all reduce to
// "here's the new full cart"). Only valid while status='open'; a completed/void sale is immutable.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = saleDraftUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Same server-side line-discount gate as the draft-create route -- see the comment there for
  // why the UI's canDiscount prop and checkout's bill-discount check together are not enough.
  if (
    parsed.data.lines.some((line) => line.lineDiscountPaisa > 0) &&
    !context.permissions.has("sales.discount")
  ) {
    return NextResponse.json({ error: "You are not allowed to apply a discount" }, { status: 403 });
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

  if (sale.status !== "open") {
    return NextResponse.json({ error: "Only an open sale can be edited" }, { status: 409 });
  }

  const productIds = parsed.data.lines.map((line) => line.productId);
  const { data: products } = await admin
    .from("products")
    .select("id, sale_price_paisa, tax_rate_bps, is_active")
    .eq("tenant_id", context.tenantId)
    .in("id", productIds);

  const productMap = new Map((products ?? []).map((p) => [p.id, p]));

  for (const line of parsed.data.lines) {
    const product = productMap.get(line.productId);
    if (!product || !product.is_active) {
      return NextResponse.json({ error: "One of these products is not available" }, { status: 400 });
    }
  }

  const { error: updateError } = await admin
    .from("sales")
    .update({
      customer_id: parsed.data.customerId || null,
      held_label: parsed.data.heldLabel || null,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to update sale" }, { status: 400 });
  }

  await admin.from("sale_line_items").delete().eq("sale_id", id);

  const lineRows = parsed.data.lines.map((line) => {
    const product = productMap.get(line.productId)!;
    const linePreTax = product.sale_price_paisa * line.quantity - line.lineDiscountPaisa;
    const tax = applyTaxRate(Math.max(linePreTax, 0), product.tax_rate_bps);

    return {
      tenant_id: context.tenantId,
      sale_id: id,
      product_id: line.productId,
      quantity: line.quantity,
      unit_price_paisa: product.sale_price_paisa,
      line_discount_paisa: line.lineDiscountPaisa,
      tax_paisa: tax,
      line_total_paisa: Math.max(linePreTax, 0) + tax,
    };
  });

  const { error: linesError } = await admin.from("sale_line_items").insert(lineRows);

  if (linesError) {
    return NextResponse.json({ error: "Failed to save cart items" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
