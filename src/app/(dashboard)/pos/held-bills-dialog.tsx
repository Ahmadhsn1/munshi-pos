"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface HeldSale {
  id: string;
  held_label: string | null;
  created_at: string;
}

export function HeldBillsDialog({ onRecall }: { onRecall: (saleId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sales, setSales] = useState<HeldSale[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadHeldBills() {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/sales/open");
      const body = await res.json();
      setSales(body.sales ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadHeldBills();
      }}
    >
      <DialogTrigger render={<Button variant="outline">Held bills</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Held bills</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
          {!loading && sales.length === 0 && (
            <p className="text-muted-foreground text-sm">No bills on hold.</p>
          )}
          {sales.map((sale) => (
            <Button
              key={sale.id}
              variant="outline"
              className="justify-between"
              onClick={() => {
                onRecall(sale.id);
                setOpen(false);
              }}
            >
              <span>{sale.held_label || "Held bill"}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(sale.created_at).toLocaleTimeString("en-PK")}
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
