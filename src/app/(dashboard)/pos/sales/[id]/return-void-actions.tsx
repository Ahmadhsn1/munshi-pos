"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface SaleLine {
  id: string;
  productName: string;
  quantity: number;
  unitPricePaisa: number;
  taxPaisa: number;
  remaining: number;
}

// Mirrors record_sale_return's own prorated-tax math exactly (tax split by quantity against the
// line's original recorded tax, same rounding) -- otherwise the refund total shown/submitted here
// drifts from what the RPC computes and every taxed return fails with a payments-mismatch error.
function returnLineTotalPaisa(line: SaleLine, returnQuantity: number) {
  const proratedTax = Math.round((line.taxPaisa * returnQuantity) / line.quantity);
  return line.unitPricePaisa * returnQuantity + proratedTax;
}

const REASONS = [
  { value: "defective", label: "Defective" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "customer_changed_mind", label: "Customer changed mind" },
  { value: "other", label: "Other" },
];

function ReturnDialog({ saleId, lines }: { saleId: string; lines: SaleLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasonCode, setReasonCode] = useState("");
  const [refundMode, setRefundMode] = useState("cash");
  const [loading, setLoading] = useState(false);

  const returnable = lines.filter((l) => l.remaining > 0);

  async function handleSubmit() {
    const selectedLines = returnable
      .map((line) => ({ saleLineItemId: line.id, quantity: Number(quantities[line.id] || 0), line }))
      .filter((l) => l.quantity > 0);

    if (selectedLines.length === 0) {
      toast.error("Select at least one item to return");
      return;
    }
    if (!reasonCode) {
      toast.error("Select a reason");
      return;
    }

    const refundTotal = selectedLines.reduce(
      (sum, l) => sum + returnLineTotalPaisa(l.line, l.quantity),
      0,
    );

    setLoading(true);
    try {
      const res = await fetch(`/api/pos/sales/${saleId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reasonCode,
          lines: selectedLines.map((l) => ({ saleLineItemId: l.saleLineItemId, quantity: l.quantity })),
          refundPayments: [{ paymentMode: refundMode, amountPaisa: refundTotal }],
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to process return");
        return;
      }

      toast.success(`Return ${result.returnNumber} recorded`);
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Process return</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Return items</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {returnable.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {line.productName} ({line.remaining} returnable)
              </span>
              <Input
                type="number"
                min={0}
                max={line.remaining}
                className="w-20"
                value={quantities[line.id] ?? ""}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
              />
            </div>
          ))}

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
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Refund via</Label>
            <Select
              items={{ cash: "Cash", khata: "Khata credit", jazzcash: "JazzCash", easypaisa: "Easypaisa" }}
              value={refundMode}
              onValueChange={(value) => setRefundMode(value ?? "cash")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="khata">Khata credit</SelectItem>
                <SelectItem value="jazzcash">JazzCash</SelectItem>
                <SelectItem value="easypaisa">Easypaisa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={loading} onClick={handleSubmit}>
            {loading ? "Processing..." : "Confirm return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleVoid() {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/sales/${saleId}/void`, { method: "POST" });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to void sale");
        return;
      }

      toast.success("Sale voided");
      setConfirmOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogTrigger render={<Button variant="destructive">Void sale</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Void this entire sale?</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          This reverses all items and payments. This cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="destructive" disabled={loading} onClick={handleVoid}>
            {loading ? "Voiding..." : "Void sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnVoidActions({
  saleId,
  lines,
  canReturn,
  canVoid,
}: {
  saleId: string;
  lines: SaleLine[];
  canReturn: boolean;
  canVoid: boolean;
}) {
  if (!canReturn && !canVoid) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-2">
        {canReturn && <ReturnDialog saleId={saleId} lines={lines} />}
        {canVoid && <VoidButton saleId={saleId} />}
      </CardContent>
    </Card>
  );
}
