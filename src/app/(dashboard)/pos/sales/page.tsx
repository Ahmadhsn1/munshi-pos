import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

// Gated on sales.return: browsing sale history to find one to return/void is a prerequisite for
// that capability. A full sales report (filters, totals, cashier breakdown) is Phase 6's
// territory -- this is just enough to locate a specific sale.
export default async function SalesHistoryPage() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("sales.return") && !context.permissions.has("sales.void")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sales</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view sale history.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: sales } = await supabase
    .from("sales")
    .select("id, invoice_number, status, total_paisa, completed_at, created_at")
    .in("status", ["completed", "void"])
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="text-muted-foreground">Recent completed sales -- select one to return or void.</p>
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sales ?? []).map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <Link href={`/pos/sales/${sale.id}`} className="hover:underline">
                      {sale.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {sale.completed_at ? new Date(sale.completed_at).toLocaleString("en-PK") : "-"}
                  </TableCell>
                  <TableCell>{formatPKR(sale.total_paisa)}</TableCell>
                  <TableCell>
                    <Badge variant={sale.status === "void" ? "destructive" : "secondary"}>
                      {sale.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(sales ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-center">
                    No completed sales yet.
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
