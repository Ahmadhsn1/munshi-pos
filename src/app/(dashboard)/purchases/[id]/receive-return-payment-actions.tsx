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

interface ReceivableLine {
  purchaseLineItemId: string;
  productName: string;
  unitName: string;
  remainingPurchaseUnits: number;
}

interface ReturnableLine {
  purchaseLineItemId: string;
  productName: string;
  remainingStockUnits: number;
}

function ReceiveGoodsDialog({ purchaseId, lines }: { purchaseId: string; lines: ReceivableLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const receivable = lines.filter((l) => l.remainingPurchaseUnits > 0);

  async function handleSubmit() {
    const selectedLines = receivable
      .map((line) => ({
        purchaseLineItemId: line.purchaseLineItemId,
        quantityReceivedPurchaseUnits: Number(quantities[line.purchaseLineItemId] || 0),
      }))
      .filter((l) => l.quantityReceivedPurchaseUnits > 0);

    if (selectedLines.length === 0) {
      toast.error("Enter a received quantity for at least one item");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || undefined, lines: selectedLines }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to record goods receipt");
        return;
      }

      toast.success("Goods receipt recorded");
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (receivable.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Receive goods</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record goods receipt</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {receivable.map((line) => (
            <div key={line.purchaseLineItemId} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {line.productName} ({line.remainingPurchaseUnits} {line.unitName} remaining)
              </span>
              <Input
                type="number"
                min={0}
                max={line.remainingPurchaseUnits}
                className="w-24"
                value={quantities[line.purchaseLineItemId] ?? ""}
                onChange={(e) =>
                  setQuantities((prev) => ({ ...prev, [line.purchaseLineItemId]: e.target.value }))
                }
              />
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={loading} onClick={handleSubmit}>
            {loading ? "Recording..." : "Confirm receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const RETURN_REASONS = [
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "expired", label: "Expired" },
  { value: "other", label: "Other" },
];

function PurchaseReturnDialog({ purchaseId, lines }: { purchaseId: string; lines: ReturnableLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const returnable = lines.filter((l) => l.remainingStockUnits > 0);

  async function handleSubmit() {
    const selectedLines = returnable
      .map((line) => ({ purchaseLineItemId: line.purchaseLineItemId, quantity: Number(quantities[line.purchaseLineItemId] || 0) }))
      .filter((l) => l.quantity > 0);

    if (selectedLines.length === 0) {
      toast.error("Select at least one item to return");
      return;
    }
    if (!reasonCode) {
      toast.error("Select a reason");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode, note: note || undefined, lines: selectedLines }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to process return");
        return;
      }

      toast.success("Return recorded");
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (returnable.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Return to supplier</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Return goods to supplier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {returnable.map((line) => (
            <div key={line.purchaseLineItemId} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {line.productName} ({line.remainingStockUnits} returnable)
              </span>
              <Input
                type="number"
                min={0}
                max={line.remainingStockUnits}
                className="w-24"
                value={quantities[line.purchaseLineItemId] ?? ""}
                onChange={(e) =>
                  setQuantities((prev) => ({ ...prev, [line.purchaseLineItemId]: e.target.value }))
                }
              />
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Label>Reason</Label>
            <Select
              items={Object.fromEntries(RETURN_REASONS.map((r) => [r.value, r.label]))}
              value={reasonCode}
              onValueChange={(value) => setReasonCode(value ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
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

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "Easypaisa" },
];

function RecordPaymentDialog({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState("cash");
  const [amountRupees, setAmountRupees] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const amountPaisa = Math.round(Number(amountRupees) * 100);
    if (!amountPaisa || amountPaisa <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMode,
          amountPaisa,
          referenceText: referenceText || undefined,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to record payment");
        return;
      }

      toast.success("Payment recorded");
      setOpen(false);
      setAmountRupees("");
      setReferenceText("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Record payment</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record a payment to supplier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Payment mode</Label>
            <Select
              items={Object.fromEntries(PAYMENT_MODES.map((m) => [m.value, m.label]))}
              value={paymentMode}
              onValueChange={(value) => setPaymentMode(value ?? "cash")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="paymentAmount">Amount (Rs)</Label>
            <Input
              id="paymentAmount"
              type="number"
              min={0}
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="paymentReference">Reference (optional)</Label>
            <Input id="paymentReference" value={referenceText} onChange={(e) => setReferenceText(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={loading} onClick={handleSubmit}>
            {loading ? "Saving..." : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PurchaseActions({
  purchaseId,
  status,
  receivableLines,
  returnableLines,
  canManage,
}: {
  purchaseId: string;
  status: string;
  receivableLines: ReceivableLine[];
  returnableLines: ReturnableLine[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!canManage) return null;

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/confirm`, { method: "POST" });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to confirm purchase");
        return;
      }

      toast.success("Purchase confirmed");
      router.refresh();
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/cancel`, { method: "POST" });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to cancel purchase");
        return;
      }

      toast.success("Purchase cancelled");
      router.refresh();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <>
          <Button disabled={confirming} onClick={handleConfirm}>
            {confirming ? "Confirming..." : "Confirm purchase"}
          </Button>
          <Button variant="destructive" disabled={cancelling} onClick={handleCancel}>
            {cancelling ? "Cancelling..." : "Cancel"}
          </Button>
        </>
      )}
      {(status === "confirmed" || status === "partially_received") && (
        <ReceiveGoodsDialog purchaseId={purchaseId} lines={receivableLines} />
      )}
      {(status === "partially_received" || status === "received") && (
        <>
          <PurchaseReturnDialog purchaseId={purchaseId} lines={returnableLines} />
          <RecordPaymentDialog purchaseId={purchaseId} />
        </>
      )}
    </div>
  );
}
