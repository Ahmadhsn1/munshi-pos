import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { platformAdminNotifySchema } from "@/lib/validation";
import { writePlatformAdminAuditLog } from "@/lib/platform-admin-audit";
import { sendNotification } from "@/lib/notifications/send-notification";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getPlatformAdminContext();

  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = platformAdminNotifySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin.from("tenants").select("id, name").eq("id", id).maybeSingle();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const results = await sendNotification(admin, {
    tenantId: id,
    channels: parsed.data.channels,
    templateKey: parsed.data.templateKey,
    templateData: {
      tenantName: tenant.name,
      customSubject: parsed.data.customSubject,
      customBody: parsed.data.customBody,
    },
    sentByAdminId: context.id,
  });

  await writePlatformAdminAuditLog(admin, context, {
    action: "tenant.notify",
    targetTenantId: id,
    summary: `Sent "${parsed.data.templateKey}" notification to ${tenant.name} via ${parsed.data.channels.join(", ")}`,
    afterData: { results },
  });

  return NextResponse.json({ results });
}
