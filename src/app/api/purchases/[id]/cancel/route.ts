import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";

// Draft-only, plain UPDATE -- nothing references a draft purchase yet (no receipts, no returns,
// no payments possible until confirmed), so there's no atomicity concern requiring an RPC.
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("purchases")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to cancel purchase" }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Only a draft purchase can be cancelled" }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
