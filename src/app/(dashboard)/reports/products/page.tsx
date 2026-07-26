import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPKR } from "@/lib/money";
import { businessToday, defaultReportRange, formatBps, marginBps, resolveReportRange } from "@/lib/reports";
import { ReportRangePicker } from "../report-range-picker";
import { ReportNav } from "../report-nav";
import { ExportCsvLink } from "../export-csv-link";

interface ProductSalesRow {
  product_id: string;
  product_name: string;
  category_name: string | null;
  brand: string | null;
  quantity_sold_net: number;
  revenue_paisa: number;
  discount_paisa: number;
  cogs_paisa: number;
}

/**
 * Serves plan.md's "sales by item/category/brand" and "top/worst sellers" together: one query
 * (get_product_sales), sorted three ways client-side, rather than three RPCs returning the same
 * underlying rows. Category and brand are just grouping keys on the same product-level data.
 */
export default async function ProductSalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; group?: string }>;
}) {
  const context = await getActingUserContext();
  if (!context) redirect("/login");

  if (!context.permissions.has("reports.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Product sales</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view reports.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const params = await searchParams;
  const range = resolveReportRange(params.from, params.to) ?? defaultReportRange(businessToday());
  const groupBy = params.group === "category" || params.group === "brand" ? params.group : "product";

  const admin = createAdminClient();
  const { data } = await admin.rpc("get_product_sales", {
    p_tenant_id: context.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  const rows = (data ?? []) as ProductSalesRow[];

  const grouped =
    groupBy === "product"
      ? rows.map((r) => ({
          key: r.product_id,
          label: r.product_name,
          qty: r.quantity_sold_net,
          revenue: r.revenue_paisa,
          discount: r.discount_paisa,
          cogs: r.cogs_paisa,
        }))
      : Object.values(
          rows.reduce<Record<string, { key: string; label: string; qty: number; revenue: number; discount: number; cogs: number }>>(
            (acc, r) => {
              const label = (groupBy === "category" ? r.category_name : r.brand) ?? "(none)";
              const key = label;
              acc[key] ??= { key, label, qty: 0, revenue: 0, discount: 0, cogs: 0 };
              acc[key].qty += r.quantity_sold_net;
              acc[key].revenue += r.revenue_paisa;
              acc[key].discount += r.discount_paisa;
              acc[key].cogs += r.cogs_paisa;
              return acc;
            },
            {},
          ),
        );

  const sortedByRevenue = [...grouped].sort((a, b) => b.revenue - a.revenue);
  const worstSellers = [...grouped].filter((g) => g.qty > 0).sort((a, b) => a.qty - b.qty).slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <ReportNav current="/reports/products" />
      <div>
        <h1 className="text-2xl font-semibold">Product sales</h1>
        <p className="text-muted-foreground">
          Top and worst sellers by quantity/revenue, ex-tax. Group by product, category or brand.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <ReportRangePicker basePath="/reports/products" from={range.from} to={range.to} />
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2 text-sm">
            {(["product", "category", "brand"] as const).map((g) => (
              <a
                key={g}
                href={`/reports/products?from=${range.from}&to=${range.to}&group=${g}`}
                className={`rounded-md border px-3 py-1.5 capitalize ${
                  groupBy === g ? "bg-foreground text-background" : "hover:bg-muted"
                }`}
              >
                {g}
              </a>
            ))}
          </div>
          {/* Always exports per-product detail regardless of the group-by view above -- a
              shopkeeper opening this in Excel can pivot it themselves, and per-product is strictly
              more useful in a spreadsheet than a pre-aggregated category/brand rollup would be. */}
          <ExportCsvLink href={`/api/reports/products/export?from=${range.from}&to=${range.to}`} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Top sellers by revenue ({range.from} to {range.to})
          </CardTitle>
          <CardDescription>Revenue and discount shown are ex-tax (see day summary for tax).</CardDescription>
        </CardHeader>
        <CardContent>
          {sortedByRevenue.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sales in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="capitalize">{groupBy}</TableHead>
                    <TableHead className="text-right">Qty sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedByRevenue.map((row) => {
                    const bps = marginBps(row.revenue, row.cogs);
                    return (
                      <TableRow key={row.key}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.discount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPKR(row.cogs)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${bps < 0 ? "text-destructive" : ""}`}>
                          {formatBps(bps)}
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

      {groupBy === "product" && (
        <Card>
          <CardHeader>
            <CardTitle>Worst sellers (lowest quantity, excludes zero sales)</CardTitle>
          </CardHeader>
          <CardContent>
            {worstSellers.length === 0 ? (
              <p className="text-muted-foreground text-sm">Not enough data yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {worstSellers.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPKR(row.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
