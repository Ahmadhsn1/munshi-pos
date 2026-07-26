import { redirect } from "next/navigation";
import Link from "next/link";
import { getActingUserContext } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { TrialBanner } from "./trial-banner";

// Nav is driven by the ACTING user's permissions, not the session user's. While a cashier is PIN'd
// in at the counter the device is still running on the owner's Supabase session, so a
// session-derived nav would advertise Staff/Purchases/Suppliers to them -- every one of which the
// route layer now refuses anyway. Hiding what the acting user cannot use turns a confusing wall of
// 403s into a coherent screen, and keeps the UI and API layers telling the same story (plan.md
// Phase 6: "enforced at both UI and API layer").
//
// `permission: null` means "anyone signed in". /counter is deliberately open to everyone: it is
// how a cashier ends their own counter session and hands the device back.
const NAV_ITEMS: { href: string; label: string; permission: string | null }[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/pos", label: "Sell", permission: "sales.create" },
  { href: "/pos/sales", label: "Sales", permission: "sales.create" },
  { href: "/products", label: "Products", permission: "products.view" },
  { href: "/categories", label: "Categories", permission: "products.manage" },
  { href: "/inventory", label: "Inventory", permission: "inventory.view" },
  { href: "/purchases", label: "Purchases", permission: "purchases.manage" },
  { href: "/suppliers", label: "Suppliers", permission: "suppliers.manage" },
  { href: "/customers", label: "Customers", permission: "customers.manage" },
  { href: "/expenses", label: "Expenses", permission: "expenses.manage" },
  { href: "/reports/sales", label: "Reports", permission: "reports.view" },
  { href: "/audit", label: "Audit log", permission: "audit.view" },
  { href: "/staff", label: "Staff", permission: "users.manage" },
  { href: "/counter", label: "Counter", permission: null },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth: middleware already redirects unauthenticated requests to /login before this
  // layout ever renders, but a Server Component guard doesn't rely on middleware matcher config
  // staying correct forever.
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  const visibleNav = NAV_ITEMS.filter(
    (item) => item.permission === null || context.permissions.has(item.permission),
  );

  // Only fetched/shown for a real owner/manager session, never during a counter/cashier session --
  // subscription/billing status is a back-office concern a cashier ringing up sales has no need to
  // see, matching the same reasoning as hiding Staff/Purchases/etc. from them in the nav above.
  let trialEndsAt: string | null = null;
  if (!context.isCounterSession) {
    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from("tenants")
      .select("trial_ends_at")
      .eq("id", context.tenantId)
      .single();
    trialEndsAt = tenant?.trial_ends_at ?? null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      {trialEndsAt && <TrialBanner trialEndsAt={trialEndsAt} />}
      {context.isCounterSession && (
        // Without this the screen is indistinguishable from the owner's own, which is precisely
        // how an owner forgets the counter is still handed over and walks away from a logged-in
        // device -- and how a cashier fails to realise their actions are being attributed to them
        // by name in the audit log.
        <div className="flex items-center justify-between border-b bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span>
            Counter mode — <strong>{context.fullName}</strong> ({context.roleName}) is at the
            counter. Actions are recorded under this name.
          </span>
          <Link href="/counter" className="underline underline-offset-2">
            Switch or end
          </Link>
        </div>
      )}
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold">
            {context.tenantName}
          </Link>
          <nav className="text-muted-foreground flex flex-wrap gap-4 text-sm">
            {visibleNav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {context.fullName} · {context.roleName}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
