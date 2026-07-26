import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { applyTaxRate } from "@/lib/tax";
import { saleDraftCreateSchema } from "@/lib/validation";

// Cart building (start/hold a draft) is plain sequential admin-client calls, not a stored
// function -- a partial cart-edit failure has no financial/stock consequence, unlike checkout.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = saleDraftCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // LINE discounts need the same server-side permission gate the BILL discount already has at
  // checkout. The POS UI hides the discount column from a cashier (canDiscount), but that's
  // cosmetic -- without this check a cashier (sales.create, deliberately NOT sales.discount per
  // seed.sql) could POST lineDiscountPaisa directly and grant themselves an unlimited discount,
  // which complete_sale would then faithfully honor since it recomputes totals FROM the stored
  // line items. Checkout's existing billDiscountPaisa check can't catch it -- the discount lives
  // on the line, not the bill.
  if (
    parsed.data.lines.some((line) => line.lineDiscountPaisa > 0) &&
    !context.permissions.has("sales.discount")
  ) {
    return NextResponse.json({ error: "You are not allowed to apply a discount" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: shift } = await admin
    .from("shifts")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("cashier_user_id", context.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!shift) {
    return NextResponse.json({ error: "Open a shift before starting a sale" }, { status: 409 });
  }

  // Prices/tax are resolved from the product catalog server-side -- never trusted from the
  // client -- exactly like every other money-moving path in this app.
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

  const { data: sale, error: saleError } = await admin
    .from("sales")
    .insert({
      tenant_id: context.tenantId,
      shift_id: shift.id,
      cashier_user_id: context.userId,
      session_user_id: context.sessionUserId,
      customer_id: parsed.data.customerId || null,
      held_label: parsed.data.heldLabel || null,
    })
    .select("id")
    .single();

  if (saleError || !sale) {
    return NextResponse.json({ error: "Failed to start sale" }, { status: 400 });
  }

  const lineRows = parsed.data.lines.map((line) => {
    const product = productMap.get(line.productId)!;
    const linePreTax = product.sale_price_paisa * line.quantity - line.lineDiscountPaisa;
    const tax = applyTaxRate(Math.max(linePreTax, 0), product.tax_rate_bps);

    return {
      tenant_id: context.tenantId,
      sale_id: sale.id,
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
    await admin.from("sales").delete().eq("id", sale.id);
    return NextResponse.json({ error: "Failed to save cart items" }, { status: 400 });
  }

  return NextResponse.json({ success: true, saleId: sale.id });
}
