import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS and column-level grants entirely -- this is a
 * deliberately privileged client, not a convenience shortcut. Only ever call this from:
 *   - Route Handlers explicitly marked `export const runtime = "nodejs"`
 *   - after the caller's own session/tenant has already been validated with getUser(), where
 *     that validated tenant_id is what scopes the privileged operation (never trust a
 *     client-supplied tenant_id for anything done through this client).
 *
 * The `server-only` import makes any accidental import from a Client Component a build-time
 * error instead of a leaked secret.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
