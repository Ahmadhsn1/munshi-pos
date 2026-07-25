import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

// Query-time computed, no stored running balance -- same reasoning as Phase 3's shift variance
// (read occasionally, not worth a trigger-maintained column). Aging is per-invoice: each
// purchase_payments row references a specific purchase_id directly, so an invoice's remaining
// balance is exact (total_paisa - payments against that invoice), not an approximation.
export default async function PayablesAgingPage() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("suppliers.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payables aging</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view this report.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const { data: suppliers } = await supabase.from("suppliers").select("id, name, credit_terms_days");
  const { data: purchases } = await supabase
    .from("purchases")
    .select("id, supplier_id, purchase_date, total_paisa")
    .not("status", "in", "(draft,cancelled)");

  const purchaseIds = (purchases ?? []).map((p) => p.id);
  const { data: payments } =
    purchaseIds.length > 0
      ? await supabase.from("purchase_payments").select("purchase_id, amount_paisa").in("purchase_id", purchaseIds)
      : { data: [] };

  const paidByPurchase = new Map<string, number>();
  for (const payment of payments ?? []) {
    paidByPurchase.set(payment.purchase_id, (paidByPurchase.get(payment.purchase_id) ?? 0) + payment.amount_paisa);
  }

  const today = new Date();
  const BUCKETS = ["0-30 days", "31-60 days", "61-90 days", "90+ days"] as const;

  function bucketFor(daysOld: number): (typeof BUCKETS)[number] {
    if (daysOld <= 30) return "0-30 days";
    if (daysOld <= 60) return "31-60 days";
    if (daysOld <= 90) return "61-90 days";
    return "90+ days";
  }

  const rows = (suppliers ?? []).map((supplier) => {
    const buckets: Record<(typeof BUCKETS)[number], number> = {
      "0-30 days": 0,
      "31-60 days": 0,
      "61-90 days": 0,
      "90+ days": 0,
    };
    let total = 0;

    for (const purchase of (purchases ?? []).filter((p) => p.supplier_id === supplier.id)) {
      const remaining = purchase.total_paisa - (paidByPurchase.get(purchase.id) ?? 0);
      if (remaining <= 0) continue;

      const daysOld = Math.floor((today.getTime() - new Date(purchase.purchase_date).getTime()) / (1000 * 60 * 60 * 24));
      buckets[bucketFor(daysOld)] += remaining;
      total += remaining;
    }

    return { supplier, buckets, total };
  });

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/suppliers" className="text-muted-foreground text-sm hover:underline">
          ← Suppliers
        </Link>
        <h1 className="text-2xl font-semibold">Payables aging</h1>
        <p className="text-muted-foreground">Outstanding balance per supplier, bucketed by invoice age.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Total outstanding: {formatPKR(grandTotal)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
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
                  <TableRow key={r.supplier.id}>
                    <TableCell>
                      <Link href={`/suppliers/${r.supplier.id}`} className="hover:underline">
                        {r.supplier.name}
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
                    No outstanding payables.
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
