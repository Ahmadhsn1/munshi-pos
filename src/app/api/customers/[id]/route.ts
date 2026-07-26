import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { customerUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { formatPKR } from "@/lib/money";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("customers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customerUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.phone !== undefined) update.phone = input.phone || null;
  if (input.creditLimitPaisa !== undefined) update.credit_limit_paisa = input.creditLimitPaisa;
  if (input.priceTier !== undefined) update.price_tier = input.priceTier || null;
  if (input.isBlacklisted !== undefined) update.is_blacklisted = input.isBlacklisted;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Read the pre-update row only when a sensitive field is actually changing -- credit limit and
  // blacklist are the two customer fields that directly gate whether a sale is allowed to
  // proceed on khata, so a change to either is worth a before/after trail.
  const touchesSensitiveField = "credit_limit_paisa" in update || "is_blacklisted" in update;
  const { data: before } = touchesSensitiveField
    ? await admin
        .from("customers")
        .select("name, credit_limit_paisa, is_blacklisted")
        .eq("id", id)
        .eq("tenant_id", context.tenantId)
        .maybeSingle()
    : { data: null };

  const { data, error } = await admin
    .from("customers")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    const message = error.message.includes("duplicate")
      ? "A customer with this phone number already exists"
      : "Failed to update customer";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  if (before) {
    const changes: string[] = [];
    if ("credit_limit_paisa" in update && update.credit_limit_paisa !== before.credit_limit_paisa) {
      const from = before.credit_limit_paisa == null ? "none" : formatPKR(before.credit_limit_paisa);
      const to =
        update.credit_limit_paisa == null ? "none" : formatPKR(update.credit_limit_paisa as number);
      changes.push(`credit limit ${from} → ${to}`);
    }
    if ("is_blacklisted" in update && update.is_blacklisted !== before.is_blacklisted) {
      changes.push(update.is_blacklisted ? "blacklisted" : "un-blacklisted");
    }

    if (changes.length > 0) {
      await writeAuditLog(admin, context, {
        action: "customer.credit_change",
        entityType: "customer",
        entityId: id,
        summary: `${before.name}: ${changes.join(", ")}`,
        beforeData: {
          creditLimitPaisa: before.credit_limit_paisa,
          isBlacklisted: before.is_blacklisted,
        },
        afterData: {
          creditLimitPaisa: update.credit_limit_paisa ?? before.credit_limit_paisa,
          isBlacklisted: update.is_blacklisted ?? before.is_blacklisted,
        },
      });
    }
  }

  return NextResponse.json({ success: true });
}
