import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday, defaultReportRange, resolveReportRange } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

interface CashBookRow {
  business_day: string;
  cash_sales_paisa: number;
  khata_receipts_paisa: number;
  refunds_paisa: number;
  expenses_paisa: number;
  supplier_payments_paisa: number;
  net_cash_paisa: number;
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
  const { data } = await admin.rpc("get_cash_book", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = (data ?? []) as CashBookRow[];

  const csv = toCsv(rows, [
    { header: "Day", value: (r) => r.business_day },
    { header: "Cash Sales (Rs)", value: (r) => fromPaisa(r.cash_sales_paisa) },
    { header: "Khata Received (Rs)", value: (r) => fromPaisa(r.khata_receipts_paisa) },
    { header: "Refunds (Rs)", value: (r) => fromPaisa(r.refunds_paisa) },
    { header: "Expenses (Rs)", value: (r) => fromPaisa(r.expenses_paisa) },
    { header: "Supplier Paid (Rs)", value: (r) => fromPaisa(r.supplier_payments_paisa) },
    { header: "Net (Rs)", value: (r) => fromPaisa(r.net_cash_paisa) },
  ]);

  return csvResponse(`cash-book-${range.from}-to-${range.to}.csv`, csv);
}
