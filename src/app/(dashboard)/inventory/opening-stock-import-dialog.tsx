"use client";

import { useRef, useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TEMPLATE_HEADERS = [
  "name_en",
  "name_ur",
  "category_name",
  "brand",
  "barcode",
  "stock_unit_key",
  "purchase_unit_key",
  "purchase_to_stock_factor",
  "sale_unit_key",
  "sale_to_stock_factor",
  "tax_rate_percent",
  "reorder_level",
  "opening_quantity",
  "unit_cost_paisa",
];

const TEMPLATE_EXAMPLE = [
  "Lifebuoy Soap 100g",
  "",
  "Personal Care",
  "Lifebuoy",
  "8901030530637",
  "piece",
  "carton",
  "72",
  "",
  "",
  "17",
  "10",
  "144",
  "4500",
];

interface ImportReport {
  totalRows: number;
  productsCreated: number;
  openingStockRecorded: number;
  skipped: { row: number; message: string }[];
  errors: { row: number; field?: string; message: string }[];
}

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS.join(",")}\n${TEMPLATE_EXAMPLE.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "opening-stock-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadErrorsCsv(errors: ImportReport["errors"]) {
  const rows = ["row,field,message", ...errors.map((e) => `${e.row},${e.field ?? ""},"${e.message.replace(/"/g, '""')}"`)];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-errors.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function OpeningStockImportDialog() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  async function handleImport() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file first");
      return;
    }

    setLoading(true);
    setReport(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/inventory/opening-stock", { method: "POST", body: formData });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Import failed");
        return;
      }

      setReport(result);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReport(null);
      }}
    >
      <DialogTrigger render={<Button variant="outline">Import opening stock</Button>} />
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import opening stock from CSV</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Products are matched by barcode when present -- re-uploading after fixing a few rows
            is safe, already-stocked products are skipped, not double-counted.
          </p>

          <Button type="button" variant="link" className="h-auto w-fit p-0" onClick={downloadTemplate}>
            Download CSV template
          </Button>

          <input ref={fileInputRef} type="file" accept=".csv,text/csv" />

          {report && (
            <div className="flex flex-col gap-3 rounded border p-3">
              <p className="text-sm">
                {report.totalRows} rows -- {report.productsCreated} products created,{" "}
                {report.openingStockRecorded} opening stock entries recorded
                {report.skipped.length > 0 && `, ${report.skipped.length} skipped`}
                {report.errors.length > 0 && `, ${report.errors.length} had errors`}.
              </p>

              {report.errors.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Errors</span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => downloadErrorsCsv(report.errors)}
                    >
                      Download as CSV
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.errors.map((error, i) => (
                        <TableRow key={i}>
                          <TableCell>{error.row}</TableCell>
                          <TableCell>{error.field ?? "-"}</TableCell>
                          <TableCell>{error.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" disabled={loading} onClick={handleImport}>
            {loading ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
