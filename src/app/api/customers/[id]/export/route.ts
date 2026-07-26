import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday } from "@/lib/reports";
import { buildCustomerLedger } from "@/lib/customer-ledger";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();
  if (!context || !context.permissions.has("customers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, name")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Same shared builder the on-screen ledger table uses -- see lib/customer-ledger.ts for why that
  // matters: this ledger's sort order has a genuine, non-obvious correctness bug it already fixed
  // once (a same-day payment sorting before the sale it paid), and duplicating the logic here would
  // risk silently reintroducing it in the export while the page stays correct.
  const { entries, outstandingPaisa } = await buildCustomerLedger(admin, id);

  const csv = toCsv(entries, [
    { header: "Date", value: (e) => new Date(e.date).toISOString().slice(0, 10) },
    { header: "Description", value: (e) => e.description },
    { header: "Amount (Rs)", value: (e) => fromPaisa(e.amountPaisa) },
    { header: "Balance (Rs)", value: (e) => fromPaisa(e.balancePaisa) },
  ]);

  const csvWithSummary = `Outstanding balance,Rs ${fromPaisa(outstandingPaisa)}\r\n\r\n${csv}`;

  const safeName = customer.name.replace(/[^a-zA-Z0-9]+/g, "-");
  return csvResponse(`khata-${safeName}-${businessToday()}.csv`, csvWithSummary);
}
