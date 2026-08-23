import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

export default async function AdminDashboardPage() {
  const admin = createAdminClient();

  const [{ data: tenants }, { data: recentTenants }] = await Promise.all([
    admin.from("tenants").select("subscription_status"),
    admin
      .from("tenants")
      .select("id, name, subscription_status, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const countByStatus = new Map<string, number>();
  for (const t of tenants ?? []) {
    countByStatus.set(t.subscription_status, (countByStatus.get(t.subscription_status) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Platform overview</h1>
        <p className="text-muted-foreground">{(tenants ?? []).length} tenant(s) total.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(STATUS_LABEL).map(([status, label]) => (
          <Card key={status}>
            <CardHeader className="pb-1">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="font-serif text-2xl tabular-nums">
                {countByStatus.get(status) ?? 0}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent signups</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 -mt-2">
          {(recentTenants ?? []).map((t) => (
            <Link
              key={t.id}
              href={`/admin/tenants/${t.id}`}
              className="flex items-center justify-between border-t py-2.5 text-sm first:border-t-0 hover:underline"
            >
              <span className="font-medium">{t.name}</span>
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{STATUS_LABEL[t.subscription_status] ?? t.subscription_status}</Badge>
                <span className="text-muted-foreground text-xs">
                  {new Date(t.created_at).toLocaleDateString("en-PK")}
                </span>
              </span>
            </Link>
          ))}
          {(recentTenants ?? []).length === 0 && (
            <p className="text-muted-foreground py-2.5 text-center text-sm">No tenants yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
