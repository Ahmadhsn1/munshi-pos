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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const REASONS = [
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft" },
  { value: "wastage", label: "Wastage" },
  { value: "recount", label: "Recount" },
  { value: "other", label: "Other" },
];

export function StockAdjustmentDialog({
  productId,
  productName,
  currentStock,
  unitName,
}: {
  productId: string;
  productName: string;
  currentStock: number;
  unitName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const delta = Number(quantityDelta);
  const resultingStock = Number.isFinite(delta) ? currentStock + delta : currentStock;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!quantityDelta || delta === 0) {
      toast.error("Enter a non-zero adjustment quantity");
      return;
    }
    if (!reasonCode) {
      toast.error("Select a reason");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantityDelta: delta, reasonCode, note }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to record adjustment");
        return;
      }

      toast.success(`Stock updated: ${result.currentStock} ${unitName}`);
      setQuantityDelta("");
      setReasonCode("");
      setNote("");
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Adjust
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock: {productName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="quantityDelta">
              Adjustment ({unitName}) -- positive to add, negative to remove
            </Label>
            <Input
              id="quantityDelta"
              inputMode="numeric"
              value={quantityDelta}
              onChange={(e) => setQuantityDelta(e.target.value.replace(/[^-\d]/g, ""))}
              placeholder="e.g. -5 or 20"
            />
            {quantityDelta && (
              <p className="text-muted-foreground text-sm">
                {currentStock} {unitName} → {resultingStock} {unitName}
                {resultingStock < 0 && (
                  <span className="text-destructive"> (will go negative -- confirm this is correct)</span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Reason</Label>
            <Select
              items={Object.fromEntries(REASONS.map((r) => [r.value, r.label]))}
              value={reasonCode}
              onValueChange={(value) => setReasonCode(value ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
