import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { COUNTER_COOKIE_NAME } from "@/lib/counter-cookie";
import { verifyCounterSessionToken } from "@/lib/counter-session";

export interface UserContext {
  userId: string;
  tenantId: string;
  /** The shop's own name -- shown in the header and used in outbound WhatsApp text. */
  tenantName: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  permissions: Set<string>;
}

async function loadPermissionsForRole(
  supabase: SupabaseClient,
  roleId: string,
): Promise<Set<string>> {
  const { data: rolePerms } = await supabase
    .from("role_permissions")
    .select("permissions:permission_id(key)")
    .eq("role_id", roleId);

  return new Set(
    (rolePerms ?? [])
      .map((rp) => (rp.permissions as unknown as { key: string } | null)?.key)
      .filter((key): key is string => Boolean(key)),
  );
}

/**
 * Resolves the REAL Supabase Auth session's user -- the owner/manager whose login the device is
 * running under, regardless of who may currently be PIN'd in at the counter.
 *
 * Almost nothing should call this. It answers "whose device/login is this", NOT "who is allowed to
 * do this" -- authorize with getActingUserContext() instead. Using this for a permission check is
 * precisely the bug described there: a cashier standing at an owner's logged-in device would be
 * authorized with the OWNER's permission set.
 */
export async function getSessionUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id, full_name, tenants:tenant_id(name), roles:role_id(id, key, name)")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  const role = profile.roles as unknown as { id: string; key: string; name: string } | null;
  if (!role) return null;

  const tenant = profile.tenants as unknown as { name: string } | null;

  const permissions = await loadPermissionsForRole(supabase, role.id);

  return {
    userId: profile.id,
    tenantId: profile.tenant_id,
    tenantName: tenant?.name ?? "Shop",
    fullName: profile.full_name,
    roleKey: role.key,
    roleName: role.name,
    permissions,
  };
}

export interface ActingUserContext extends UserContext {
  /** Who the real Supabase Auth session belongs to -- an owner/manager, possibly staying logged
   * in on a shared device all day. Equal to `userId` when there's no active counter-login. */
  sessionUserId: string;
  sessionRoleKey: string;
  /** True when a cashier is "at the counter" via PIN login on top of the real session above. */
  isCounterSession: boolean;
}

/**
 * Resolves who is actually operating right now -- the real Supabase session (owner/manager) OR,
 * when a cashier has switched in via PIN counter-login, the cashier. **This is the default and
 * correct source of truth for every authorization decision in the app**, in Server Components and
 * Route Handlers alike, not just at the POS.
 *
 * SECURITY HISTORY -- why this is the default rather than a POS-only helper. Originally only the
 * POS routes resolved the acting identity and every back-office page/route authorized against the
 * raw session instead. Because a counter-login is layered on top of an owner's still-live session
 * (see AGENTS.md), that meant a cashier PIN'd in at the counter could simply navigate to any
 * back-office screen -- Staff, Purchases, Inventory -- and be authorized as the OWNER: creating
 * staff accounts, adjusting stock, paying suppliers and reading every cost price. The role model
 * only actually held on the one screen the cashier was supposed to be restricted to. Resolving the
 * acting identity everywhere is what closes that, so prefer this function unconditionally; reach
 * for getSessionUserContext() only when you genuinely mean "whose login is this device on".
 *
 * Security-critical: the counter-session cookie's own `tenantId` claim is NEVER trusted. Its
 * `userId` is re-validated fresh against the database, scoped to the REAL session's tenant --
 * this is what stops a stale, forged, or cross-tenant cookie from attributing a sale to a
 * cashier who isn't actually present, or leaking into a different tenant if a different owner
 * logs into the same shared device later. A missing/invalid/stale/deactivated-cashier cookie
 * falls back to the real session's own identity (the owner/manager ringing up a sale directly).
 */
export async function getActingUserContext(): Promise<ActingUserContext | null> {
  const sessionContext = await getSessionUserContext();
  if (!sessionContext) return null;

  const cookieStore = await cookies();
  const counterPayload = verifyCounterSessionToken(cookieStore.get(COUNTER_COOKIE_NAME)?.value);

  const fallback: ActingUserContext = {
    ...sessionContext,
    sessionUserId: sessionContext.userId,
    sessionRoleKey: sessionContext.roleKey,
    isCounterSession: false,
  };

  if (!counterPayload) {
    return fallback;
  }

  const admin = createAdminClient();
  const { data: cashier } = await admin
    .from("users")
    .select("id, full_name, is_active, roles:role_id(id, key, name)")
    .eq("id", counterPayload.userId)
    .eq("tenant_id", sessionContext.tenantId) // the REAL session's tenant, never the cookie's claim
    .eq("is_active", true)
    .maybeSingle();

  if (!cashier) {
    // Stale/forged/cross-tenant cookie, or the cashier was deactivated mid-shift.
    return fallback;
  }

  const role = cashier.roles as unknown as { id: string; key: string; name: string } | null;
  if (!role) return fallback;

  const permissions = await loadPermissionsForRole(admin, role.id);

  return {
    userId: cashier.id,
    tenantId: sessionContext.tenantId,
    // Same shop either way -- the counter-login is scoped to the session's tenant above.
    tenantName: sessionContext.tenantName,
    fullName: cashier.full_name,
    roleKey: role.key,
    roleName: role.name,
    permissions,
    sessionUserId: sessionContext.userId,
    sessionRoleKey: sessionContext.roleKey,
    isCounterSession: true,
  };
}
