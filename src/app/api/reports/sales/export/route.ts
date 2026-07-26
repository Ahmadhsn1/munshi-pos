import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday, defaultReportRange, formatBps, marginBps, resolveReportRange } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

interface SalesSummaryRow {
  business_day: string;
  revenue_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  cogs_paisa: number;
  transaction_count: number;
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
  const { data } = await admin.rpc("get_sales_summary", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = (data ?? []) as SalesSummaryRow[];

  const csv = toCsv(rows, [
    { header: "Business Day", value: (r) => r.business_day },
    { header: "Transactions", value: (r) => r.transaction_count },
    { header: "Revenue (incl. tax, Rs)", value: (r) => fromPaisa(r.revenue_paisa) },
    { header: "Discount (Rs)", value: (r) => fromPaisa(r.discount_paisa) },
    { header: "Tax (Rs)", value: (r) => fromPaisa(r.tax_paisa) },
    { header: "COGS (Rs)", value: (r) => fromPaisa(r.cogs_paisa) },
    { header: "Margin", value: (r) => formatBps(marginBps(r.revenue_paisa - r.tax_paisa, r.cogs_paisa)) },
  ]);

  return csvResponse(`sales-report-${range.from}-to-${range.to}.csv`, csv);
}
