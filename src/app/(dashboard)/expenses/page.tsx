import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { ExpenseCreateForm } from "./expense-create-form";
import { ExpenseVoidButton } from "./expense-void-button";

export default async function ExpensesPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("expenses.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Expenses</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to manage expenses.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const [{ data: categories }, { data: expenses }] = await Promise.all([
    supabase
      .from("expense_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("expenses")
      .select(
        "id, amount_paisa, payment_mode, note, expense_date, shift_id, voided_at, void_reason, expense_categories:category_id(name)",
      )
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const rows = (expenses ?? []).map((e) => ({
    id: e.id,
    amountPaisa: e.amount_paisa,
    paymentMode: e.payment_mode,
    note: e.note,
    expenseDate: e.expense_date,
    fromDrawer: e.shift_id !== null,
    voidedAt: e.voided_at,
    voidReason: e.void_reason,
    categoryName: (e.expense_categories as unknown as { name: string } | null)?.name ?? "-",
  }));

  // Voided rows are excluded from the total for the same reason they are excluded from the cash
  // book: the money never actually left. They stay VISIBLE in the list, with their reason, because
  // absolute rule 4 means a financial record is never hidden -- only marked.
  const liveTotal = rows
    .filter((r) => !r.voidedAt)
    .reduce((sum, r) => sum + r.amountPaisa, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <p className="text-muted-foreground">
            Shop kharcha — rent, bijli, chai, transport. Cash paid from the counter drawer is
            reconciled at shift close.
          </p>
        </div>
        <Link href="/reports/cash-book" className="text-sm hover:underline">
          Cash book →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Record an expense</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpenseCreateForm categories={categories ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent expenses</CardTitle>
          <CardDescription>
            Showing the latest {rows.length}. Live total on this page: {formatPKR(liveTotal)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No expenses recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={row.voidedAt ? "opacity-60" : undefined}>
                    <TableCell>{row.expenseDate}</TableCell>
                    <TableCell>
                      {row.categoryName}
                      {row.voidedAt && (
                        <Badge variant="outline" className="ml-2">
                          Voided
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[22rem] truncate">
                      {row.voidedAt ? `Voided: ${row.voidReason}` : (row.note ?? "-")}
                    </TableCell>
                    <TableCell>
                      {row.paymentMode.replace("_", " ")}
                      {row.fromDrawer && (
                        <span className="text-muted-foreground ml-1 text-xs">(drawer)</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${row.voidedAt ? "line-through" : ""}`}
                    >
                      {formatPKR(row.amountPaisa)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!row.voidedAt && <ExpenseVoidButton expenseId={row.id} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
