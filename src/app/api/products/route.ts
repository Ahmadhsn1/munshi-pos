import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { toPaisa } from "@/lib/money";
import { toBps } from "@/lib/tax";
import { productCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("products.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = productCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  let taxRateBps = 0;
  let salePricePaisa = 0;

  try {
    taxRateBps = input.taxRatePercent === undefined ? 0 : toBps(input.taxRatePercent);
    salePricePaisa = input.salePriceRupees === undefined ? 0 : toPaisa(input.salePriceRupees);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid tax rate or price" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: product, error: insertError } = await admin
    .from("products")
    .insert({
      tenant_id: context.tenantId,
      name_en: input.nameEn,
      name_ur: input.nameUr || null,
      category_id: input.categoryId || null,
      brand: input.brand || null,
      stock_unit_id: input.stockUnitId,
      purchase_unit_id: input.purchaseUnitId || null,
      purchase_to_stock_factor: input.purchaseToStockFactor,
      sale_unit_id: input.saleUnitId || null,
      sale_to_stock_factor: input.saleToStockFactor,
      tax_rate_bps: taxRateBps,
      sale_price_paisa: salePricePaisa,
      reorder_level: input.reorderLevel,
      image_path: input.imagePath || null,
    })
    .select("id")
    .single();

  if (insertError || !product) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create product" },
      { status: 400 },
    );
  }

  if (input.barcodes.length > 0) {
    const { error: barcodeError } = await admin.from("product_barcodes").insert(
      input.barcodes.map((barcode, index) => ({
        tenant_id: context.tenantId,
        product_id: product.id,
        barcode,
        is_primary: index === 0,
      })),
    );

    if (barcodeError) {
      // Best-effort rollback: don't leave a half-created product with no barcodes if that was
      // the point of the request.
      await admin.from("products").delete().eq("id", product.id);
      return NextResponse.json(
        { error: barcodeError.message.includes("duplicate") ? "One of these barcodes is already in use" : "Failed to save barcodes" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ success: true, productId: product.id });
}
