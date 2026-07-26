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
import { buildWhatsAppReminderUrl } from "@/lib/khata";

interface CustomerFields {
  name: string;
  phone: string | null;
  creditLimitPaisa: number | null;
  priceTier: string | null;
  isBlacklisted: boolean;
  isActive: boolean;
}

function EditCustomerDialog({ customerId, initial }: { customerId: string; initial: CustomerFields }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [creditLimitRupees, setCreditLimitRupees] = useState(
    initial.creditLimitPaisa != null ? (initial.creditLimitPaisa / 100).toString() : "",
  );
  const [priceTier, setPriceTier] = useState(initial.priceTier ?? "");
  const [isBlacklisted, setIsBlacklisted] = useState(initial.isBlacklisted);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: phone || undefined,
          creditLimitPaisa: creditLimitRupees ? Math.round(Number(creditLimitRupees) * 100) : null,
          priceTier: priceTier || undefined,
          isBlacklisted,
          isActive,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to update customer");
        return;
      }

      toast.success("Customer updated");
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Edit</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit customer</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="editName">Name</Label>
            <Input id="editName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="editPhone">Phone</Label>
            <Input id="editPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="editCreditLimit">Credit limit (Rs, blank = no limit)</Label>
            <Input
              id="editCreditLimit"
              type="number"
              min={0}
              value={creditLimitRupees}
              onChange={(e) => setCreditLimitRupees(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="editPriceTier">Price tier</Label>
            <Input id="editPriceTier" value={priceTier} onChange={(e) => setPriceTier(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isBlacklisted} onChange={(e) => setIsBlacklisted(e.target.checked)} />
            Blacklisted (stop khata supply)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button disabled={loading} onClick={handleSubmit}>
            {loading ? "Saving..." : "Save"}
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

function RecordPaymentDialog({ customerId }: { customerId: string }) {
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
      const res = await fetch(`/api/customers/${customerId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMode, amountPaisa, referenceText: referenceText || undefined }),
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
      <DialogTrigger render={<Button>Record payment</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record a khata payment</DialogTitle>
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

export function CustomerDetailActions({
  customerId,
  customerName,
  customerPhone,
  outstandingPaisa,
  tenantName,
  initial,
}: {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  outstandingPaisa: number;
  tenantName: string;
  initial: CustomerFields;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <RecordPaymentDialog customerId={customerId} />
        {customerPhone && outstandingPaisa > 0 && (
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={buildWhatsAppReminderUrl(customerPhone, { customerName, outstandingPaisa, tenantName })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Send reminder
              </a>
            }
          />
        )}
        <EditCustomerDialog customerId={customerId} initial={initial} />
      </CardContent>
    </Card>
  );
}
