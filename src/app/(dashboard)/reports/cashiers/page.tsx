import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPKR } from "@/lib/money";
import { businessToday, defaultReportRange, resolveReportRange } from "@/lib/reports";
import { ReportRangePicker } from "../report-range-picker";
import { ReportNav } from "../report-nav";
import { ExportCsvLink } from "../export-csv-link";

interface CashierRow {
  cashier_user_id: string;
  cashier_name: string;
  sale_count: number;
  revenue_paisa: number;
  discount_given_paisa: number;
  return_count: number;
  return_paisa: number;
  void_count: number;
}

export default async function CashierReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const context = await getActingUserContext();
  if (!context) redirect("/login");

  if (!context.permissions.has("reports.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cashier report</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view reports.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const params = await searchParams;
  const range = resolveReportRange(params.from, params.to) ?? defaultReportRange(businessToday());

  const admin = createAdminClient();
  const { data } = await admin.rpc("get_cashier_report", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = ((data ?? []) as CashierRow[]).sort((a, b) => b.revenue_paisa - a.revenue_paisa);

  return (
    <div className="flex flex-col gap-6">
      <ReportNav current="/reports/cashiers" />
      <div>
        <h1 className="text-2xl font-semibold">Cashier report</h1>
        <p className="text-muted-foreground">
          Sales, discounts, returns and voids per staff member — theft/error visibility.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <ReportRangePicker basePath="/reports/cashiers" from={range.from} to={range.to} />
        <ExportCsvLink href={`/api/reports/cashiers/export?from=${range.from}&to=${range.to}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {range.from} to {range.to}
          </CardTitle>
          <CardDescription>
            &quot;Voids&quot; counts sales this cashier made that were later voided (by anyone).
            &quot;Returns&quot; counts returns this cashier personally processed (which may include
            other cashiers&apos; sales).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Discounts given</TableHead>
                    <TableHead className="text-right">Returns processed</TableHead>
                    <TableHead className="text-right">Return amount</TableHead>
                    <TableHead className="text-right">Their sales voided</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.cashier_user_id}>
                      <TableCell>{row.cashier_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.sale_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPKR(row.revenue_paisa)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPKR(row.discount_given_paisa)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.return_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPKR(row.return_paisa)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${row.void_count > 0 ? "text-destructive font-medium" : ""}`}
                      >
                        {row.void_count}
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
