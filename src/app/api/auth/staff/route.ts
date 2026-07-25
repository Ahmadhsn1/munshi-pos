import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/permissions";
import { hashPin, verifyPin } from "@/lib/pin";
import { staffCreateSchema } from "@/lib/validation";

// Uses the service-role client and Node's crypto -- must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = staffCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  const { data: role } = await admin.from("roles").select("id").eq("key", input.roleKey).single();

  if (!role) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const isManager = input.roleKey === "manager";

  // Cashiers get a synthetic, non-deliverable email + a random password they never see or use --
  // they only ever authenticate through the PIN counter-login flow, never a real session of
  // their own. Scoping the domain to this tenant's id keeps it trivially unique across tenants.
  const email = isManager ? input.email : `${randomBytes(8).toString("hex")}@${context.tenantId}.staff.internal`;
  const password = isManager ? input.password : randomBytes(24).toString("hex");

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    const message = createError?.message.includes("already been registered")
      ? "An account with this email already exists"
      : (createError?.message ?? "Failed to create staff account");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let pinHash: string | null = null;
  let pinSalt: string | null = null;

  if (input.pin) {
    // Enforce PIN uniqueness within the tenant -- two staff sharing a PIN makes counter-login
    // attribution ambiguous/wrong. There's no way to index a salted hash for direct lookup, so
    // this means checking the candidate against every active staff member's stored hash.
    const { data: activeStaff } = await admin
      .from("users")
      .select("pin_hash, pin_salt")
      .eq("tenant_id", context.tenantId)
      .eq("is_active", true)
      .not("pin_hash", "is", null);

    const collision = (activeStaff ?? []).some(
      (staff) =>
        staff.pin_hash && staff.pin_salt && verifyPin(input.pin as string, staff.pin_hash, staff.pin_salt),
    );

    if (collision) {
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json(
        { error: "That PIN is already in use by another staff member" },
        { status: 400 },
      );
    }

    const hashed = hashPin(input.pin);
    pinHash = hashed.hash;
    pinSalt = hashed.salt;
  }

  const { error: insertError } = await admin.from("users").insert({
    id: created.user.id,
    tenant_id: context.tenantId,
    role_id: role.id,
    full_name: input.fullName,
    phone: input.phone || null,
    email: isManager ? email : null,
    pin_hash: pinHash,
    pin_salt: pinSalt,
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "Failed to create staff profile" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
