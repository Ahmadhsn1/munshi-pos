"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { formatPKR } from "@/lib/money";
import { computeRoundOff } from "@/lib/round-off";
import { ReceiptView, type ReceiptData } from "./receipt-view";

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "khata", label: "Khata" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "Easypaisa" },
];

interface PaymentRow {
  paymentMode: string;
  amountRupees: string;
  referenceText: string;
}

export function CheckoutDialog({
  open,
  onOpenChange,
  saleId,
  canDiscount,
  tenantName,
  itemCount,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string;
  subtotalPaisa: number;
  canDiscount: boolean;
  tenantName: string;
  customerPhone: string | null;
  itemCount: number;
  onComplete: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saleTotalBeforeDiscount, setSaleTotalBeforeDiscount] = useState(0);
  const [billDiscountRupees, setBillDiscountRupees] = useState("0");
  const [useRoundOff, setUseRoundOff] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([
    { paymentMode: "cash", amountRupees: "", referenceText: "" },
  ]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => {
    if (!open) return;

    setReceipt(null);
    setBillDiscountRupees("0");
    setUseRoundOff(false);

    fetch(`/api/pos/sales/${saleId}`)
      .then((res) => res.json())
      .then((body) => {
        const lines = (body.lines ?? []) as { unit_price_paisa: number; quantity: number; tax_paisa: number; line_discount_paisa: number }[];
        const total = lines.reduce(
          (sum: number, l) => sum + l.unit_price_paisa * l.quantity - l.line_discount_paisa + l.tax_paisa,
          0,
        );
        setSaleTotalBeforeDiscount(total);
        setPayments([{ paymentMode: "cash", amountRupees: (total / 100).toFixed(2), referenceText: "" }]);
      });
  }, [open, saleId]);

  const billDiscountPaisa = Math.round(Number(billDiscountRupees) * 100) || 0;
  const totalBeforeRoundOff = Math.max(saleTotalBeforeDiscount - billDiscountPaisa, 0);
  const isAllCash = payments.every((p) => p.paymentMode === "cash");
  const roundOffPaisa = useRoundOff && isAllCash ? computeRoundOff(totalBeforeRoundOff) : 0;
  const finalTotal = totalBeforeRoundOff + roundOffPaisa;

  // With a single payment row (the common case), keep its amount tracking the total as the bill
  // discount or round-off changes -- otherwise a cashier who ticks "round to nearest rupee" after
  // already looking at the amount field hits a payments-don't-match-total error for no reason
  // they caused. Split payments (2+ rows) are left alone; the cashier is already dividing the
  // total deliberately at that point.
  useEffect(() => {
    if (payments.length !== 1) return;
    const expected = (finalTotal / 100).toFixed(2);
    setPayments((prev) =>
      prev[0].amountRupees === expected ? prev : [{ ...prev[0], amountRupees: expected }],
    );
  }, [finalTotal, payments.length]);

  const paymentSumPaisa = payments.reduce(
    (sum, p) => sum + (Math.round(Number(p.amountRupees) * 100) || 0),
    0,
  );

  function updatePayment(index: number, patch: Partial<PaymentRow>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function handleComplete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/sales/${saleId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billDiscountPaisa,
          roundOffPaisa,
          payments: payments.map((p) => ({
            paymentMode: p.paymentMode,
            amountPaisa: Math.round(Number(p.amountRupees) * 100) || 0,
            referenceText: p.referenceText || undefined,
          })),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Checkout failed");
        return;
      }

      setReceipt({
        invoiceNumber: result.invoiceNumber,
        totalPaisa: result.totalPaisa,
        itemCount,
        paymentModes: [...new Set(payments.map((p) => p.paymentMode))],
        tenantName,
      });
      toast.success("Sale completed");
      onComplete();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{receipt ? "Receipt" : "Checkout"}</DialogTitle>
        </DialogHeader>

        {receipt ? (
          <ReceiptView receipt={receipt} onDone={() => onOpenChange(false)} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-right text-2xl font-semibold">{formatPKR(finalTotal)}</div>

            {canDiscount && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="billDiscount">Bill discount (Rs)</Label>
                <Input
                  id="billDiscount"
                  inputMode="decimal"
                  value={billDiscountRupees}
                  onChange={(e) => setBillDiscountRupees(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Payments</Label>
              {payments.map((payment, index) => (
                <div key={index} className="flex gap-2">
                  <Select
                    items={Object.fromEntries(PAYMENT_MODES.map((m) => [m.value, m.label]))}
                    value={payment.paymentMode}
                    onValueChange={(value) => updatePayment(index, { paymentMode: value ?? "cash" })}
                  >
                    <SelectTrigger className="w-32">
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
                  <Input
                    inputMode="decimal"
                    placeholder="Amount"
                    value={payment.amountRupees}
                    onChange={(e) => updatePayment(index, { amountRupees: e.target.value })}
                  />
                  {payment.paymentMode !== "cash" && payment.paymentMode !== "khata" && (
                    <Input
                      placeholder="Reference"
                      className="w-28"
                      value={payment.referenceText}
                      onChange={(e) => updatePayment(index, { referenceText: e.target.value })}
                    />
                  )}
                  {payments.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPayments((prev) => prev.filter((_, i) => i !== index))}
                    >
                      x
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto w-fit p-0"
                onClick={() =>
                  setPayments((prev) => [...prev, { paymentMode: "cash", amountRupees: "", referenceText: "" }])
                }
              >
                + Split payment
              </Button>
              {Math.round(paymentSumPaisa) !== finalTotal && (
                <p className="text-destructive text-sm">
                  Payments total {formatPKR(paymentSumPaisa)}, need {formatPKR(finalTotal)}
                </p>
              )}
            </div>

            {isAllCash && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useRoundOff}
                  onChange={(e) => setUseRoundOff(e.target.checked)}
                />
                Round to nearest rupee (cash only)
              </label>
            )}

            <DialogFooter>
              <Button
                disabled={loading || payments.length === 0}
                onClick={handleComplete}
              >
                {loading ? "Completing..." : "Complete sale"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
