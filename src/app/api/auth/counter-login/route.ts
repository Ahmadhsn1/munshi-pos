import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCounterSessionToken } from "@/lib/counter-session";
import { COUNTER_COOKIE_NAME } from "@/lib/counter-cookie";
import { getSessionUserContext } from "@/lib/permissions";
import { verifyPin } from "@/lib/pin";
import { counterLoginSchema } from "@/lib/validation";

// Node.js runtime required: Node crypto (via lib/pin.ts) and the service-role client.
export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  // Deliberately the SESSION identity, not the acting one -- this is one of the few places that
  // genuinely means "whose real login is this device on". The caller must have a real,
  // already-authenticated session (an owner/manager device that's staying logged in);
  // counter-login never creates a new Supabase Auth session, it just records which staff member is
  // "at the counter" on top of that real session. Only `tenantId` is read below, which is
  // identical either way -- but resolving the acting context here would be circular in intent
  // (asking "who's at the counter" in the very handler that decides who's at the counter).
  const context = await getSessionUserContext();

  if (!context) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = counterLoginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { userId, pin } = parsed.data;
  const admin = createAdminClient();

  // Scoped by context.tenantId, which came from the caller's own validated session -- never from
  // client input -- so this can never be used to probe or brute-force another tenant's PINs.
  const { data: target } = await admin
    .from("users")
    .select("id, full_name, pin_hash, pin_salt, pin_attempts, pin_locked_until, is_active, roles:role_id(key)")
    .eq("id", userId)
    .eq("tenant_id", context.tenantId)
    .single();

  const role = target?.roles as unknown as { key: string } | null;

  if (!target || !target.is_active || !target.pin_hash || !target.pin_salt) {
    return NextResponse.json({ error: "PIN login not available for this user" }, { status: 400 });
  }

  if (target.pin_locked_until && new Date(target.pin_locked_until) > new Date()) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const isValid = verifyPin(pin, target.pin_hash, target.pin_salt);

  if (!isValid) {
    const attempts = target.pin_attempts + 1;
    const lockedOut = attempts >= MAX_ATTEMPTS;

    // DB-backed, not in-memory: Vercel functions are stateless/multi-instance, so an
    // in-process attempt counter would be unreliable across invocations.
    await admin
      .from("users")
      .update({
        pin_attempts: lockedOut ? 0 : attempts,
        pin_locked_until: lockedOut ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null,
      })
      .eq("id", userId);

    return NextResponse.json({ error: "Incorrect PIN" }, { status: 400 });
  }

  await admin.from("users").update({ pin_attempts: 0, pin_locked_until: null }).eq("id", userId);

  const { token, expiresAt } = createCounterSessionToken({
    userId: target.id,
    tenantId: context.tenantId,
    fullName: target.full_name,
    roleKey: role?.key ?? "cashier",
  });

  const response = NextResponse.json({
    success: true,
    fullName: target.full_name,
    roleKey: role?.key ?? "cashier",
  });

  response.cookies.set(COUNTER_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  return response;
}
