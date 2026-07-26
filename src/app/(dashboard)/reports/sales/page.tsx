import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPKR } from "@/lib/money";
import { businessToday, defaultReportRange, formatBps, marginBps, resolveReportRange } from "@/lib/reports";
import { ReportRangePicker } from "../report-range-picker";
import { ReportNav } from "../report-nav";

interface SalesSummaryRow {
  business_day: string;
  revenue_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  cogs_paisa: number;
  transaction_count: number;
}

export default async function SalesReportPage({
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
          <CardTitle>Sales report</CardTitle>
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
  const { data } = await admin.rpc("get_sales_summary", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = ((data ?? []) as SalesSummaryRow[]).filter(
    (r) => r.revenue_paisa !== 0 || r.transaction_count !== 0,
  );

  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue_paisa,
      discount: acc.discount + r.discount_paisa,
      tax: acc.tax + r.tax_paisa,
      cogs: acc.cogs + r.cogs_paisa,
      tx: acc.tx + r.transaction_count,
    }),
    { revenue: 0, discount: 0, tax: 0, cogs: 0, tx: 0 },
  );

  // Margin is computed against REVENUE NET OF TAX -- tax collected on behalf of the government was
  // never the shop's money to begin with, so including it in the base would overstate margin.
  const totalMarginBps = marginBps(totals.revenue - totals.tax, totals.cogs);

  return (
    <div className="flex flex-col gap-6">
      <ReportNav current="/reports/sales" />
      <div>
        <h1 className="text-2xl font-semibold">Sales &amp; margin</h1>
        <p className="text-muted-foreground">Revenue, discounts and gross margin by business day.</p>
      </div>

      <ReportRangePicker basePath="/reports/sales" from={range.from} to={range.to} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Revenue (incl. tax)</CardDescription>
            <CardTitle className="text-2xl">{formatPKR(totals.revenue)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Discounts given</CardDescription>
            <CardTitle className="text-2xl">{formatPKR(totals.discount)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transactions</CardDescription>
            <CardTitle className="text-2xl">{totals.tx}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Gross margin (ex-tax)</CardDescription>
            <CardTitle className={`text-2xl ${totalMarginBps < 0 ? "text-destructive" : ""}`}>
              {formatBps(totalMarginBps)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {range.from} to {range.to}
          </CardTitle>
          <CardDescription>
            Returns and voids are netted into the day they were returned/voided, not the original
            sale day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sales in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Revenue (incl. tax)</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const dayMarginBps = marginBps(row.revenue_paisa - row.tax_paisa, row.cogs_paisa);
                    return (
                      <TableRow key={row.business_day}>
                        <TableCell>{row.business_day}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.transaction_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.revenue_paisa)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.discount_paisa)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.tax_paisa)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.cogs_paisa)}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${dayMarginBps < 0 ? "text-destructive" : ""}`}
                        >
                          {formatBps(dayMarginBps)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
