import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { platformAdminTenantTrialSchema } from "@/lib/validation";
import { writePlatformAdminAuditLog } from "@/lib/platform-admin-audit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getPlatformAdminContext();

  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = platformAdminTenantTrialSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, trial_ends_at")
    .eq("id", id)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const { error } = await admin
    .from("tenants")
    .update({ trial_ends_at: parsed.data.trialEndsAt })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await writePlatformAdminAuditLog(admin, context, {
    action: "tenant.trial_extend",
    targetTenantId: id,
    summary: `Extended ${tenant.name}'s trial: ${tenant.trial_ends_at} -> ${parsed.data.trialEndsAt}`,
    beforeData: { trialEndsAt: tenant.trial_ends_at },
    afterData: { trialEndsAt: parsed.data.trialEndsAt },
  });

  return NextResponse.json({ success: true });
}
