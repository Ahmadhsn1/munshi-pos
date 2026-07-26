import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { addBusinessDays, businessToday } from "@/lib/reports";

export const runtime = "nodejs";

export async function GET() {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("reports.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = businessToday();
  const admin = createAdminClient();

  const { data: summaryRows } = await admin.rpc("get_sales_summary", {
    p_tenant_id: context.tenantId,
    p_from: today,
    p_to: today,
  });
  const summary = (summaryRows ?? [])[0] as
    | { revenue_paisa: number; transaction_count: number }
    | undefined;

  // Cash vs khata split isn't in get_sales_summary (which reports total revenue regardless of
  // payment mode), so it's pulled directly here -- a small, single-purpose query rather than
  // widening the shared RPC's shape for one screen's need. The window is expressed in Asia/Karachi
  // offset boundaries, not UTC midnight, for the same reason every other business-day filter in
  // this app is: matching what `today` (businessToday(), Karachi) actually means as a calendar day.
  const tomorrow = addBusinessDays(today, 1);
  const { data: sales } = await admin
    .from("sales")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .not("invoice_number", "is", null)
    .gte("completed_at", `${today}T00:00:00+05:00`)
    .lt("completed_at", `${tomorrow}T00:00:00+05:00`);
  const saleIds = (sales ?? []).map((s) => s.id);

  let cashSalesPaisa = 0;
  let khataSalesPaisa = 0;
  if (saleIds.length > 0) {
    const { data: payments } = await admin
      .from("sale_payments")
      .select("payment_mode, amount_paisa")
      .in("sale_id", saleIds);
    for (const p of payments ?? []) {
      if (p.payment_mode === "cash") cashSalesPaisa += p.amount_paisa;
      else if (p.payment_mode === "khata") khataSalesPaisa += p.amount_paisa;
    }
  }

  const { data: expenseRows } = await admin
    .from("expenses")
    .select("amount_paisa")
    .eq("tenant_id", context.tenantId)
    .eq("expense_date", today)
    .is("voided_at", null);
  const expensesPaisa = (expenseRows ?? []).reduce((sum, e) => sum + e.amount_paisa, 0);

  return NextResponse.json({
    tenantName: context.tenantName,
    businessDay: today,
    transactionCount: summary?.transaction_count ?? 0,
    revenuePaisa: summary?.revenue_paisa ?? 0,
    cashSalesPaisa,
    khataSalesPaisa,
    expensesPaisa,
  });
}
