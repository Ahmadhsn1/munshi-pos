import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActingUserContext } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";

/**
 * Redirect target for a suspended tenant (see the (dashboard) layout's suspension gate). Sits
 * outside the (dashboard) route group -- same reasoning as /login -- so the escape route itself
 * isn't gated by the very layout it's escaping. Not in middleware's PUBLIC_PATHS either: it's an
 * ordinary authenticated route, the existing tenant-redirect logic just leaves it alone.
 */
export default async function AccountSuspendedPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_status, suspended_reason")
    .eq("id", context.tenantId)
    .single();

  // A reactivated tenant landing here directly (stale tab, bookmark) should just bounce onward
  // rather than see a suspension message that's no longer true.
  if (tenant?.subscription_status !== "suspended") {
    redirect("/dashboard");
  }

  const supportWhatsApp = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
  const contactHref = supportWhatsApp
    ? `https://wa.me/${supportWhatsApp.replace(/\D/g, "")}?text=${encodeURIComponent("Hi, my shop's account was suspended and I'd like to resolve it.")}`
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Account suspended</CardTitle>
          <CardDescription>{context.tenantName}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            {tenant?.suspended_reason ?? "Your subscription has been suspended."} Your data is safe
            and nothing has been deleted -- access is restored as soon as this is resolved.
          </p>
          {contactHref ? (
            <Link href={contactHref} target="_blank" className="text-sm font-medium underline underline-offset-2">
              Contact us to resolve this
            </Link>
          ) : (
            <p className="text-muted-foreground text-xs">Contact your account manager to resolve this.</p>
          )}
          <LogoutButton />
        </CardContent>
      </Card>
    </div>
  );
}
