import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActingUserContext } from "@/lib/permissions";

// Unlike every other POS route, this one can use the plain RLS-scoped client instead of the
// admin client: product data isn't cashier-identity-specific, and RLS already scopes it
// correctly to the caller's tenant. getActingUserContext() is still used for the permission
// check, so a cashier's own products.view grant (not the real session's) is what's honored.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("products.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ products: [] });
  }

  const supabase = await createClient();

  // Barcode scans should resolve to exactly one product -- check for an exact barcode match
  // first, before falling back to a fuzzy name/brand search.
  const { data: barcodeMatch } = await supabase
    .from("product_barcodes")
    .select("product_id")
    .eq("barcode", q)
    .maybeSingle();

  const productSelect =
    "id, name_en, name_ur, brand, sale_price_paisa, tax_rate_bps, current_stock, sale_to_stock_factor, stock_unit:stock_unit_id(name), sale_unit:sale_unit_id(name)";

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
