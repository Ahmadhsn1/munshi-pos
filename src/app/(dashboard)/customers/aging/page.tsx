import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { allocateFifoAging, type KhataDebit } from "@/lib/khata";

// Two-stage model (see plan/lib/khata.ts docs): stage 1 nets each sale's own khata debit against
// ITS OWN khata refunds (exact, no allocation) so a voided/returned sale never gets misattributed
// onto a different, older invoice; stage 2 applies customer_payments (the genuinely unattributed
// "paid on account" pool) via FIFO against what's left of stage 1's per-sale debits.
export default async function KhataAgingPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("customers.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Khata aging</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view this report.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const { data: customers } = await supabase.from("customers").select("id, name");

  const { data: sales } = await supabase
    .from("sales")
    .select("id, customer_id, completed_at")
    .not("customer_id", "is", null);

  const saleIds = (sales ?? []).map((s) => s.id);

  const { data: khataSalePayments } =
    saleIds.length > 0
      ? await supabase.from("sale_payments").select("sale_id, amount_paisa").eq("payment_mode", "khata").in("sale_id", saleIds)
      : { data: [] };

  const { data: saleReturns } =
    saleIds.length > 0 ? await supabase.from("sale_returns").select("id, sale_id").in("sale_id", saleIds) : { data: [] };

  const saleReturnIds = (saleReturns ?? []).map((r) => r.id);
  const saleIdByReturnId = new Map((saleReturns ?? []).map((r) => [r.id, r.sale_id]));

  const { data: khataReturnPayments } =
    saleReturnIds.length > 0
      ? await supabase
          .from("sale_return_payments")
          .select("sale_return_id, amount_paisa")
          .eq("payment_mode", "khata")
          .in("sale_return_id", saleReturnIds)
      : { data: [] };

  const { data: poolPayments } = await supabase.from("customer_payments").select("customer_id, amount_paisa");

  // Stage 1: net debit per sale = khata sale_payments - khata sale_return_payments for THAT sale.
  const grossDebitBySale = new Map<string, number>();
  for (const p of khataSalePayments ?? []) {
    grossDebitBySale.set(p.sale_id, (grossDebitBySale.get(p.sale_id) ?? 0) + p.amount_paisa);
  }

  const returnsBySale = new Map<string, number>();
  for (const p of khataReturnPayments ?? []) {
    const saleId = saleIdByReturnId.get(p.sale_return_id);
    if (!saleId) continue;
    returnsBySale.set(saleId, (returnsBySale.get(saleId) ?? 0) + p.amount_paisa);
  }

  const saleById = new Map((sales ?? []).map((s) => [s.id, s]));

  const debitsByCustomer = new Map<string, KhataDebit[]>();
  for (const [saleId, gross] of grossDebitBySale) {
    const sale = saleById.get(saleId);
    if (!sale || !sale.customer_id) continue;
    const netDebit = gross - (returnsBySale.get(saleId) ?? 0);
    if (netDebit <= 0) continue;

    const list = debitsByCustomer.get(sale.customer_id) ?? [];
    list.push({ id: saleId, date: sale.completed_at ?? "", amountPaisa: netDebit });
    debitsByCustomer.set(sale.customer_id, list);
  }

  for (const list of debitsByCustomer.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  const poolCreditsByCustomer = new Map<string, number>();
  for (const p of poolPayments ?? []) {
    poolCreditsByCustomer.set(p.customer_id, (poolCreditsByCustomer.get(p.customer_id) ?? 0) + p.amount_paisa);
  }

  const today = new Date();
  const BUCKETS = ["0-30 days", "31-60 days", "61-90 days", "90+ days"] as const;

  function bucketFor(daysOld: number): (typeof BUCKETS)[number] {
    if (daysOld <= 30) return "0-30 days";
    if (daysOld <= 60) return "31-60 days";
    if (daysOld <= 90) return "61-90 days";
    return "90+ days";
  }

  const rows = (customers ?? []).map((customer) => {
    const debits = debitsByCustomer.get(customer.id) ?? [];
    const poolCredits = poolCreditsByCustomer.get(customer.id) ?? 0;
    const aged = allocateFifoAging(debits, poolCredits);

    const buckets: Record<(typeof BUCKETS)[number], number> = {
      "0-30 days": 0,
      "31-60 days": 0,
      "61-90 days": 0,
      "90+ days": 0,
    };
    let total = 0;

    for (const debit of aged) {
      const daysOld = Math.floor((today.getTime() - new Date(debit.date).getTime()) / (1000 * 60 * 60 * 24));
      buckets[bucketFor(daysOld)] += debit.remainingPaisa;
      total += debit.remainingPaisa;
    }

    return { customer, buckets, total };
  });

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/customers" className="text-muted-foreground text-sm hover:underline">
          ← Customers
        </Link>
        <h1 className="text-2xl font-semibold">Khata aging</h1>
        <p className="text-muted-foreground">Outstanding udhaar per customer, bucketed by how old each unpaid sale is.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Total outstanding: {formatPKR(grandTotal)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                {BUCKETS.map((bucket) => (
                  <TableHead key={bucket}>{bucket}</TableHead>
                ))}
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows
                .filter((r) => r.total > 0)
                .map((r) => (
                  <TableRow key={r.customer.id}>
                    <TableCell>
                      <Link href={`/customers/${r.customer.id}`} className="hover:underline">
                        {r.customer.name}
                      </Link>
                    </TableCell>
                    {BUCKETS.map((bucket) => (
                      <TableCell key={bucket}>{r.buckets[bucket] > 0 ? formatPKR(r.buckets[bucket]) : "-"}</TableCell>
                    ))}
                    <TableCell className="font-semibold">{formatPKR(r.total)}</TableCell>
                  </TableRow>
                ))}
              {rows.every((r) => r.total === 0) && (
                <TableRow>
                  <TableCell colSpan={BUCKETS.length + 2} className="text-muted-foreground text-center">
                    No outstanding khata.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
