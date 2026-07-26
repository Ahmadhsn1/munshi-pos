import type { SupabaseClient } from "@supabase/supabase-js";

export interface CustomerLedgerEntry {
  date: string; // shown to the shopkeeper (a khata payment's own paid_at, which may be back-dated)
  description: string;
  amountPaisa: number; // positive = increases what the customer owes, negative = decreases
  balancePaisa: number; // running balance after this entry
}

/** Two-key ordering. `date` alone can't order this ledger correctly because the two sides use
 * different column types: sale_payments.created_at is a timestamptz ("2026-07-25 22:20:05+00")
 * while customer_payments.paid_at is a plain date ("2026-07-25"). A raw string compare makes the
 * date a PREFIX of the timestamp, so a payment always sorts BEFORE the very sale it paid -- the
 * khata book opens with a negative balance, which is exactly the number a shopkeeper trusts least.
 * Sorting on day first, then the precise creation instant, fixes same-day order while still
 * honouring a deliberately back-dated payment. */
interface SortableEntry extends CustomerLedgerEntry {
  sortDay: string;
  sortInstant: string;
}

function toDay(value: string): string {
  return value.slice(0, 10);
}

/**
 * Builds one customer's khata ledger with a running balance -- the single source of truth used by
 * BOTH the customer detail page's on-screen table and its CSV export, so the two can never drift
 * apart. Extracted here specifically because this logic (three payment sources, two different date
 * column shapes, a non-obvious sort-order bug already found and fixed once) is exactly the kind of
 * thing that silently diverges if copy-pasted into a second call site.
 */
export async function buildCustomerLedger(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{ entries: CustomerLedgerEntry[]; outstandingPaisa: number }> {
  const { data: sales } = await supabase
    .from("sales")
    .select("id, invoice_number, completed_at, status")
    .eq("customer_id", customerId);

  const saleIds = (sales ?? []).map((s) => s.id);
  const saleById = new Map((sales ?? []).map((s) => [s.id, s]));

  const { data: khataSalePayments } =
    saleIds.length > 0
      ? await supabase
          .from("sale_payments")
          .select("sale_id, amount_paisa, created_at")
          .eq("payment_mode", "khata")
          .in("sale_id", saleIds)
      : { data: [] };

  const { data: saleReturns } =
    saleIds.length > 0
      ? await supabase.from("sale_returns").select("id, sale_id, created_at").in("sale_id", saleIds)
      : { data: [] };

  const saleReturnIds = (saleReturns ?? []).map((r) => r.id);
  const saleIdByReturnId = new Map((saleReturns ?? []).map((r) => [r.id, r.sale_id]));

  const { data: khataReturnPayments } =
    saleReturnIds.length > 0
      ? await supabase
          .from("sale_return_payments")
          .select("sale_return_id, amount_paisa, created_at")
          .eq("payment_mode", "khata")
          .in("sale_return_id", saleReturnIds)
      : { data: [] };

  const { data: poolPayments } = await supabase
    .from("customer_payments")
    .select("id, amount_paisa, payment_mode, paid_at, reference_text, created_at")
    .eq("customer_id", customerId)
    .order("paid_at");

  const ledger: SortableEntry[] = [
    ...(khataSalePayments ?? []).map((p): SortableEntry => {
      const sale = saleById.get(p.sale_id);
      return {
        date: p.created_at,
        sortDay: toDay(p.created_at),
        sortInstant: p.created_at,
        description: sale?.invoice_number ? `Invoice ${sale.invoice_number}` : "Khata sale",
        amountPaisa: p.amount_paisa,
        balancePaisa: 0, // filled in below
      };
    }),
    ...(khataReturnPayments ?? []).map((p): SortableEntry => {
      const saleId = saleIdByReturnId.get(p.sale_return_id);
      const sale = saleId ? saleById.get(saleId) : undefined;
      return {
        date: p.created_at,
        sortDay: toDay(p.created_at),
        sortInstant: p.created_at,
        description: sale?.invoice_number ? `Return against ${sale.invoice_number}` : "Khata return",
        amountPaisa: -p.amount_paisa,
        balancePaisa: 0,
      };
    }),
    ...(poolPayments ?? []).map((p): SortableEntry => ({
      date: p.paid_at,
      sortDay: toDay(p.paid_at),
      sortInstant: p.created_at,
      description: `Payment (${p.payment_mode})`,
      amountPaisa: -p.amount_paisa,
      balancePaisa: 0,
    })),
  ].sort((a, b) => a.sortDay.localeCompare(b.sortDay) || a.sortInstant.localeCompare(b.sortInstant));

  let runningBalance = 0;
  const entries = ledger.map((entry) => {
    runningBalance += entry.amountPaisa;
    return { ...entry, balancePaisa: runningBalance };
  });

  return { entries, outstandingPaisa: runningBalance };
}
