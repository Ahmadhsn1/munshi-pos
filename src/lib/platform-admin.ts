import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PlatformAdminContext {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Resolves the signed-in platform admin, if any. A platform admin is a fully separate identity
 * space from tenant users (see 20260801100002_platform_admins.sql) -- a real auth.users row with
 * no corresponding public.users row, so this never touches current_tenant_id() or any tenant RLS
 * policy. Membership is checked server-side against public.platform_admins via the service-role
 * admin client (that table has zero client RLS policies, so this is the only way to read it).
 *
 * Wrapped in cache() from the start, same fix as getActingUserContext() in lib/permissions.ts --
 * every admin route/page calls this for its own auth check, and memoizing avoids re-running
 * auth.getUser() + the platform_admins lookup more than once per request.
 */
export const getPlatformAdminContext = cache(async (): Promise<PlatformAdminContext | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from("platform_admins")
    .select("id, full_name, email")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!adminRow) return null;

  return {
    id: adminRow.id,
    fullName: adminRow.full_name,
    email: adminRow.email,
  };
});
