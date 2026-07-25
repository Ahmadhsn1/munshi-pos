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
import { createClient } from "@/lib/supabase/client";

interface Category {
  id: string;
  name: string;
  parent_category_id: string | null;
}

interface Unit {
  id: string;
  key: string;
  name: string;
}

// Orders categories as top-level, followed immediately by their own children -- a flat list is
// all a <Select> needs, but this keeps subcategories visually grouped under their parent.
function orderCategoriesForDisplay(categories: Category[]) {
  const topLevel = categories.filter((c) => !c.parent_category_id);
  const ordered: { category: Category; indent: boolean }[] = [];

  for (const parent of topLevel) {
    ordered.push({ category: parent, indent: false });
    for (const child of categories.filter((c) => c.parent_category_id === parent.id)) {
      ordered.push({ category: child, indent: true });
    }
  }

  return ordered;
}

function InlineUnitCreator({ onCreated }: { onCreated: (unit: Unit) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, name }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to create unit");
        return;
      }

      onCreated(result.unit);
      setKey("");
      setName("");
      setOpen(false);
      toast.success(`Unit "${result.unit.name}" added`);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)}>
        + New unit
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Key</Label>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="bori" className="h-8 w-20" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bori" className="h-8 w-28" />
      </div>
      <Button type="button" size="sm" disabled={loading || !key || !name} onClick={handleCreate}>
        Add
      </Button>
    </div>
  );
}

export function ProductCreateDialog({
  categories,
  units,
}: {
  categories: Category[];
  units: Unit[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localUnits, setLocalUnits] = useState(units);

  const [nameEn, setNameEn] = useState("");
  const [nameUr, setNameUr] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState("");
  const [stockUnitId, setStockUnitId] = useState("");
  const [purchaseUnitId, setPurchaseUnitId] = useState("");
  const [purchaseToStockFactor, setPurchaseToStockFactor] = useState("1");
  const [saleUnitId, setSaleUnitId] = useState("");
  const [saleToStockFactor, setSaleToStockFactor] = useState("1");
  const [taxRatePercent, setTaxRatePercent] = useState("0");
  const [salePriceRupees, setSalePriceRupees] = useState("");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [barcodes, setBarcodes] = useState<string[]>([""]);
  const [imageFile, setImageFile] = useState<File | null>(null);

  function resetForm() {
    setNameEn("");
    setNameUr("");
    setCategoryId("");
    setBrand("");
    setStockUnitId("");
    setPurchaseUnitId("");
    setPurchaseToStockFactor("1");
    setSaleUnitId("");
    setSaleToStockFactor("1");
    setTaxRatePercent("0");
    setSalePriceRupees("");
    setReorderLevel("0");
    setBarcodes([""]);
    setImageFile(null);
  }

  async function uploadImage(): Promise<string | null> {
    if (!imageFile) return null;

    const urlRes = await fetch("/api/products/image-upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: imageFile.name }),
    });
    const urlBody = await urlRes.json();

    if (!urlRes.ok) {
      throw new Error(urlBody.error ?? "Failed to prepare image upload");
    }

    const supabase = createClient();
    const { error } = await supabase.storage
      .from("product-images")
      .uploadToSignedUrl(urlBody.path, urlBody.token, imageFile);

    if (error) {
      throw new Error("Image upload failed");
    }

    return urlBody.path as string;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stockUnitId) {
      toast.error("Stock unit is required");
      return;
    }

    setLoading(true);
    try {
      const imagePath = await uploadImage();

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameEn,
          nameUr,
          categoryId: categoryId || null,
          brand,
          stockUnitId,
          purchaseUnitId: purchaseUnitId || null,
          purchaseToStockFactor: Number(purchaseToStockFactor) || 1,
          saleUnitId: saleUnitId || null,
          saleToStockFactor: Number(saleToStockFactor) || 1,
          taxRatePercent,
          salePriceRupees,
          reorderLevel: Number(reorderLevel) || 0,
          imagePath,
          barcodes: barcodes.map((b) => b.trim()).filter(Boolean),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to create product");
        return;
      }

      toast.success(`${nameEn} added`);
      resetForm();
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const orderedCategories = orderCategoriesForDisplay(categories);
  // Select.Value renders the raw value (a UUID) unless the Select knows how to map value ->
  // label -- passing `items` is Base UI's supported way to give it that lookup table.
  const categoryItems = Object.fromEntries(
    orderedCategories.map(({ category, indent }) => [
      category.id,
      indent ? `— ${category.name}` : category.name,
    ]),
  );
  const unitItems = Object.fromEntries(localUnits.map((unit) => [unit.id, unit.name]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Add product</Button>} />
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nameEn">Name (English)</Label>
              <Input id="nameEn" required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nameUr">Name (Urdu)</Label>
              <Input id="nameUr" dir="rtl" value={nameUr} onChange={(e) => setNameUr(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              <Select
                items={categoryItems}
                value={categoryId}
                onValueChange={(value) => setCategoryId(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {orderedCategories.map(({ category, indent }) => (
                    <SelectItem key={category.id} value={category.id}>
                      {indent ? `— ${category.name}` : category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="salePriceRupees">Selling price (Rs)</Label>
              <Input
                id="salePriceRupees"
                required
                inputMode="decimal"
                value={salePriceRupees}
                onChange={(e) => setSalePriceRupees(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Stock unit</Label>
              <Select
                items={unitItems}
                value={stockUnitId}
                onValueChange={(value) => setStockUnitId(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {localUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <InlineUnitCreator onCreated={(unit) => setLocalUnits((prev) => [...prev, unit])} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="taxRatePercent">Tax rate (%)</Label>
              <Input
                id="taxRatePercent"
                inputMode="decimal"
                value={taxRatePercent}
                onChange={(e) => setTaxRatePercent(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Purchase unit (optional)</Label>
              <div className="flex gap-2">
                <Select
                  items={unitItems}
                  value={purchaseUnitId}
                  onValueChange={(value) => setPurchaseUnitId(value ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Same as stock" />
                  </SelectTrigger>
                  <SelectContent>
                    {localUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Purchase-to-stock factor"
                  className="w-20"
                  inputMode="numeric"
                  value={purchaseToStockFactor}
                  onChange={(e) => setPurchaseToStockFactor(e.target.value)}
                  title="1 purchase unit = N stock units"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Sale unit (optional)</Label>
              <div className="flex gap-2">
                <Select
                  items={unitItems}
                  value={saleUnitId}
                  onValueChange={(value) => setSaleUnitId(value ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Same as stock" />
                  </SelectTrigger>
                  <SelectContent>
                    {localUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Sale-to-stock factor"
                  className="w-20"
                  inputMode="numeric"
                  value={saleToStockFactor}
                  onChange={(e) => setSaleToStockFactor(e.target.value)}
                  title="1 sale unit = N stock units"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reorderLevel">Reorder level</Label>
              <Input
                id="reorderLevel"
                inputMode="numeric"
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="image">Image (optional)</Label>
              <Input
                id="image"
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Barcodes</Label>
            {barcodes.map((barcode, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={barcode}
                  onChange={(e) =>
                    setBarcodes((prev) => prev.map((b, i) => (i === index ? e.target.value : b)))
                  }
                  placeholder="Scan or type a barcode"
                />
                {barcodes.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setBarcodes((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto w-fit p-0"
              onClick={() => setBarcodes((prev) => [...prev, ""])}
            >
              + Another barcode
            </Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
