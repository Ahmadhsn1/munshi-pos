import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Finds the acting user's own currently-open shift, or null.
 *
 * Used to decide whether a cash movement recorded outside the POS -- a khata payment, a shop
 * expense -- physically passed through the counter drawer, and so must show up in that shift's
 * expected-cash reconciliation at close.
 *
 * Scoped to the acting user's OWN shift on purpose. If an owner records a cash khata payment while
 * a cashier has a shift open, that money did not necessarily go into the cashier's till (the owner
 * may well have pocketed it into the office safe), and silently charging it to the cashier's
 * drawer would manufacture a shortage the cashier then has to explain. No shift means the movement
 * simply isn't part of any drawer reconciliation, which is the honest answer when nobody was
 * accountable for a till at the time.
 */
export async function findOpenShiftIdForUser(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("shifts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("cashier_user_id", userId)
    .eq("status", "open")
    .maybeSingle();

  return data?.id ?? null;
}
