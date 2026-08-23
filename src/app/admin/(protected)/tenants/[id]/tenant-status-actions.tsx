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

type Status = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

/**
 * Every status change goes through this same confirm dialog -- suspending/cancelling a real
 * shop's access is destructive to the business relationship, not a one-click toggle, matching the
 * same reasoning as ExpenseVoidButton's confirm-dialog-over-window.confirm() precedent.
 */
export function TenantStatusActions({ tenantId, currentStatus }: { tenantId: string; currentStatus: Status }) {
  const router = useRouter();
  const [open, setOpen] = useState<Status | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm(status: Status) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reason.trim() || undefined }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to update status");
        return;
      }

      toast.success("Status updated");
      setOpen(null);
      setReason("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const allActions: { status: Status; label: string; variant: "default" | "destructive" | "outline"; needsReason: boolean }[] = [
    { status: "active", label: "Mark active", variant: "default", needsReason: false },
    { status: "past_due", label: "Mark past due", variant: "outline", needsReason: true },
    { status: "suspended", label: "Suspend", variant: "destructive", needsReason: true },
    { status: "cancelled", label: "Cancel", variant: "outline", needsReason: true },
  ];
  const actions = allActions.filter((a) => a.status !== currentStatus);

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Dialog key={action.status} open={open === action.status} onOpenChange={(v) => setOpen(v ? action.status : null)}>
          <DialogTrigger render={<Button variant={action.variant} size="sm">{action.label}</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{action.label}?</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <p className="text-muted-foreground text-sm">
                {action.status === "suspended"
                  ? "This shop's staff will be locked out of the dashboard on their next page load, including cashiers at the counter."
                  : "This changes the tenant's subscription status."}
              </p>
              {action.needsReason && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`reason-${action.status}`}>Reason</Label>
                  <Input
                    id={`reason-${action.status}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. subscription payment overdue"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)} disabled={loading}>
                Cancel
              </Button>
              <Button variant={action.variant} onClick={() => handleConfirm(action.status)} disabled={loading}>
                {loading ? "Saving…" : action.label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  );
}
