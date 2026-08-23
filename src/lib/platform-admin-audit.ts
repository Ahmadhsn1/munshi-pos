import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformAdminContext } from "@/lib/platform-admin";

export interface PlatformAdminAuditEntry {
  /** Dotted verb, e.g. "tenant.suspend", "tenant.reactivate", "tenant.notify". */
  action: string;
  /** Null for actions that aren't about a single tenant. */
  targetTenantId?: string | null;
  /** Human-readable one-liner. */
  summary: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}

/**
 * Appends one row to platform_admin_audit_log. Structural copy of lib/audit.ts#writeAuditLog's
 * discipline: NEVER THROWS (a failed audit write must not roll back the admin action that
 * triggered it -- the failure is logged to the server console instead of swallowed), and
 * append-only by construction (no update/delete export).
 */
export async function writePlatformAdminAuditLog(
  admin: SupabaseClient,
  context: Pick<PlatformAdminContext, "id">,
  entry: PlatformAdminAuditEntry,
): Promise<void> {
  const { error } = await admin.from("platform_admin_audit_log").insert({
    admin_id: context.id,
    target_tenant_id: entry.targetTenantId ?? null,
    action: entry.action,
    summary: entry.summary,
    before_data: entry.beforeData ?? null,
    after_data: entry.afterData ?? null,
  });

  if (error) {
    console.error(`[platform-admin-audit] failed to record ${entry.action}: ${error.message}`);
  }
}
