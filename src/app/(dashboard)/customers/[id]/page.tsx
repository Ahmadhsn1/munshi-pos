import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { CustomerDetailActions } from "./customer-detail-actions";

interface LedgerEntry {
  date: string; // shown to the shopkeeper (a khata payment's own paid_at, which may be back-dated)
  // Two-key ordering. `date` alone can't order this ledger correctly because the two sides use
  // different column types: sale_payments.created_at is a timestamptz ("2026-07-25 22:20:05+00")
  // while customer_payments.paid_at is a plain date ("2026-07-25"). A raw string compare makes
  // the date a PREFIX of the timestamp, so a payment always sorted BEFORE the very sale it paid
  // -- the khata book opened with a negative balance, which is exactly the number a shopkeeper
  // trusts least. Sorting on day first, then the precise creation instant, fixes same-day order
  // while still honouring a deliberately back-dated payment.
  sortDay: string; // YYYY-MM-DD
  sortInstant: string; // full timestamptz of when the row was actually created
  description: string;
  amountPaisa: number; // positive = increases what the customer owes, negative = decreases
}

/** Both ledger sides feed dates in different shapes -- normalise to a YYYY-MM-DD day key. */
function toDay(value: string): string {
  return value.slice(0, 10);
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("customers.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone, credit_limit_paisa, price_tier, is_blacklisted, is_active")
    .eq("id", id)
    .maybeSingle();

  if (!customer) {
    notFound();
  }

  const { data: sales } = await supabase
    .from("sales")
    .select("id, invoice_number, completed_at, status")
    .eq("customer_id", id);

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
    .eq("customer_id", id)
    .order("paid_at");

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", context.tenantId).single();

  const ledger: LedgerEntry[] = [
    ...(khataSalePayments ?? []).map((p): LedgerEntry => {
      const sale = saleById.get(p.sale_id);
      return {
        date: p.created_at,
        sortDay: toDay(p.created_at),
        sortInstant: p.created_at,
        description: sale?.invoice_number ? `Invoice ${sale.invoice_number}` : "Khata sale",
        amountPaisa: p.amount_paisa,
      };
    }),
    ...(khataReturnPayments ?? []).map((p): LedgerEntry => {
      const saleId = saleIdByReturnId.get(p.sale_return_id);
      const sale = saleId ? saleById.get(saleId) : undefined;
      return {
        date: p.created_at,
        sortDay: toDay(p.created_at),
        sortInstant: p.created_at,
        description: sale?.invoice_number ? `Return against ${sale.invoice_number}` : "Khata return",
        amountPaisa: -p.amount_paisa,
      };
    }),
    ...(poolPayments ?? []).map((p): LedgerEntry => ({
      date: p.paid_at,
      sortDay: toDay(p.paid_at),
      sortInstant: p.created_at,
      description: `Payment (${p.payment_mode})`,
      amountPaisa: -p.amount_paisa,
    })),
  ].sort((a, b) => a.sortDay.localeCompare(b.sortDay) || a.sortInstant.localeCompare(b.sortInstant));

  let runningBalance = 0;
  const ledgerWithBalance = ledger.map((entry) => {
    runningBalance += entry.amountPaisa;
    return { ...entry, balancePaisa: runningBalance };
  });

  const outstandingPaisa = runningBalance;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/customers" className="text-muted-foreground text-sm hover:underline">
          ← Customers
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
          <Badge variant={customer.is_active ? "secondary" : "outline"}>
            {customer.is_active ? "Active" : "Inactive"}
          </Badge>
          {customer.is_blacklisted && <Badge variant="destructive">Blacklisted</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {customer.phone ?? "No phone"} ·{" "}
          {customer.credit_limit_paisa != null ? `${formatPKR(customer.credit_limit_paisa)} credit limit` : "No credit limit"}
          {customer.price_tier ? ` · ${customer.price_tier} tier` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Outstanding balance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{formatPKR(outstandingPaisa)}</p>
        </CardContent>
      </Card>

      <CustomerDetailActions
        customerId={customer.id}
        customerName={customer.name}
        customerPhone={customer.phone}
        outstandingPaisa={outstandingPaisa}
        tenantName={tenant?.name ?? ""}
        initial={{
          name: customer.name,
          phone: customer.phone,
          creditLimitPaisa: customer.credit_limit_paisa,
          priceTier: customer.price_tier,
          isBlacklisted: customer.is_blacklisted,
          isActive: customer.is_active,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerWithBalance.map((entry, index) => (
                <TableRow key={index}>
                  <TableCell>{new Date(entry.date).toLocaleDateString()}</TableCell>
                  <TableCell>{entry.description}</TableCell>
                  <TableCell>
                    {entry.amountPaisa >= 0 ? "+" : "-"}
                    {formatPKR(Math.abs(entry.amountPaisa))}
                  </TableCell>
                  <TableCell>{formatPKR(entry.balancePaisa)}</TableCell>
                </TableRow>
              ))}
              {ledgerWithBalance.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-center">
                    No khata activity yet.
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
