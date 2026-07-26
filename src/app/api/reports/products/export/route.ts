import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday, defaultReportRange, formatBps, marginBps, resolveReportRange } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

interface ProductSalesRow {
  product_id: string;
  product_name: string;
  category_name: string | null;
  brand: string | null;
  quantity_sold_net: number;
  revenue_paisa: number;
  discount_paisa: number;
  cogs_paisa: number;
}

export async function GET(request: Request) {
  const context = await getActingUserContext();
  if (!context || !context.permissions.has("reports.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const range =
    resolveReportRange(searchParams.get("from") ?? undefined, searchParams.get("to") ?? undefined) ??
    defaultReportRange(businessToday());

  const admin = createAdminClient();
  const { data } = await admin.rpc("get_product_sales", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = ((data ?? []) as ProductSalesRow[]).sort((a, b) => b.revenue_paisa - a.revenue_paisa);

  const csv = toCsv(rows, [
    { header: "Product", value: (r) => r.product_name },
    { header: "Category", value: (r) => r.category_name ?? "" },
    { header: "Brand", value: (r) => r.brand ?? "" },
    { header: "Qty Sold (net)", value: (r) => r.quantity_sold_net },
    { header: "Revenue ex-tax (Rs)", value: (r) => fromPaisa(r.revenue_paisa) },
    { header: "Discount (Rs)", value: (r) => fromPaisa(r.discount_paisa) },
    { header: "COGS (Rs)", value: (r) => fromPaisa(r.cogs_paisa) },
    { header: "Margin", value: (r) => formatBps(marginBps(r.revenue_paisa, r.cogs_paisa)) },
  ]);

  return csvResponse(`product-sales-${range.from}-to-${range.to}.csv`, csv);
}
