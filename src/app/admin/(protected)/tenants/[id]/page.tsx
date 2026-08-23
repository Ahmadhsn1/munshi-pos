import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { TenantStatusActions } from "./tenant-status-actions";
import { NotifyForm } from "./notify-form";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

export default async function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, phone, city, subscription_status, suspended_at, suspended_reason, trial_ends_at, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!tenant) {
    notFound();
  }

  const { data: ownerRole } = await admin.from("roles").select("id").eq("key", "owner").single();

  const [{ data: owner }, { count: productCount }, { count: saleCount30d }, { data: recentNotifications }] =
    await Promise.all([
      ownerRole
        ? admin.from("users").select("full_name, email, phone").eq("tenant_id", id).eq("role_id", ownerRole.id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", id),
      admin
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", id)
        .not("invoice_number", "is", null)
        .gte("completed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      admin
        .from("notification_log")
        .select("id, channel, template_key, status, error_message, created_at")
        .eq("tenant_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const availableChannels = {
    in_app: true,
    email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL && owner?.email),
    whatsapp: false, // sending not yet implemented -- see lib/notifications/channels/whatsapp.ts
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{tenant.name}</h1>
          <p className="text-muted-foreground">
            {tenant.slug} · {tenant.phone ?? "no phone"} {tenant.city ? `· ${tenant.city}` : ""}
          </p>
        </div>
        <Badge variant={tenant.subscription_status === "suspended" ? "destructive" : "secondary"}>
          {STATUS_LABEL[tenant.subscription_status] ?? tenant.subscription_status}
        </Badge>
      </div>

      {tenant.subscription_status === "suspended" && tenant.suspended_reason && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-sm">
            Suspended {tenant.suspended_at ? new Date(tenant.suspended_at).toLocaleDateString("en-PK") : ""}:{" "}
            {tenant.suspended_reason}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Trial ends</CardDescription>
            <CardTitle className="font-serif text-xl">{new Date(tenant.trial_ends_at).toLocaleDateString("en-PK")}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Products</CardDescription>
            <CardTitle className="font-serif text-xl tabular-nums">{productCount ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Sales, last 30 days</CardDescription>
            <CardTitle className="font-serif text-xl tabular-nums">{saleCount30d ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Owner contact</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {owner ? (
            <p>
              {owner.full_name} · {owner.email ?? "no email"} · {owner.phone ?? "no phone"}
            </p>
          ) : (
            <p className="text-muted-foreground">No owner found for this tenant.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription actions</CardTitle>
        </CardHeader>
        <CardContent>
          <TenantStatusActions tenantId={tenant.id} currentStatus={tenant.subscription_status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send notification</CardTitle>
        </CardHeader>
        <CardContent>
          <NotifyForm tenantId={tenant.id} availableChannels={availableChannels} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 -mt-2">
          {(recentNotifications ?? []).map((n) => (
            <div key={n.id} className="flex items-center justify-between border-t py-2 text-sm first:border-t-0">
              <span>
                {n.channel} · {n.template_key}
                {n.error_message ? ` — ${n.error_message}` : ""}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={n.status === "sent" ? "secondary" : "outline"}>{n.status}</Badge>
                <span className="text-muted-foreground text-xs">
                  {new Date(n.created_at).toLocaleString("en-PK")}
                </span>
              </span>
            </div>
          ))}
          {(recentNotifications ?? []).length === 0 && (
            <p className="text-muted-foreground py-2 text-center text-sm">No notifications sent yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
