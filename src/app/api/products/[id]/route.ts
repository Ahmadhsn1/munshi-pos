import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { toPaisa } from "@/lib/money";
import { toBps } from "@/lib/tax";
import { productUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("products.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = productUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // barcodes are intentionally not editable through this endpoint -- managing the barcode list
  // is a separate small concern (add/remove one at a time), not a bulk-replace on every save.
  const { barcodes: _barcodes, taxRatePercent, salePriceRupees, isActive, ...rest } = parsed.data;
  void _barcodes;

  const update: Record<string, unknown> = {};
  if (rest.nameEn !== undefined) update.name_en = rest.nameEn;
  if (rest.nameUr !== undefined) update.name_ur = rest.nameUr || null;
  if (rest.categoryId !== undefined) update.category_id = rest.categoryId || null;
  if (rest.brand !== undefined) update.brand = rest.brand || null;
  if (rest.stockUnitId !== undefined) update.stock_unit_id = rest.stockUnitId;
  if (rest.purchaseUnitId !== undefined) update.purchase_unit_id = rest.purchaseUnitId || null;
  if (rest.purchaseToStockFactor !== undefined) update.purchase_to_stock_factor = rest.purchaseToStockFactor;
  if (rest.saleUnitId !== undefined) update.sale_unit_id = rest.saleUnitId || null;
  if (rest.saleToStockFactor !== undefined) update.sale_to_stock_factor = rest.saleToStockFactor;
  if (rest.reorderLevel !== undefined) update.reorder_level = rest.reorderLevel;
  if (rest.imagePath !== undefined) update.image_path = rest.imagePath || null;
  if (isActive !== undefined) update.is_active = isActive;

  if (taxRatePercent !== undefined) {
    try {
      update.tax_rate_bps = toBps(taxRatePercent);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid tax rate" },
        { status: 400 },
      );
    }
  }

  if (salePriceRupees !== undefined) {
    try {
      update.sale_price_paisa = toPaisa(salePriceRupees);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid price" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Scoped by both id AND the caller's own validated tenant_id -- never trust the URL param
  // alone, or a guessed product id from another tenant could be modified via the admin client.
  const { data, error } = await admin
    .from("products")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to update product" }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
