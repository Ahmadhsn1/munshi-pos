import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { createAdminClient } from "@/lib/supabase/admin";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

const STATUSES = Object.keys(STATUS_LABEL);

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const admin = createAdminClient();

  let query = admin
    .from("tenants")
    .select("id, name, slug, phone, city, subscription_status, trial_ends_at, created_at")
    .order("created_at", { ascending: false });

  if (status && STATUSES.includes(status)) {
    query = query.eq("subscription_status", status);
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},slug.ilike.${term},phone.ilike.${term}`);
  }

  const { data: tenants } = await query;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Tenants</h1>
        <p className="text-muted-foreground">{(tenants ?? []).length} shown.</p>
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-center gap-2" method="get">
            <Input name="q" defaultValue={q ?? ""} placeholder="Search name, slug, phone…" className="max-w-xs" />
            <div className="flex flex-wrap gap-1">
              <Link href="/admin/tenants">
                <Badge variant={!status ? "default" : "outline"} className="cursor-pointer">
                  All
                </Badge>
              </Link>
              {STATUSES.map((s) => (
                <Link key={s} href={`/admin/tenants?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
                  <Badge variant={status === s ? "default" : "outline"} className="cursor-pointer">
                    {STATUS_LABEL[s]}
                  </Badge>
                </Link>
              ))}
            </div>
          </form>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trial ends</TableHead>
                <TableHead>Signed up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tenants ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/admin/tenants/${t.id}`} className="hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {t.phone ?? "-"} {t.city ? `· ${t.city}` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.subscription_status === "suspended" ? "destructive" : "secondary"}>
                      {STATUS_LABEL[t.subscription_status] ?? t.subscription_status}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(t.trial_ends_at).toLocaleDateString("en-PK")}</TableCell>
                  <TableCell>{new Date(t.created_at).toLocaleDateString("en-PK")}</TableCell>
                </TableRow>
              ))}
              {(tenants ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    No tenants match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
