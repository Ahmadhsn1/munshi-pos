import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { expenseVoidSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { formatPKR } from "@/lib/money";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("expenses.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = expenseVoidSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: expense } = await admin
    .from("expenses")
    .select("id, amount_paisa, voided_at, shift_id, expense_categories:category_id(name)")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!expense) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  if (expense.voided_at) {
    return NextResponse.json({ error: "This expense is already voided" }, { status: 409 });
  }

  // Voiding an expense that was paid from the drawer RAISES that shift's expected cash back up,
  // because the money never actually left. If the shift is already closed its recorded variance was
  // computed against the old figure and is not retroactively rewritten -- a closed shift is a
  // historical record, and silently editing a past variance would defeat the point of recording it.
  // The audit entry below is what ties the two together for anyone reconciling later.
  const { data: shift } = expense.shift_id
    ? await admin.from("shifts").select("status").eq("id", expense.shift_id).maybeSingle()
    : { data: null };

  // The `is null` guard makes a racing double-void a clean no-op rather than overwriting the
  // original voider and reason.
  const { data: updated, error } = await admin
    .from("expenses")
    .update({
      voided_at: new Date().toISOString(),
      voided_by: context.userId,
      void_reason: parsed.data.voidReason,
    })
    .eq("id", id)
    .is("voided_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!updated) {
    return NextResponse.json({ error: "This expense is already voided" }, { status: 409 });
  }

  const categoryName =
    (expense.expense_categories as unknown as { name: string } | null)?.name ?? "expense";

  await writeAuditLog(admin, context, {
    action: "expense.void",
    entityType: "expense",
    entityId: id,
    summary: `Voided ${formatPKR(expense.amount_paisa)} ${categoryName} expense: ${parsed.data.voidReason}`,
    beforeData: { amountPaisa: expense.amount_paisa, categoryName, voided: false },
    afterData: { voided: true, reason: parsed.data.voidReason },
  });

  return NextResponse.json({
    success: true,
    // Surfaced so the UI can warn that a already-closed shift's recorded variance now disagrees
    // with a recomputation, rather than leaving the owner to discover it in a report.
    affectedClosedShift: shift?.status === "closed",
  });
}
