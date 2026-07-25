import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { COUNTER_COOKIE_NAME } from "@/lib/counter-cookie";
import { verifyCounterSessionToken } from "@/lib/counter-session";

export interface UserContext {
  userId: string;
  tenantId: string;
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
 * Fetches the signed-in user's profile, role, and resolved permission set. This is the one place
 * Server Components/Route Handlers should go for "what can this user do" -- keeps role/permission
 * lookups consistent instead of re-querying ad hoc everywhere.
 */
export async function getCurrentUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id, full_name, roles:role_id(id, key, name)")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  const role = profile.roles as unknown as { id: string; key: string; name: string } | null;
  if (!role) return null;

  const permissions = await loadPermissionsForRole(supabase, role.id);

  return {
    userId: profile.id,
    tenantId: profile.tenant_id,
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
 * Resolves who is actually operating right now for POS purposes -- the real Supabase session
 * (owner/manager) OR, when a cashier has switched in via PIN counter-login, the cashier. Every
 * POS Route Handler authorizes against THIS identity's permissions, not the real session's --
 * that's the entire point of counter-login (a cashier acting with cashier-level permissions on
 * the owner's browser).
 *
 * Security-critical: the counter-session cookie's own `tenantId` claim is NEVER trusted. Its
 * `userId` is re-validated fresh against the database, scoped to the REAL session's tenant --
 * this is what stops a stale, forged, or cross-tenant cookie from attributing a sale to a
 * cashier who isn't actually present, or leaking into a different tenant if a different owner
 * logs into the same shared device later. A missing/invalid/stale/deactivated-cashier cookie
 * falls back to the real session's own identity (the owner/manager ringing up a sale directly).
 */
export async function getActingUserContext(): Promise<ActingUserContext | null> {
  const sessionContext = await getCurrentUserContext();
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
    fullName: cashier.full_name,
    roleKey: role.key,
    roleName: role.name,
    permissions,
    sessionUserId: sessionContext.userId,
    sessionRoleKey: sessionContext.roleKey,
    isCounterSession: true,
  };
}
