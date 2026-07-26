import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday, defaultReportRange, resolveReportRange } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

interface CashierRow {
  cashier_user_id: string;
  cashier_name: string;
  sale_count: number;
  revenue_paisa: number;
  discount_given_paisa: number;
  return_count: number;
  return_paisa: number;
  void_count: number;
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
  const { data } = await admin.rpc("get_cashier_report", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = ((data ?? []) as CashierRow[]).sort((a, b) => b.revenue_paisa - a.revenue_paisa);

  const csv = toCsv(rows, [
    { header: "Cashier", value: (r) => r.cashier_name },
    { header: "Sales", value: (r) => r.sale_count },
    { header: "Revenue (Rs)", value: (r) => fromPaisa(r.revenue_paisa) },
    { header: "Discounts Given (Rs)", value: (r) => fromPaisa(r.discount_given_paisa) },
    { header: "Returns Processed", value: (r) => r.return_count },
    { header: "Return Amount (Rs)", value: (r) => fromPaisa(r.return_paisa) },
    { header: "Their Sales Voided", value: (r) => r.void_count },
  ]);

  return csvResponse(`cashier-report-${range.from}-to-${range.to}.csv`, csv);
}
