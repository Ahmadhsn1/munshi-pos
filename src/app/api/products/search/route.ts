import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/permissions";

// General-purpose product search for back-office flows (purchase-invoice entry) -- distinct from
// /api/pos/products/search, which returns sale-oriented fields (sale_price, sale_unit) for the
// counter. This one returns purchase-oriented fields (purchase_unit, purchase_to_stock_factor).
export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("products.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ products: [] });
  }

  const supabase = await createClient();

  const { data: barcodeMatch } = await supabase
    .from("product_barcodes")
    .select("product_id")
    .eq("barcode", q)
    .maybeSingle();

  const productSelect =
    "id, name_en, name_ur, brand, current_stock, avg_cost_paisa, purchase_to_stock_factor, purchase_unit:purchase_unit_id(name), stock_unit:stock_unit_id(name)";

  if (barcodeMatch) {
    const { data: product } = await supabase
      .from("products")
      .select(productSelect)
      .eq("id", barcodeMatch.product_id)
      .eq("is_active", true)
      .maybeSingle();

    return NextResponse.json({ products: product ? [product] : [] });
  }

  const { data: products } = await supabase
    .from("products")
    .select(productSelect)
    .eq("is_active", true)
    .or(`name_en.ilike.%${q}%,name_ur.ilike.%${q}%,brand.ilike.%${q}%`)
    .limit(20);

  return NextResponse.json({ products: products ?? [] });
}
