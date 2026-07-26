import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  confirmed: "secondary",
  partially_received: "secondary",
  received: "secondary",
  cancelled: "destructive",
};

export default async function PurchasesPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("purchases.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Purchases</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view purchases.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: purchases } = await supabase
    .from("purchases")
    .select("id, status, supplier_invoice_number, purchase_date, total_paisa, suppliers:supplier_id(name)")
    .order("purchase_date", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchases</h1>
          <p className="text-muted-foreground">Purchase invoices, goods receipts, and returns.</p>
        </div>
        <Button nativeButton={false} render={<Link href="/purchases/new">New purchase</Link>} />
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(purchases ?? []).map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell>
                    <Link href={`/purchases/${purchase.id}`} className="hover:underline">
                      {purchase.supplier_invoice_number ?? purchase.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>{(purchase.suppliers as unknown as { name: string } | null)?.name ?? "-"}</TableCell>
                  <TableCell>{purchase.purchase_date}</TableCell>
                  <TableCell>{formatPKR(purchase.total_paisa)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[purchase.status] ?? "secondary"}>{purchase.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(purchases ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
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
