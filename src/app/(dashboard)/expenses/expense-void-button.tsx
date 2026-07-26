"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Voiding asks for a reason in a dialog rather than firing on click. Two reasons: absolute rule 4
 * requires a reason on every soft-delete of a financial record, and a one-click destructive action
 * on a money row is exactly the kind of thing a busy shopkeeper mis-taps.
 *
 * Deliberately not a window.confirm() -- a native modal dialog blocks the whole page and cannot
 * collect the required reason anyway.
 */
export function ExpenseVoidButton({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleVoid() {
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/expenses/${expenseId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voidReason: reason.trim() }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to void expense");
        return;
      }

      // A closed shift's variance was computed against the old figure and is NOT rewritten -- a
      // closed shift is a historical record. Saying so here means the owner learns it now, rather
      // than being confused by it later in a report.
      toast.success(
        result.affectedClosedShift
          ? "Expense voided. Note: this expense was part of an already-closed shift, whose recorded variance is left as it was."
          : "Expense voided",
      );
      setOpen(false);
      setReason("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Void
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this expense?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            The record is kept and marked as voided — financial records are never deleted. If it was
            paid from the counter drawer, that cash is added back to the shift&apos;s expected total.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="voidReason">Reason</Label>
            <Input
              id="voidReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. entered twice by mistake"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleVoid} disabled={loading || !reason.trim()}>
            {loading ? "Voiding…" : "Void expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
