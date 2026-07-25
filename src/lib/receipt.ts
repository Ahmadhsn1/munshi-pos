import { formatPKR } from "@/lib/money";

/**
 * Receipt sharing helpers. Deliberately no PDF library and no WhatsApp Business API -- "PDF
 * download" is satisfied by the browser's own print-to-PDF over the same print stylesheet the
 * receipt component already renders, and "WhatsApp share" is a plain wa.me deep link (matching
 * the plan's explicit "manual/free tier initially" scope note). Both keep this app dependency-free
 * for receipts.
 */

export interface ReceiptSummaryInput {
  invoiceNumber: string;
  itemCount: number;
  totalPaisa: number;
  paymentModes: string[];
  tenantName: string;
}

/** A condensed, human-readable summary -- NOT a full itemized receipt. wa.me's prefilled-text
 * field has practical length limits and will silently truncate a long, itemized dump. */
export function buildReceiptSummaryText(input: ReceiptSummaryInput): string {
  const modes = input.paymentModes.join(" + ");

  return [
    input.tenantName,
    `Invoice ${input.invoiceNumber}`,
    `${input.itemCount} item${input.itemCount === 1 ? "" : "s"} -- ${formatPKR(input.totalPaisa)}`,
    `Paid via ${modes}`,
  ].join("\n");
}

/** Builds a wa.me deep link with the receipt summary prefilled. `phone` should already be in
 * international format without a leading "+" (e.g. "923001234567") -- wa.me requires this. */
export function buildWhatsAppReceiptUrl(phone: string, input: ReceiptSummaryInput): string {
  const digitsOnly = phone.replace(/\D/g, "");
  const text = encodeURIComponent(buildReceiptSummaryText(input));
  return `https://wa.me/${digitsOnly}?text=${text}`;
}
