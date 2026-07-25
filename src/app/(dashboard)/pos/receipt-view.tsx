"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPKR } from "@/lib/money";
import { buildWhatsAppReceiptUrl } from "@/lib/receipt";

export interface ReceiptData {
  invoiceNumber: string;
  totalPaisa: number;
  itemCount: number;
  paymentModes: string[];
  tenantName: string;
}

// "PDF download" is satisfied by the browser's own print-to-PDF over this same #receipt-printable
// region (see globals.css's @media print rules) -- no PDF library, one rendering path.
export function ReceiptView({ receipt, onDone }: { receipt: ReceiptData; onDone: () => void }) {
  const [phone, setPhone] = useState("");

  function handleWhatsApp() {
    if (!phone.trim()) return;
    window.open(buildWhatsAppReceiptUrl(phone, receipt), "_blank");
  }

  return (
    <div className="flex flex-col gap-4">
      <div id="receipt-printable" className="rounded border p-4 text-sm">
        <p className="text-center font-semibold">{receipt.tenantName}</p>
        <p className="text-center">Invoice {receipt.invoiceNumber}</p>
        <div className="my-2 border-t" />
        <p>
          {receipt.itemCount} item{receipt.itemCount === 1 ? "" : "s"}
        </p>
        <p className="text-lg font-semibold">{formatPKR(receipt.totalPaisa)}</p>
        <p className="text-muted-foreground">Paid via {receipt.paymentModes.join(" + ")}</p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="WhatsApp number (e.g. 923001234567)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button type="button" variant="outline" onClick={handleWhatsApp}>
          Share
        </Button>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
        <Button type="button" onClick={onDone}>
          New sale
        </Button>
      </div>
    </div>
  );
}
