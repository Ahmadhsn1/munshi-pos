import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

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
 *
 * Memoized at module scope -- safe because the client carries no per-request/per-user state
 * (`autoRefreshToken`/`persistSession` are both off, the key is static), so reusing it across
 * requests on a warm serverless instance can't leak anything between callers. Saves repeated
 * client construction on hot paths that call this more than once per request.
 */
let cachedAdminClient: SupabaseClient | null = null;

export function createAdminClient() {
  if (!cachedAdminClient) {
    cachedAdminClient = createSupabaseClient(
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
  return cachedAdminClient;
}
