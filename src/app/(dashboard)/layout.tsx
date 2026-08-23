import { redirect } from "next/navigation";
import Link from "next/link";
import { getActingUserContext } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrialBanner } from "./trial-banner";
import { SidebarNav } from "./sidebar-nav";
import { MobileNav } from "./mobile-nav";

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth: middleware already redirects unauthenticated requests to /login before this
  // layout ever renders, but a Server Component guard doesn't rely on middleware matcher config
  // staying correct forever.
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  // Fetched unconditionally (unlike the trial banner's display below) because a suspended shop
  // must be locked out for cashiers too, not just owners/managers -- a genuinely suspended tenant
  // shouldn't let a cashier keep ringing up sales just because they're PIN'd in at the counter.
  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("trial_ends_at, subscription_status")
    .eq("id", context.tenantId)
    .single();

  if (tenant?.subscription_status === "suspended") {
    redirect("/account-suspended");
  }

  // Subscription/billing status is a back-office concern a cashier ringing up sales has no need to
  // see, matching the same reasoning as hiding Staff/Purchases/etc. from them in the nav below --
  // so the trial-countdown banner itself stays owner/manager-only even though the query above (and
  // the suspension redirect it feeds) now always runs.
  const trialEndsAt = !context.isCounterSession ? (tenant?.trial_ends_at ?? null) : null;

  return (
    <div className="flex min-h-screen flex-col">
      {trialEndsAt && <TrialBanner trialEndsAt={trialEndsAt} />}
      {context.isCounterSession && (
        // Without this the screen is indistinguishable from the owner's own, which is precisely
        // how an owner forgets the counter is still handed over and walks away from a logged-in
        // device -- and how a cashier fails to realise their actions are being attributed to them
        // by name in the audit log.
        <div className="bg-gold-soft text-gold-foreground flex items-center justify-between border-b px-6 py-2 text-sm">
          <span>
            Counter mode — <strong>{context.fullName}</strong> ({context.roleName}) is at the
            counter. Actions are recorded under this name.
          </span>
          <Link href="/counter" className="underline underline-offset-2">
            Switch or end
          </Link>
        </div>
      )}

      <div className="flex flex-1">
        <aside className="bg-sidebar border-sidebar-border hidden w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r p-3.5 md:flex">
          <Link href="/dashboard" className="border-sidebar-border flex items-center gap-2.5 border-b px-1 pb-3.5">
            <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md font-serif text-sm font-bold">
              {context.tenantName.trim().charAt(0).toUpperCase() || "S"}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13.5px] font-semibold">{context.tenantName}</div>
              <div className="text-ink-faint truncate text-[11px]">
                {context.roleName} · {context.fullName}
              </div>
            </div>
          </Link>

          <SidebarNav permissions={[...context.permissions]} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-card flex items-center justify-between border-b px-5 py-2.5">
            <div className="flex items-center gap-2">
              <MobileNav permissions={[...context.permissions]} />
              {/* Tenant name repeated here (collapsed on desktop, primary on mobile where the
                  sidebar is hidden) so the shop's identity is never entirely off-screen on a small
                  viewport. */}
              <Link href="/dashboard" className="font-semibold md:hidden">
                {context.tenantName}
              </Link>
            </div>
            <span className="text-muted-foreground hidden text-[13px] md:inline">
              {context.fullName} · {context.roleName}
            </span>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <div className="bg-gold-soft text-gold flex size-7 items-center justify-center rounded-full text-[11px] font-bold">
                {initials(context.fullName)}
              </div>
              <LogoutButton />
            </div>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
