import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";
import { toBps } from "@/lib/tax";
import { openingStockRowSchema } from "@/lib/validation";

// CSV-only (not binary .xlsx -- smaller dependency/attack surface, Excel/Sheets can "Save As
// CSV"). Structural validation (types, required fields, within-file duplicate barcodes) happens
// here, with zero DB round-trips, before anything reaches the database. Only structurally-valid
// rows are sent as one batch to the import_opening_stock RPC, which does the DB-dependent
// validation (unit/category resolution, per-row savepoint rollback on business-rule violations)
// -- see 20260725000021_import_opening_stock_rpc.sql for why this two-layer split exists.
export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // well under Vercel's default body-size ceiling

interface RowError {
  row: number;
  field?: string;
  message: string;
}

export async function POST(request: Request) {
  const context = await getActingUserContext();

  // Requires both permissions since this endpoint both creates products AND writes stock
  // movements in one action.
  if (!context || !context.permissions.has("products.manage") || !context.permissions.has("inventory.adjust")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No CSV file uploaded" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 5MB)" }, { status: 400 });
  }

  const text = await file.text();
  let records: Record<string, string>[];

  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    return NextResponse.json({ error: "Could not parse this file as CSV" }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "The CSV file has no data rows" }, { status: 400 });
  }

  const structuralErrors: RowError[] = [];
  const validRows: Record<string, unknown>[] = [];
  const seenBarcodes = new Map<string, number>();

  records.forEach((record, index) => {
    const row = index + 2; // +1 for 0-index, +1 for the header row
    const parsed = openingStockRowSchema.safeParse({ ...record, row });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      structuralErrors.push({ row, field: issue?.path.join("."), message: issue?.message ?? "Invalid row" });
      return;
    }

    const data = parsed.data;

    if (data.barcode) {
      const firstSeenRow = seenBarcodes.get(data.barcode);
      if (firstSeenRow !== undefined) {
        structuralErrors.push({
          row,
          field: "barcode",
          message: `Duplicate barcode within this file (first seen on row ${firstSeenRow})`,
        });
        return;
      }
      seenBarcodes.set(data.barcode, row);
    }

    let taxRateBps = 0;
    if (data.tax_rate_percent) {
      try {
        taxRateBps = toBps(data.tax_rate_percent);
      } catch {
        structuralErrors.push({ row, field: "tax_rate_percent", message: "Invalid tax rate" });
        return;
      }
    }

    validRows.push({
      row,
      name_en: data.name_en,
      name_ur: data.name_ur || null,
      category_name: data.category_name || null,
      brand: data.brand || null,
      barcode: data.barcode || null,
      stock_unit_key: data.stock_unit_key,
      purchase_unit_key: data.purchase_unit_key || null,
      purchase_to_stock_factor: data.purchase_to_stock_factor ?? null,
      sale_unit_key: data.sale_unit_key || null,
      sale_to_stock_factor: data.sale_to_stock_factor ?? null,
      tax_rate_bps: taxRateBps,
      reorder_level: data.reorder_level ?? null,
      opening_quantity: data.opening_quantity,
      unit_cost_paisa: data.unit_cost_paisa ?? null,
    });
  });

  const admin = createAdminClient();

  let rpcResult = {
    productsCreated: 0,
    openingStockRecorded: 0,
    skipped: [] as { row: number; message: string }[],
    errors: [] as { row: number; message: string }[],
  };

  if (validRows.length > 0) {
    const { data, error } = await admin.rpc("import_opening_stock", {
      p_tenant_id: context.tenantId,
      p_created_by: context.userId,
      p_rows: validRows,
    });

    if (error) {
      return NextResponse.json({ error: "Import failed. Please try again." }, { status: 500 });
    }

    rpcResult = data as typeof rpcResult;
  }

  return NextResponse.json({
    totalRows: records.length,
    productsCreated: rpcResult.productsCreated,
    openingStockRecorded: rpcResult.openingStockRecorded,
    skipped: rpcResult.skipped,
    errors: [...structuralErrors, ...rpcResult.errors],
  });
}
