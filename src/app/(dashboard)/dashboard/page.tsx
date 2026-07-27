import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon, PackagePlusIcon, WalletIcon, BarChart3Icon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPKR } from "@/lib/money";
import { businessToday } from "@/lib/reports";
import { findOpenShiftIdForUser } from "@/lib/shifts";
import { DailySummaryCard } from "./daily-summary-card";
import { OnboardingChecklist } from "./onboarding-checklist";

interface QuickAction {
  href: string;
  label: string;
  icon: typeof PlusIcon;
  permission: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { href: "/pos", label: "New sale", icon: PlusIcon, permission: "sales.create" },
  { href: "/products", label: "Add product", icon: PackagePlusIcon, permission: "products.manage" },
  { href: "/expenses", label: "Record expense", icon: WalletIcon, permission: "expenses.manage" },
  { href: "/reports/sales", label: "View reports", icon: BarChart3Icon, permission: "reports.view" },
];

export default async function DashboardPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  let showOnboarding = false;
  let hasProducts = false;
  let hasCompletedSale = false;
  let todayRevenuePaisa = 0;
  let todayTransactionCount = 0;
  let khataOutstandingPaisa = 0;
  let lowStockProducts: { product_id: string; product_name: string; current_stock: number; reorder_level: number }[] = [];
  let openShift: { opening_cash_paisa: number; opened_at: string } | null = null;

  // All of this is a back-office snapshot -- hidden during a counter/cashier session for the same
  // reason the trial banner and nav groups already are: a cashier ringing up sales has no need to
  // see shop-wide khata totals or reorder alerts, and showing them would leak cost/margin-adjacent
  // context past the boundary cost_price.view exists to enforce.
  if (!context.isCounterSession) {
    const admin = createAdminClient();
    const today = businessToday();

    const [
      { count: productCount },
      { count: saleCount },
      { data: summaryRows },
      { data: khataSalePayments },
      { data: khataRefunds },
      { data: customerPayments },
      { data: lowStock },
      openShiftId,
    ] = await Promise.all([
      admin.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", context.tenantId),
      admin
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .not("invoice_number", "is", null),
      admin.rpc("get_sales_summary", { p_tenant_id: context.tenantId, p_from: today, p_to: today }),
      admin.from("sale_payments").select("amount_paisa").eq("tenant_id", context.tenantId).eq("payment_mode", "khata"),
      admin
        .from("sale_return_payments")
        .select("amount_paisa")
        .eq("tenant_id", context.tenantId)
        .eq("payment_mode", "khata"),
      admin.from("customer_payments").select("amount_paisa").eq("tenant_id", context.tenantId),
      admin.rpc("get_low_stock_products", { p_tenant_id: context.tenantId }),
      findOpenShiftIdForUser(admin, context.tenantId, context.userId),
    ]);

    hasProducts = (productCount ?? 0) > 0;
    hasCompletedSale = (saleCount ?? 0) > 0;
    showOnboarding = !hasCompletedSale;

    const todaySummary = summaryRows?.[0] as { revenue_paisa: number; transaction_count: number } | undefined;
    todayRevenuePaisa = todaySummary?.revenue_paisa ?? 0;
    todayTransactionCount = todaySummary?.transaction_count ?? 0;

    // Same definition as lib/khata.ts#computeKhataBalance (debits - credits), just totalled across
    // every customer instead of one -- a grand total needs no per-invoice aging, unlike the
    // /customers/aging report, which is why this doesn't reuse allocateFifoAging.
    const khataDebits = (khataSalePayments ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
    const khataCredits =
      (khataRefunds ?? []).reduce((sum, p) => sum + p.amount_paisa, 0) +
      (customerPayments ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);
    khataOutstandingPaisa = khataDebits - khataCredits;

    lowStockProducts = (lowStock ?? []).slice(0, 5);

    if (openShiftId) {
      const { data } = await admin
        .from("shifts")
        .select("opening_cash_paisa, opened_at")
        .eq("id", openShiftId)
        .single();
      openShift = data;
    }
  }

  const visibleActions = QUICK_ACTIONS.filter((a) => context.permissions.has(a.permission));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Welcome back, {context.fullName.split(" ")[0]}</h1>
        <p className="text-muted-foreground">{context.tenantName}</p>
      </div>

      {showOnboarding && (
        <OnboardingChecklist hasProducts={hasProducts} hasCompletedSale={hasCompletedSale} />
      )}

      {visibleActions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visibleActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                      <Icon className="size-4.5" />
                    </div>
                    <span className="text-[13px] font-semibold">{action.label}</span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {!context.isCounterSession && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-1">
              <CardDescription>Today&apos;s sales</CardDescription>
              <CardTitle className="font-serif text-2xl tabular-nums">{formatPKR(todayRevenuePaisa)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                {todayTransactionCount} transaction{todayTransactionCount === 1 ? "" : "s"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardDescription>Your shift</CardDescription>
              <CardTitle className="font-serif text-2xl tabular-nums">
                {openShift ? formatPKR(openShift.opening_cash_paisa) : "Closed"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                {openShift ? (
                  <>
                    <ClockIcon className="size-3" />
                    Opened {new Date(openShift.opened_at).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" })}
                  </>
                ) : (
                  <Link href="/counter" className="hover:text-foreground underline underline-offset-2">
                    Open a shift
                  </Link>
                )}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardDescription>Khata outstanding</CardDescription>
              <CardTitle
                className={`font-serif text-2xl tabular-nums ${khataOutstandingPaisa > 0 ? "text-debt" : ""}`}
              >
                {formatPKR(khataOutstandingPaisa)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/customers/aging" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
                View aging report
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardDescription>Low stock</CardDescription>
              <CardTitle className={`font-serif text-2xl tabular-nums ${lowStockProducts.length > 0 ? "text-gold" : ""}`}>
                {lowStockProducts.length} item{lowStockProducts.length === 1 ? "" : "s"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/inventory" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
                {lowStockProducts.length > 0 ? "Needs reorder" : "View inventory"}
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {lowStockProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Products at or below their reorder level.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 -mt-2">
            {lowStockProducts.map((p) => (
              <div key={p.product_id} className="flex items-center justify-between border-t py-2.5 first:border-t-0">
                <span className="text-sm font-medium">{p.product_name}</span>
                <Badge className="bg-gold-soft text-gold-foreground border-transparent">
                  {p.current_stock} left · reorder at {p.reorder_level}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {context.permissions.has("reports.view") && <DailySummaryCard />}

      {context.roleKey === "owner" && (
        <Card>
          <CardHeader>
            <CardTitle>Backup</CardTitle>
            <CardDescription>
              Download a complete copy of your shop&apos;s data -- every product, sale, purchase,
              customer, and ledger entry -- as one file. Owner-only: this is the single most
              complete export the app can produce.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href="/api/backup/export">Export all my data</a>}
            />
          </CardContent>
        </Card>
      )}

      {context.permissions.has("users.manage") && (
        <Card>
          <CardHeader>
            <CardTitle>Staff</CardTitle>
            <CardDescription>
              You can manage staff accounts and PINs.{" "}
              <Link href="/staff" className="underline">
                Go to staff
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
