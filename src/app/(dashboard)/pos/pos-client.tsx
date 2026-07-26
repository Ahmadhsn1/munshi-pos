"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPKR } from "@/lib/money";
import { CheckoutDialog } from "./checkout-dialog";
import { HeldBillsDialog } from "./held-bills-dialog";
import { ShiftCloseDialog } from "./shift-close-dialog";
import { CustomerPicker } from "./customer-picker";

export interface CartLine {
  productId: string;
  nameEn: string;
  nameUr: string | null;
  unitName: string;
  unitPricePaisa: number;
  taxRateBps: number;
  quantity: number;
  lineDiscountPaisa: number;
  currentStock: number;
}

interface SearchProduct {
  id: string;
  name_en: string;
  name_ur: string | null;
  sale_price_paisa: number;
  tax_rate_bps: number;
  current_stock: number;
  sale_unit: { name: string } | null;
}

export function PosClient({
  cashierName,
  canDiscount,
  tenantName,
}: {
  cashierName: string;
  canDiscount: boolean;
  tenantName: string;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  async function runSearch(q: string) {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    const res = await fetch(`/api/pos/products/search?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    setResults(body.products ?? []);
  }

  function addProduct(product: SearchProduct) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          nameEn: product.name_en,
          nameUr: product.name_ur,
          unitName: product.sale_unit?.name ?? "unit",
          unitPricePaisa: product.sale_price_paisa,
          taxRateBps: product.tax_rate_bps,
          quantity: 1,
          lineDiscountPaisa: 0,
          currentStock: product.current_stock,
        },
      ];
    });
    setQuery("");
    setResults([]);
    searchRef.current?.focus();
  }

  async function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    if (!query.trim()) return;

    const res = await fetch(`/api/pos/products/search?q=${encodeURIComponent(query)}`);
    const body = await res.json();
    const products: SearchProduct[] = body.products ?? [];

    if (products.length === 1) {
      // A barcode scan (or a search that narrowed to exactly one match) adds directly --
      // the whole point of "input focus + Enter detection" is that a USB scanner just types
      // the barcode and sends Enter, with no extra clicks.
      addProduct(products[0]);
    } else {
      setResults(products);
    }
  }

  function updateQuantity(productId: string, quantity: number) {
    if (quantity < 1) return;
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)));
  }

  function updateLineDiscount(productId: string, lineDiscountPaisa: number) {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, lineDiscountPaisa } : l)),
    );
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  function resetCart() {
    setLines([]);
    setSaleId(null);
    setCustomer(null);
  }

  const subtotalPaisa = lines.reduce((sum, l) => sum + l.unitPricePaisa * l.quantity, 0);
  const discountPaisa = lines.reduce((sum, l) => sum + l.lineDiscountPaisa, 0);

  async function persistDraft(heldLabel?: string): Promise<string | null> {
    if (lines.length === 0) {
      toast.error("Cart is empty");
      return null;
    }

    setSaving(true);
    try {
      const payload = {
        customerId: customer?.id ?? null,
        heldLabel: heldLabel || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          lineDiscountPaisa: l.lineDiscountPaisa,
        })),
      };

      const res = await fetch(saleId ? `/api/pos/sales/${saleId}` : "/api/pos/sales", {
        method: saleId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to save sale");
        return null;
      }

      const id = saleId ?? result.saleId;
      setSaleId(id);
      return id;
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmHold() {
    const id = await persistDraft(holdLabel);
    if (id) {
      toast.success("Bill held");
      resetCart();
      setHoldDialogOpen(false);
      setHoldLabel("");
    }
  }

  async function handleOpenCheckout() {
    const id = await persistDraft();
    if (id) {
      setCheckoutOpen(true);
    }
  }

  async function handleRecall(recalledSaleId: string) {
    const res = await fetch(`/api/pos/sales/${recalledSaleId}`);
    const body = await res.json();

    if (!res.ok) {
      toast.error("Failed to recall bill");
      return;
    }

    interface RecalledLine {
      product_id: string;
      quantity: number;
      unit_price_paisa: number;
      line_discount_paisa: number;
      products: {
        name_en: string;
        name_ur: string | null;
        sale_unit: { name: string } | null;
      } | null;
    }

    const recalledLines: CartLine[] = (body.lines as RecalledLine[]).map((l) => ({
      productId: l.product_id,
      nameEn: l.products?.name_en ?? "Product",
      nameUr: l.products?.name_ur ?? null,
      unitName: l.products?.sale_unit?.name ?? "",
      unitPricePaisa: l.unit_price_paisa,
      taxRateBps: 0,
      quantity: l.quantity,
      lineDiscountPaisa: l.line_discount_paisa,
      currentStock: 0,
    }));

    setLines(recalledLines);
    setSaleId(recalledSaleId);
    // Without this, the recalled sale's customer_id was silently getting overwritten to null
    // the next time the draft was saved (handleOpenCheckout/handleHold both PATCH with
    // customerId: customer?.id ?? null) -- caught during Phase 5 manual testing when a recalled
    // khata sale lost its customer and complete_sale rejected the khata payment entirely.
    const recalledCustomer = body.sale.customers as { id: string; name: string } | null;
    setCustomer(recalledCustomer ? { id: recalledCustomer.id, name: recalledCustomer.name } : null);
    toast.success("Bill recalled");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Counter</h1>
          <p className="text-muted-foreground text-sm">{cashierName}</p>
        </div>
        <div className="flex gap-2">
          <HeldBillsDialog onRecall={handleRecall} />
          <ShiftCloseDialog />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Scan a barcode or search by name..."
            autoComplete="off"
          />
          {results.length > 0 && (
            <div className="flex flex-col gap-1 rounded border">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="hover:bg-muted flex items-center justify-between px-3 py-2 text-left text-sm"
                  onClick={() => addProduct(product)}
                >
                  <span>
                    {product.name_en}
                    {product.name_ur && <span className="text-muted-foreground ml-2" dir="rtl">{product.name_ur}</span>}
                  </span>
                  <span className="text-muted-foreground">
                    {formatPKR(product.sale_price_paisa)} · {product.current_stock} in stock
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cart</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Price</TableHead>
                {canDiscount && <TableHead>Discount</TableHead>}
                <TableHead>Line total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.productId}>
                  <TableCell>{line.nameEn}</TableCell>
                  <TableCell>
                    {/* The unit label matters most for loose goods sold by weight (daal, aata,
                        chawal) -- a bare "500" in this box is ambiguous, "500 g" is not. It was
                        already being resolved into CartLine.unitName but never rendered. */}
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        className="w-16"
                        value={line.quantity}
                        onChange={(e) => updateQuantity(line.productId, Number(e.target.value))}
                      />
                      {line.unitName && (
                        <span className="text-muted-foreground text-xs">{line.unitName}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{formatPKR(line.unitPricePaisa)}</TableCell>
                  {canDiscount && (
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        className="w-20"
                        value={line.lineDiscountPaisa / 100}
                        onChange={(e) =>
                          updateLineDiscount(line.productId, Math.round(Number(e.target.value) * 100) || 0)
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    {formatPKR(line.unitPricePaisa * line.quantity - line.lineDiscountPaisa)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => removeLine(line.productId)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canDiscount ? 6 : 5} className="text-muted-foreground text-center">
                    Cart is empty -- scan or search for a product.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <CustomerPicker selected={customer} onSelect={setCustomer} />

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-muted-foreground text-sm">
                Subtotal {formatPKR(subtotalPaisa)}
                {discountPaisa > 0 && ` -${formatPKR(discountPaisa)} discount`}
              </div>
              <div className="text-lg font-semibold">{formatPKR(subtotalPaisa - discountPaisa)}</div>
            </div>
            <Button
              variant="outline"
              disabled={saving || lines.length === 0}
              onClick={() => setHoldDialogOpen(true)}
            >
              Hold
            </Button>
            <Button disabled={saving || lines.length === 0} onClick={handleOpenCheckout}>
              Checkout
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={holdDialogOpen} onOpenChange={setHoldDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hold bill</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="holdLabel">Label (optional)</Label>
            <Input
              id="holdLabel"
              value={holdLabel}
              onChange={(e) => setHoldLabel(e.target.value)}
              placeholder="e.g. Table 3, Customer at counter..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button disabled={saving} onClick={handleConfirmHold}>
              {saving ? "Holding..." : "Hold bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {saleId && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          saleId={saleId}
          subtotalPaisa={subtotalPaisa - discountPaisa}
          canDiscount={canDiscount}
          tenantName={tenantName}
          customerPhone={null}
          itemCount={lines.reduce((sum, l) => sum + l.quantity, 0)}
          onComplete={() => {
            resetCart();
            router.refresh();
          }}
        />
      )}

      <Badge variant="outline" className="w-fit">
        Barcode scanner: click the search box, scan -- it types + Enter automatically.
      </Badge>
    </div>
  );
}
