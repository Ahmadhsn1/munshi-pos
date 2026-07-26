import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { fromPaisa } from "@/lib/money";
import { businessToday } from "@/lib/reports";
import { buildSupplierLedger } from "@/lib/supplier-ledger";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();
  if (!context || !context.permissions.has("suppliers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: supplier } = await admin
    .from("suppliers")
    .select("id, name")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const { entries, outstandingPaisa } = await buildSupplierLedger(admin, id);

  const csv = toCsv(entries, [
    { header: "Date", value: (e) => e.date },
    { header: "Description", value: (e) => e.description },
    { header: "Amount (Rs)", value: (e) => fromPaisa(e.amountPaisa) },
    { header: "Balance (Rs)", value: (e) => fromPaisa(e.balancePaisa) },
  ]);

  const csvWithSummary = `Outstanding balance,Rs ${fromPaisa(outstandingPaisa)}\r\n\r\n${csv}`;

  const safeName = supplier.name.replace(/[^a-zA-Z0-9]+/g, "-");
  return csvResponse(`supplier-ledger-${safeName}-${businessToday()}.csv`, csvWithSummary);
}
