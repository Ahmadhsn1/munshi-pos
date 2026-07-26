import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { buildCustomerLedger } from "@/lib/customer-ledger";
import { CustomerDetailActions } from "./customer-detail-actions";

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

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", context.tenantId).single();

  const { entries: ledgerWithBalance, outstandingPaisa } = await buildCustomerLedger(supabase, id);

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Ledger</CardTitle>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`/api/customers/${id}/export`}>Export CSV</a>}
          />
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
