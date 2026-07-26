import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { stockAdjustmentSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("inventory.adjust")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = stockAdjustmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Confirm the product belongs to the caller's own tenant before writing a ledger entry for
  // it -- the admin client bypasses RLS, so this has to be checked explicitly here.
  const { data: product } = await admin
    .from("products")
    .select("id, name_en, current_stock")
    .eq("id", parsed.data.productId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const { error: insertError } = await admin.from("stock_ledger").insert({
    tenant_id: context.tenantId,
    product_id: parsed.data.productId,
    movement_type: "adjustment",
    quantity_delta: parsed.data.quantityDelta,
    reason_code: parsed.data.reasonCode,
    note: parsed.data.note || null,
    created_by: context.userId,
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to record adjustment" }, { status: 400 });
  }

  const { data: updated } = await admin
    .from("products")
    .select("current_stock")
    .eq("id", parsed.data.productId)
    .single();

  // Stock adjustments (damage/theft/wastage/count-correction) are exactly the class of event an
  // owner needs a trail on -- unlike a sale, nothing else records who moved this stock or why.
  await writeAuditLog(admin, context, {
    action: "stock.adjust",
    entityType: "product",
    entityId: parsed.data.productId,
    summary: `Adjusted ${product.name_en} by ${
      parsed.data.quantityDelta >= 0 ? "+" : ""
    }${parsed.data.quantityDelta} (${parsed.data.reasonCode})`,
    beforeData: { currentStock: product.current_stock },
    afterData: {
      currentStock: updated?.current_stock,
      quantityDelta: parsed.data.quantityDelta,
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note || null,
    },
  });

  return NextResponse.json({ success: true, currentStock: updated?.current_stock });
}
