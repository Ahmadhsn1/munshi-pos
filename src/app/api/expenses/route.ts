import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { findOpenShiftIdForUser } from "@/lib/shifts";
import { expenseCreateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { formatPKR } from "@/lib/money";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("expenses.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = expenseCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  // Scoped to the caller's own tenant, so a category id guessed or copied from another shop is
  // rejected here rather than relying solely on the DB consistency trigger to catch it.
  const { data: category } = await admin
    .from("expense_categories")
    .select("id, name")
    .eq("id", input.categoryId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  // Only cash can leave a cash drawer, and only if the user said it did. `paidFromCounterCash` is
  // an explicit answer, not an inference from paymentMode: cash from the office safe is still a
  // cash expense but must not depress the cashier's expected drawer total and manufacture a
  // shortage they then have to explain.
  const shiftId =
    input.paymentMode === "cash" && input.paidFromCounterCash
      ? await findOpenShiftIdForUser(admin, context.tenantId, context.userId)
      : null;

  const { data, error } = await admin
    .from("expenses")
    .insert({
      tenant_id: context.tenantId,
      category_id: input.categoryId,
      amount_paisa: input.amountPaisa,
      payment_mode: input.paymentMode,
      note: input.note || null,
      expense_date: input.expenseDate || undefined,
      shift_id: shiftId,
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to record expense" },
      { status: 400 },
    );
  }

  await writeAuditLog(admin, context, {
    action: "expense.create",
    entityType: "expense",
    entityId: data.id,
    summary: `Recorded ${formatPKR(input.amountPaisa)} expense under ${category.name}`,
    afterData: {
      categoryName: category.name,
      amountPaisa: input.amountPaisa,
      paymentMode: input.paymentMode,
      fromCounterCash: shiftId !== null,
    },
  });

  return NextResponse.json({ success: true, expenseId: data.id, attachedToShift: shiftId !== null });
}
