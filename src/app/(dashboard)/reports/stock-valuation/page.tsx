import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPKR } from "@/lib/money";
import { ReportNav } from "../report-nav";
import { ExportCsvLink } from "../export-csv-link";

interface ValuationRow {
  product_id: string;
  product_name: string;
  category_name: string | null;
  current_stock: number;
  avg_cost_paisa: number;
  valuation_paisa: number;
}

export default async function StockValuationPage() {
  const context = await getActingUserContext();
  if (!context) redirect("/login");

  if (!context.permissions.has("reports.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock valuation</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view reports.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin.rpc("get_stock_valuation", { p_tenant_id: context.tenantId });
  const rows = ((data ?? []) as ValuationRow[]).sort((a, b) => b.valuation_paisa - a.valuation_paisa);

  const totalValuation = rows.reduce((sum, r) => sum + r.valuation_paisa, 0);

  return (
    <div className="flex flex-col gap-6">
      <ReportNav current="/reports/stock-valuation" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock valuation</h1>
          <p className="text-muted-foreground">
            Current stock valued at average purchase cost, as of right now.
          </p>
        </div>
        <ExportCsvLink href="/api/reports/stock-valuation/export" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total stock value</CardDescription>
          <CardTitle className="text-3xl">{formatPKR(totalValuation)}</CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By product</CardTitle>
          <CardDescription>{rows.length} products with stock on hand.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No stock on hand.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Avg cost</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.product_id}>
                      <TableCell>{row.product_name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.category_name ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.current_stock}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPKR(row.avg_cost_paisa)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatPKR(row.valuation_paisa)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
