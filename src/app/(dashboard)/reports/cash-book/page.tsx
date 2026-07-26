import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPKR } from "@/lib/money";
import { businessToday, defaultReportRange, resolveReportRange } from "@/lib/reports";
import { ReportRangePicker } from "../report-range-picker";
import { ReportNav } from "../report-nav";

interface CashBookRow {
  business_day: string;
  cash_sales_paisa: number;
  khata_receipts_paisa: number;
  refunds_paisa: number;
  expenses_paisa: number;
  supplier_payments_paisa: number;
  net_cash_paisa: number;
}

export default async function CashBookPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("reports.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cash book</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view reports.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const params = await searchParams;
  const range = resolveReportRange(params.from, params.to) ?? defaultReportRange(businessToday());

  // Admin client because get_cash_book is service_role-only: it takes an explicit tenant id, which
  // is supplied from the caller's own validated context here and never from the query string.
  const admin = createAdminClient();
  const { data } = await admin.rpc("get_cash_book", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = (data ?? []) as CashBookRow[];

  const totals = rows.reduce(
    (acc, r) => ({
      cashSales: acc.cashSales + r.cash_sales_paisa,
      khata: acc.khata + r.khata_receipts_paisa,
      refunds: acc.refunds + r.refunds_paisa,
      expenses: acc.expenses + r.expenses_paisa,
      supplier: acc.supplier + r.supplier_payments_paisa,
      net: acc.net + r.net_cash_paisa,
    }),
    { cashSales: 0, khata: 0, refunds: 0, expenses: 0, supplier: 0, net: 0 },
  );

  // Days with no cash movement at all are dropped from the table -- the RPC returns every day in
  // the range so gaps are visible as gaps, but a month of empty rows buries the days that matter.
  const activeRows = rows.filter(
    (r) =>
      r.cash_sales_paisa !== 0 ||
      r.khata_receipts_paisa !== 0 ||
      r.refunds_paisa !== 0 ||
      r.expenses_paisa !== 0 ||
      r.supplier_payments_paisa !== 0,
  );

  return (
    <div className="flex flex-col gap-6">
      <ReportNav current="/reports/cash-book" />
      <div>
        <h1 className="text-2xl font-semibold">Cash book</h1>
        <p className="text-muted-foreground">
          Physical cash in and out, per business day (Pakistan time).
        </p>
      </div>

      <ReportRangePicker basePath="/reports/cash-book" from={range.from} to={range.to} />

      <Card>
        <CardHeader>
          <CardTitle>
            {range.from} to {range.to}
          </CardTitle>
          <CardDescription>
            Net cash movement: <strong>{formatPKR(totals.net)}</strong> across{" "}
            {activeRows.length} active day{activeRows.length === 1 ? "" : "s"}. This is cash
            movement only — khata sales and bank transfers are deliberately excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No cash moved in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Cash sales</TableHead>
                    <TableHead className="text-right">Khata received</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Supplier paid</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeRows.map((row) => (
                    <TableRow key={row.business_day}>
                      <TableCell>{row.business_day}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPKR(row.cash_sales_paisa)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPKR(row.khata_receipts_paisa)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.refunds_paisa ? `−${formatPKR(row.refunds_paisa)}` : formatPKR(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.expenses_paisa ? `−${formatPKR(row.expenses_paisa)}` : formatPKR(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.supplier_payments_paisa
                          ? `−${formatPKR(row.supplier_payments_paisa)}`
                          : formatPKR(0)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          row.net_cash_paisa < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatPKR(row.net_cash_paisa)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPKR(totals.cashSales)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPKR(totals.khata)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      −{formatPKR(totals.refunds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      −{formatPKR(totals.expenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      −{formatPKR(totals.supplier)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${totals.net < 0 ? "text-destructive" : ""}`}
                    >
                      {formatPKR(totals.net)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
