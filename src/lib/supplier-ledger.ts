import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupplierLedgerEntry {
  date: string;
  description: string;
  amountPaisa: number; // positive = increases payable, negative = decreases
  balancePaisa: number;
}

/** Shared by the supplier detail page's on-screen table and its CSV export, so the two can never
 * drift apart -- same reasoning as lib/customer-ledger.ts. */
export async function buildSupplierLedger(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<{ entries: SupplierLedgerEntry[]; outstandingPaisa: number }> {
  const { data: purchases } = await supabase
    .from("purchases")
    .select("id, status, supplier_invoice_number, purchase_date, total_paisa")
    .eq("supplier_id", supplierId)
    .not("status", "in", "(draft,cancelled)")
    .order("purchase_date");

  const purchaseIds = (purchases ?? []).map((p) => p.id);

  const { data: payments } =
    purchaseIds.length > 0
      ? await supabase
          .from("purchase_payments")
          .select("id, purchase_id, payment_mode, amount_paisa, paid_at")
          .in("purchase_id", purchaseIds)
          .order("paid_at")
      : { data: [] };

  const ledger = [
    ...(purchases ?? []).map((p) => ({
      date: p.purchase_date,
      description: p.supplier_invoice_number ? `Invoice ${p.supplier_invoice_number}` : "Purchase invoice",
      amountPaisa: p.total_paisa,
    })),
    ...(payments ?? []).map((pay) => ({
      date: pay.paid_at,
      description: `Payment (${pay.payment_mode})`,
      amountPaisa: -pay.amount_paisa,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let runningBalance = 0;
  const entries = ledger.map((entry) => {
    runningBalance += entry.amountPaisa;
    return { ...entry, balancePaisa: runningBalance };
  });

  return { entries, outstandingPaisa: runningBalance };
}
