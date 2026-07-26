import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
  actor: { full_name: string } | null;
  session: { full_name: string } | null;
}

/**
 * Owner-only by permission (audit.view), and audit_log ALSO has no client-readable RLS policy at
 * all (20260726100006_audit_log.sql) -- this page reads it through the admin client after an
 * explicit permission check, the same two-layer belt-and-braces every audit_log access uses.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string }>;
}) {
  const context = await getActingUserContext();
  if (!context) redirect("/login");

  if (!context.permissions.has("audit.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view the audit log. This
            is intentionally owner-only.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const params = await searchParams;
  const admin = createAdminClient();

  let query = admin
    .from("audit_log")
    .select("id, action, entity_type, summary, created_at, actor:actor_user_id(full_name), session:session_user_id(full_name)")
    .eq("tenant_id", context.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (params.action) query = query.eq("action", params.action);
  if (params.entity) query = query.eq("entity_type", params.entity);

  const { data } = await query;
  const rows = (data ?? []) as unknown as AuditRow[];

  const ACTION_FILTERS = [
    "sale.void",
    "sale.return",
    "stock.adjust",
    "product.price_change",
    "customer.credit_change",
    "expense.create",
    "expense.void",
    "staff.create",
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-muted-foreground">
          Every money- and stock-affecting action, in order. Read-only, owner-only, never edited.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <a
          href="/audit"
          className={`rounded-md border px-3 py-1.5 ${!params.action ? "bg-foreground text-background" : "hover:bg-muted"}`}
        >
          All
        </a>
        {ACTION_FILTERS.map((a) => (
          <a
            key={a}
            href={`/audit?action=${a}`}
            className={`rounded-md border px-3 py-1.5 ${params.action === a ? "bg-foreground text-background" : "hover:bg-muted"}`}
          >
            {a}
          </a>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest {rows.length} entries</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No matching entries.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    // isCounterSession-equivalent: actor differs from the real session's user only
                    // when a cashier was PIN'd in at the counter at the time.
                    const differentActor = row.actor?.full_name !== row.session?.full_name;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(row.created_at).toLocaleString("en-PK", {
                            timeZone: "Asia/Karachi",
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.action}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.actor?.full_name ?? "-"}
                          {differentActor && row.session?.full_name && (
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              (on {row.session.full_name}&apos;s device)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-md">{row.summary}</TableCell>
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
