import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

interface ValuationRow {
  product_id: string;
  product_name: string;
  category_name: string | null;
  current_stock: number;
  avg_cost_paisa: number;
  valuation_paisa: number;
}

export async function GET() {
  const context = await getActingUserContext();
  if (!context || !context.permissions.has("reports.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data } = await admin.rpc("get_stock_valuation", { p_tenant_id: context.tenantId });
  const rows = ((data ?? []) as ValuationRow[]).sort((a, b) => b.valuation_paisa - a.valuation_paisa);

  const csv = toCsv(rows, [
    { header: "Product", value: (r) => r.product_name },
    { header: "Category", value: (r) => r.category_name ?? "" },
    { header: "Stock", value: (r) => r.current_stock },
    { header: "Avg Cost (Rs)", value: (r) => fromPaisa(r.avg_cost_paisa) },
    { header: "Value (Rs)", value: (r) => fromPaisa(r.valuation_paisa) },
  ]);

  return csvResponse(`stock-valuation-${businessToday()}.csv`, csv);
}
