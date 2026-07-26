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
import { Textarea } from "@/components/ui/textarea";
import { formatPKR } from "@/lib/money";

interface VarianceResult {
  expectedCashPaisa: number;
  actualCashPaisa: number;
  variancePaisa: number;
  breakdown?: {
    openingCashPaisa: number;
    saleCashInPaisa: number;
    customerPaymentCashInPaisa: number;
    refundCashOutPaisa: number;
    expenseCashOutPaisa: number;
  };
}

export function ShiftCloseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actualCash, setActualCash] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VarianceResult | null>(null);

  async function handleClose() {
    setLoading(true);
    try {
      const currentRes = await fetch("/api/pos/shifts/current");
      const currentBody = await currentRes.json();
      const shiftId = currentBody.shift?.id;

      if (!shiftId) {
        toast.error("No open shift found");
        return;
      }

      const res = await fetch(`/api/pos/shifts/${shiftId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualCashPaisa: Math.round(Number(actualCash) * 100) || 0,
          closingNote: note,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        toast.error(body.error ?? "Failed to close shift");
        return;
      }

      setResult(body);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setActualCash("");
          setNote("");
          if (result) router.refresh();
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline">Close shift</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close shift</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-2 text-sm">
            {/* Itemised so the cashier can actually check the expected figure against the drawer
                rather than being handed an unexplainable number and a shortage. */}
            {result.breakdown && (
              <dl className="text-muted-foreground grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b pb-2">
                <dt>Opening cash</dt>
                <dd className="text-right tabular-nums">
                  {formatPKR(result.breakdown.openingCashPaisa)}
                </dd>
                <dt>+ Cash sales</dt>
                <dd className="text-right tabular-nums">
                  {formatPKR(result.breakdown.saleCashInPaisa)}
                </dd>
                <dt>+ Khata payments received</dt>
                <dd className="text-right tabular-nums">
                  {formatPKR(result.breakdown.customerPaymentCashInPaisa)}
                </dd>
                <dt>− Cash refunds</dt>
                <dd className="text-right tabular-nums">
                  {formatPKR(result.breakdown.refundCashOutPaisa)}
                </dd>
                <dt>− Expenses from drawer</dt>
                <dd className="text-right tabular-nums">
                  {formatPKR(result.breakdown.expenseCashOutPaisa)}
                </dd>
              </dl>
            )}
            <p>Expected cash: {formatPKR(result.expectedCashPaisa)}</p>
            <p>Actual cash: {formatPKR(result.actualCashPaisa)}</p>
            <p className={result.variancePaisa !== 0 ? "text-destructive font-medium" : "font-medium"}>
              Variance: {result.variancePaisa >= 0 ? "+" : ""}
              {formatPKR(result.variancePaisa)}
            </p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="actualCash">Cash counted in drawer (Rs)</Label>
              <Input
                id="actualCash"
                inputMode="decimal"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="closingNote">Note (optional)</Label>
              <Textarea id="closingNote" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button disabled={loading} onClick={handleClose}>
                {loading ? "Closing..." : "Close shift"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
