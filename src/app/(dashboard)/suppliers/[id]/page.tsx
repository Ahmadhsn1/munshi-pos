import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { buildSupplierLedger } from "@/lib/supplier-ledger";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("suppliers.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Supplier</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, phone, address, credit_terms_days, is_active")
    .eq("id", id)
    .maybeSingle();

  if (!supplier) {
    notFound();
  }

  // Fetched separately from the ledger builder below because the "Purchases" card further down
  // this page lists invoices on their own, independent of the combined invoice+payment ledger view.
  const { data: purchases } = await supabase
    .from("purchases")
    .select("id, status, supplier_invoice_number, purchase_date, total_paisa")
    .eq("supplier_id", id)
    .not("status", "in", "(draft,cancelled)")
    .order("purchase_date");

  const { entries: ledgerWithBalance, outstandingPaisa } = await buildSupplierLedger(supabase, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/suppliers" className="text-muted-foreground text-sm hover:underline">
          ← Suppliers
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{supplier.name}</h1>
          <Badge variant={supplier.is_active ? "secondary" : "outline"}>
            {supplier.is_active ? "Active" : "Inactive"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {supplier.phone ?? "No phone"} · {supplier.address ?? "No address"} ·{" "}
          {supplier.credit_terms_days != null ? `${supplier.credit_terms_days} day credit terms` : "No credit terms set"}
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Ledger</CardTitle>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`/api/suppliers/${id}/export`}>Export CSV</a>}
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
                  <TableCell>{entry.date}</TableCell>
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
                    No purchase activity yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Purchases</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(purchases ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/purchases/${p.id}`} className="hover:underline">
                      {p.supplier_invoice_number ?? p.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>{p.purchase_date}</TableCell>
                  <TableCell>{formatPKR(p.total_paisa)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(purchases ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-center">
                    No purchases yet.
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
