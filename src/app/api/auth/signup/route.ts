import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signupSchema } from "@/lib/validation";

// Uses the service-role client (createAdminClient) and Node's crypto indirectly via the admin
// SDK -- must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { tenantName, tenantSlug, ownerFullName, ownerEmail, ownerPhone, password } = parsed.data;
  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    const message = createError?.message.includes("already been registered")
      ? "An account with this email already exists"
      : (createError?.message ?? "Failed to create account");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // tenants + owner-user insert happens in one Postgres transaction (bootstrap_tenant), because
  // this HTTP call and the RPC call can never share a transaction with each other -- if the RPC
  // fails, we must not leave an orphaned auth.users row with no tenant attached.
  const { error: bootstrapError } = await admin.rpc("bootstrap_tenant", {
    p_owner_id: created.user.id,
    p_tenant_name: tenantName,
    p_tenant_slug: tenantSlug,
    p_owner_full_name: ownerFullName,
    p_owner_email: ownerEmail,
    p_owner_phone: ownerPhone || null,
  });

  if (bootstrapError) {
    await admin.auth.admin.deleteUser(created.user.id);

    const message = bootstrapError.message.includes("duplicate key")
      ? "That shop URL is already taken"
      : "Failed to set up your shop. Please try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
