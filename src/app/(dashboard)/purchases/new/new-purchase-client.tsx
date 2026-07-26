"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPKR } from "@/lib/money";
import { SupplierPicker } from "../supplier-picker";

interface SearchProduct {
  id: string;
  name_en: string;
  name_ur: string | null;
  brand: string | null;
  current_stock: number;
  // Optional because /api/products/search omits it entirely for callers without cost_price.view --
  // the absence is the enforcement, so this must not be typed as always-present.
  avg_cost_paisa?: number;
  purchase_to_stock_factor: number;
  purchase_unit: { name: string } | null;
}

interface PurchaseLine {
  productId: string;
  nameEn: string;
  unitName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitCostRupees: string;
  discountRupees: string;
  isFreeGoods: boolean;
}

function toPaisaLoose(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function NewPurchaseClient() {
  const router = useRouter();

  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [saving, setSaving] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    setResults(body.products ?? []);
  }

  function addProduct(product: SearchProduct) {
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        nameEn: product.name_en,
        unitName: product.purchase_unit?.name ?? "unit",
        batchNumber: "",
        expiryDate: "",
        quantity: 1,
        unitCostRupees: "",
        discountRupees: "0",
        isFreeGoods: false,
      },
    ]);
    setQuery("");
    setResults([]);
  }

  function updateLine(index: number, patch: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotalPaisa = lines.reduce(
    (sum, l) => sum + toPaisaLoose(l.unitCostRupees) * l.quantity - toPaisaLoose(l.discountRupees),
    0,
  );

  async function handleSaveDraft() {
    if (!supplier) {
      toast.error("Select a supplier");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one item");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: supplier.id,
          supplierInvoiceNumber: supplierInvoiceNumber || undefined,
          purchaseDate,
          notes: notes || undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            batchNumber: l.batchNumber || undefined,
            expiryDate: l.expiryDate || undefined,
            quantity: l.quantity,
            unitCostPaisa: l.isFreeGoods ? 0 : toPaisaLoose(l.unitCostRupees),
            discountPaisa: l.isFreeGoods ? 0 : toPaisaLoose(l.discountRupees),
            isFreeGoods: l.isFreeGoods,
          })),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to save purchase");
        return;
      }

      toast.success("Purchase draft saved");
      router.push(`/purchases/${result.purchaseId}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New purchase</h1>
        <p className="text-muted-foreground">Enter a supplier invoice -- confirm and receive goods on the next screen.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label>Supplier</Label>
            <SupplierPicker selected={supplier} onSelect={setSupplier} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="supplierInvoiceNumber">Supplier invoice #</Label>
            <Input
              id="supplierInvoiceNumber"
              className="w-40"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purchaseDate">Purchase date</Label>
            <Input
              id="purchaseDate"
              type="date"
              className="w-40"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purchaseNotes">Notes</Label>
            <Input id="purchaseNotes" className="w-64" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <Input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
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
                    {product.brand && <span className="text-muted-foreground ml-2">({product.brand})</span>}
                  </span>
                  <span className="text-muted-foreground">
                    {product.current_stock} in stock
                    {product.avg_cost_paisa !== undefined && ` · avg cost ${formatPKR(product.avg_cost_paisa)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit cost (Rs)</TableHead>
                <TableHead>Discount (Rs)</TableHead>
                <TableHead>Free goods</TableHead>
                <TableHead>Line total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const lineTotalPaisa = line.isFreeGoods
                  ? 0
                  : toPaisaLoose(line.unitCostRupees) * line.quantity - toPaisaLoose(line.discountRupees);
                return (
                  <TableRow key={index}>
                    <TableCell>
                      {line.nameEn} <span className="text-muted-foreground">/ {line.unitName}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-24"
                        value={line.batchNumber}
                        onChange={(e) => updateLine(index, { batchNumber: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        className="w-36"
                        value={line.expiryDate}
                        onChange={(e) => updateLine(index, { expiryDate: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        className="w-16"
                        value={line.quantity}
                        onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value)) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        disabled={line.isFreeGoods}
                        value={line.isFreeGoods ? "0" : line.unitCostRupees}
                        onChange={(e) => updateLine(index, { unitCostRupees: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        disabled={line.isFreeGoods}
                        value={line.isFreeGoods ? "0" : line.discountRupees}
                        onChange={(e) => updateLine(index, { discountRupees: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={line.isFreeGoods}
                        onChange={(e) =>
                          updateLine(index, {
                            isFreeGoods: e.target.checked,
                            unitCostRupees: e.target.checked ? "0" : line.unitCostRupees,
                            discountRupees: e.target.checked ? "0" : line.discountRupees,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>{formatPKR(lineTotalPaisa)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => removeLine(index)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground text-center">
                    No items yet -- search above to add one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-4">
        <span className="text-lg font-semibold">Subtotal {formatPKR(Math.max(subtotalPaisa, 0))}</span>
        <Button disabled={saving} onClick={handleSaveDraft}>
          {saving ? "Saving..." : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
