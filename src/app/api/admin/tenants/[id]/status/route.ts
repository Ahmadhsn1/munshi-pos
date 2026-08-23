import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { platformAdminTenantStatusSchema } from "@/lib/validation";
import { writePlatformAdminAuditLog } from "@/lib/platform-admin-audit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getPlatformAdminContext();

  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = platformAdminTenantStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, subscription_status")
    .eq("id", id)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const reason = parsed.data.reason || null;
  const isSuspending = parsed.data.status === "suspended";

  const { error } = await admin
    .from("tenants")
    .update({
      subscription_status: parsed.data.status,
      suspended_at: isSuspending ? new Date().toISOString() : null,
      suspended_reason: isSuspending ? reason : null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await writePlatformAdminAuditLog(admin, context, {
    action: "tenant.status_change",
    targetTenantId: id,
    summary: `Changed ${tenant.name}'s subscription status: ${tenant.subscription_status} -> ${parsed.data.status}${reason ? ` (${reason})` : ""}`,
    beforeData: { subscriptionStatus: tenant.subscription_status },
    afterData: { subscriptionStatus: parsed.data.status, reason },
  });

  return NextResponse.json({ success: true });
}
