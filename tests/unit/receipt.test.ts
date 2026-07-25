import { describe, expect, it } from "vitest";
import { buildReceiptSummaryText, buildWhatsAppReceiptUrl } from "@/lib/receipt";

const sample = {
  invoiceNumber: "20260725-00007",
  itemCount: 3,
  totalPaisa: 45000,
  paymentModes: ["cash"],
  tenantName: "Al-Madina Kiryana Store",
};

describe("receipt summary + WhatsApp link", () => {
  it("builds a condensed summary with formatted PKR", () => {
    const text = buildReceiptSummaryText(sample);
    expect(text).toContain("Al-Madina Kiryana Store");
    expect(text).toContain("Invoice 20260725-00007");
    expect(text).toContain("3 items");
    expect(text).toContain("Rs 450.00");
    expect(text).toContain("Paid via cash");
  });

  it("singularizes item count of 1", () => {
    const text = buildReceiptSummaryText({ ...sample, itemCount: 1 });
    expect(text).toContain("1 item --");
  });

  it("joins multiple payment modes", () => {
    const text = buildReceiptSummaryText({ ...sample, paymentModes: ["cash", "khata"] });
    expect(text).toContain("Paid via cash + khata");
  });

  it("builds a wa.me link with digits-only phone and encoded text", () => {
    const url = buildWhatsAppReceiptUrl("+92 300 1234567", sample);
    expect(url).toMatch(/^https:\/\/wa\.me\/923001234567\?text=/);
    expect(decodeURIComponent(url.split("text=")[1])).toContain("Invoice 20260725-00007");
  });
});
