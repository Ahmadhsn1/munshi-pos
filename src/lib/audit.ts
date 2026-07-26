import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActingUserContext } from "@/lib/permissions";

export interface AuditEntry {
  /** Dotted verb, e.g. "sale.void", "stock.adjust", "expense.create". */
  action: string;
  /** e.g. "sale", "product", "customer", "expense", "user". */
  entityType: string;
  /** Null for actions with no single subject row (a bulk import, say). */
  entityId?: string | null;
  /** Human-readable one-liner rendered directly in the owner's audit view. */
  summary: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}

/**
 * Appends one row to the audit log.
 *
 * Records BOTH identities from the acting context. `actor_user_id` is who actually did it -- the
 * cashier PIN'd in at the counter -- and `session_user_id` is whose real login the device was
 * running under. Only the first answers "which cashier did this"; only the second answers "on whose
 * device". A log with just one of them cannot settle the argument it exists to settle.
 *
 * NEVER THROWS, and deliberately so. A failed audit write must not roll back or reject the business
 * operation that triggered it: refusing to complete a sale because a logging insert failed would
 * strand a real customer at a real counter, which is a far worse outcome than a missing log line.
 * The failure is surfaced to the server console (and therefore the hosting platform's logs) rather
 * than swallowed -- silent failure is how the test-cleanup bug went unnoticed for five phases.
 *
 * Append-only by construction: this module exposes no update or delete path, matching stock_ledger's
 * discipline. Corrections are new rows.
 */
export async function writeAuditLog(
  admin: SupabaseClient,
  context: Pick<ActingUserContext, "tenantId" | "userId" | "sessionUserId">,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    session_user_id: context.sessionUserId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    summary: entry.summary,
    before_data: entry.beforeData ?? null,
    after_data: entry.afterData ?? null,
  });

  if (error) {
    console.error(
      `[audit] failed to record ${entry.action} on ${entry.entityType}${
        entry.entityId ? ` ${entry.entityId}` : ""
      }: ${error.message}`,
    );
  }
}
