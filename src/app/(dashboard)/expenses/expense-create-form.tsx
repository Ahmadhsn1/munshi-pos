"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toPaisa } from "@/lib/money";

interface ExpenseCategory {
  id: string;
  name: string;
}

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "Easypaisa" },
];

export function ExpenseCreateForm({ categories }: { categories: ExpenseCategory[] }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [note, setNote] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  // Defaults ON for cash because paying chai or a rickshaw straight out of the till is the common
  // case in a shop; the owner paying rent by bank transfer will already be switching the mode.
  const [paidFromCounterCash, setPaidFromCounterCash] = useState(true);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!categoryId) {
      toast.error("Pick a category");
      return;
    }

    // toPaisa is the only sanctioned float->integer boundary (absolute rule 1). It throws on
    // nonsense input rather than silently rounding it into a wrong amount of money.
    let amountPaisa: number;
    try {
      amountPaisa = toPaisa(amountRupees);
    } catch {
      toast.error("Enter a valid amount");
      return;
    }

    if (amountPaisa <= 0) {
      toast.error("Amount must be more than zero");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          amountPaisa,
          paymentMode,
          note: note || undefined,
          expenseDate: expenseDate || undefined,
          paidFromCounterCash: paymentMode === "cash" ? paidFromCounterCash : false,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to record expense");
        return;
      }

      // Says plainly whether this will move the drawer. If the user ticked "from counter cash" but
      // had no shift open, it silently would not have -- and finding that out at shift close, as an
      // unexplained variance, is exactly the confusion this whole feature exists to remove.
      toast.success(
        result.attachedToShift
          ? "Expense recorded — deducted from this shift's drawer"
          : "Expense recorded",
      );
      setAmountRupees("");
      setNote("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleAddCategory() {
    if (!newCategory.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCategory.trim() }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to add category");
        return;
      }

      toast.success(result.reactivated ? "Category restored" : "Category added");
      setNewCategory("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="amount">Amount (Rs)</Label>
          <Input
            id="amount"
            inputMode="decimal"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="paymentMode">Paid by</Label>
          <select
            id="paymentMode"
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="expenseDate">Date (optional)</Label>
          <Input
            id="expenseDate"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. chai for staff, rickshaw to market"
        />
      </div>

      {paymentMode === "cash" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={paidFromCounterCash}
            onChange={(e) => setPaidFromCounterCash(e.target.checked)}
            className="size-4"
          />
          <span>
            Paid from the counter drawer
            <span className="text-muted-foreground ml-1">
              — untick if this came from the office safe or your own pocket
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="newCategory">New category</Label>
            <Input
              id="newCategory"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Labour"
              className="w-48"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleAddCategory}
            disabled={loading || !newCategory.trim()}
          >
            Add
          </Button>
        </div>

        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Record expense"}
        </Button>
      </div>
    </form>
  );
}
