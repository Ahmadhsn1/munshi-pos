import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { businessToday } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

interface AuditRow {
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
  actor: { full_name: string } | null;
  session: { full_name: string } | null;
}

export async function GET(request: Request) {
  const context = await getActingUserContext();
  if (!context || !context.permissions.has("audit.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  const admin = createAdminClient();
  let query = admin
    .from("audit_log")
    .select("action, entity_type, summary, created_at, actor:actor_user_id(full_name), session:session_user_id(full_name)")
    .eq("tenant_id", context.tenantId)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (action) query = query.eq("action", action);

  const { data } = await query;
  const rows = (data ?? []) as unknown as AuditRow[];

  const csv = toCsv(rows, [
    {
      header: "When (Pakistan time)",
      value: (r) => new Date(r.created_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi" }),
    },
    { header: "Action", value: (r) => r.action },
    { header: "Entity", value: (r) => r.entity_type },
    { header: "By", value: (r) => r.actor?.full_name ?? "" },
    { header: "Device Session", value: (r) => r.session?.full_name ?? "" },
    { header: "Summary", value: (r) => r.summary },
  ]);

  return csvResponse(`audit-log-${businessToday()}.csv`, csv);
}
