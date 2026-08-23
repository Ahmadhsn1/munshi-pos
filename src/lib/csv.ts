/**
 * Generic CSV builder for report/ledger exports (plan.md Phase 7: "every ledger/report exportable
 * to Excel/PDF -- removes lock-in fear, builds trust"). CSV rather than a PDF/XLSX library: every
 * spreadsheet app (Excel, Google Sheets, LibreOffice) opens CSV natively with zero new dependency,
 * and a shopkeeper's actual need here is "get my data out", not print formatting.
 */

export interface CsvColumn<T> {
  header: string;
  /** Returns the cell's raw value -- escaping/quoting is handled by toCsv, never do it here. */
  value: (row: T) => string | number | null | undefined;
}

/** Escapes a single field per RFC 4180: wrap in quotes and double any embedded quote whenever the
 * value contains a comma, quote, or newline -- exactly the characters that would otherwise corrupt
 * column boundaries or terminate the row early. */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCsvField(c.header)).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = c.value(row);
          return escapeCsvField(v === null || v === undefined ? "" : String(v));
        })
        .join(","),
    );
  }

  // CRLF line endings -- the CSV spec's own recommendation and what Excel expects; LF-only is
  // technically read by most tools but CRLF avoids any doubt.
  return lines.join("\r\n");
}

/**
 * A CSV Response with a UTF-8 BOM prefix. The BOM is not optional here: this app stores real Urdu
 * product names and receipt text (absolute requirement, see ENGINEERING.md), and Excel on Windows --
 * the shopkeeper's actual target application -- silently mis-renders UTF-8 CSVs without a BOM as
 * mojibake. Every other consumer (Sheets, LibreOffice, a text editor) already handles the BOM
 * correctly, so there is no compatibility trade-off in adding it.
 */
export function csvResponse(filename: string, csv: string): Response {
  const BOM = "﻿";
  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
