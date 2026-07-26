import { describe, expect, it } from "vitest";
import {
  allocateFifoAging,
  buildKhataReminderText,
  buildWhatsAppReminderUrl,
  computeKhataBalance,
} from "@/lib/khata";

describe("allocateFifoAging", () => {
  it("1. no credits: every debit remains fully outstanding", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 5000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000 },
    ];
    const result = allocateFifoAging(debits, 0);
    expect(result).toEqual([
      { id: "a", date: "2026-01-01", amountPaisa: 5000, remainingPaisa: 5000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000, remainingPaisa: 3000 },
    ]);
  });

  it("2. credit exactly clears the oldest debit, nothing left over -- oldest disappears, others untouched", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 5000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000 },
    ];
    const result = allocateFifoAging(debits, 5000);
    expect(result).toEqual([{ id: "b", date: "2026-01-10", amountPaisa: 3000, remainingPaisa: 3000 }]);
  });

  it("3. credit partially clears the oldest debit -- oldest remains reduced, others untouched", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 5000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000 },
    ];
    const result = allocateFifoAging(debits, 2000);
    expect(result).toEqual([
      { id: "a", date: "2026-01-01", amountPaisa: 5000, remainingPaisa: 3000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000, remainingPaisa: 3000 },
    ]);
  });

  it("4. credit exceeds total debits: everything clears, no negative/leftover rows", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 5000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000 },
    ];
    const result = allocateFifoAging(debits, 100000);
    expect(result).toEqual([]);
  });

  it("5. credit crosses from the first debit into the second (partially)", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 5000 },
      { id: "b", date: "2026-01-10", amountPaisa: 3000 },
    ];
    const result = allocateFifoAging(debits, 6000);
    expect(result).toEqual([{ id: "b", date: "2026-01-10", amountPaisa: 3000, remainingPaisa: 2000 }]);
  });

  it("6. zero debits: returns empty regardless of credit amount", () => {
    expect(allocateFifoAging([], 5000)).toEqual([]);
    expect(allocateFifoAging([], 0)).toEqual([]);
  });

  it("7. zero credits: every debit returned unchanged", () => {
    const debits = [{ id: "a", date: "2026-01-01", amountPaisa: 1200 }];
    expect(allocateFifoAging(debits, 0)).toEqual([
      { id: "a", date: "2026-01-01", amountPaisa: 1200, remainingPaisa: 1200 },
    ]);
  });

  it("8. a single debit exactly equal to the credit clears exactly (boundary, not off-by-one)", () => {
    const debits = [{ id: "a", date: "2026-01-01", amountPaisa: 4242 }];
    expect(allocateFifoAging(debits, 4242)).toEqual([]);
    // one paisa short must still show a remainder of exactly 1
    expect(allocateFifoAging(debits, 4241)).toEqual([
      { id: "a", date: "2026-01-01", amountPaisa: 4242, remainingPaisa: 1 },
    ]);
  });

  it("9. a debit with zero (already-netted) amount is skipped and consumes no credit", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 0 },
      { id: "b", date: "2026-01-10", amountPaisa: 1000 },
    ];
    const result = allocateFifoAging(debits, 500);
    // the zero-amount row never appears; the 500 credit applies to "b", not wasted on "a"
    expect(result).toEqual([{ id: "b", date: "2026-01-10", amountPaisa: 1000, remainingPaisa: 500 }]);
  });

  it("10. a fully-voided sale (already net-zero after stage-1 netting) never distorts an older invoice's aging", () => {
    // Sale A: Jan 1, khata Rs 500, never paid -- stage-1 net debit is 500 (no returns against it).
    // Sale B: Jan 10, khata Rs 300, fully voided -- stage-1 netting (sale_payments - sale_return_payments
    // for THAT sale) already reduces its net debit to 0 before this function ever sees it.
    // Ground truth: customer owes exactly Rs 500, all from Sale A. A naive single-stage FIFO pool
    // that lumped the void's refund in as a generic credit would have incorrectly shown Sale A at
    // Rs 200 and a fictitious Rs 300 still owed on the voided Sale B (see design review). Because
    // stage 1 already nets sale-return khata refunds against their OWN sale before this function
    // runs, Sale B simply never enters the debits array with a positive amount.
    const stage1Debits = [
      { id: "sale-a", date: "2026-01-01", amountPaisa: 50000 }, // 500 rupees, unpaid
      { id: "sale-b", date: "2026-01-10", amountPaisa: 0 }, // fully voided, netted to 0 in stage 1
    ];
    const result = allocateFifoAging(stage1Debits, 0); // no pool payments recorded
    expect(result).toEqual([{ id: "sale-a", date: "2026-01-01", amountPaisa: 50000, remainingPaisa: 50000 }]);
  });

  it("11. multiple debits: a pool credit landing partway through the second, third left untouched", () => {
    const debits = [
      { id: "a", date: "2026-01-01", amountPaisa: 1000 },
      { id: "b", date: "2026-01-05", amountPaisa: 2000 },
      { id: "c", date: "2026-01-10", amountPaisa: 3000 },
    ];
    const result = allocateFifoAging(debits, 2500); // clears a (1000), partially clears b (1500 of 2000)
    expect(result).toEqual([
      { id: "b", date: "2026-01-05", amountPaisa: 2000, remainingPaisa: 500 },
      { id: "c", date: "2026-01-10", amountPaisa: 3000, remainingPaisa: 3000 },
    ]);
  });

  it("12. follows input array order, not date order -- caller is responsible for pre-sorting", () => {
    // out-of-date-order input: the function must apply credit to the FIRST array element first,
    // not re-sort by date itself (documented precondition, not a silent fix-up).
    const debits = [
      { id: "later", date: "2026-01-10", amountPaisa: 1000 },
      { id: "earlier", date: "2026-01-01", amountPaisa: 1000 },
    ];
    const result = allocateFifoAging(debits, 1000);
    expect(result).toEqual([{ id: "earlier", date: "2026-01-01", amountPaisa: 1000, remainingPaisa: 1000 }]);
  });

  it("13. throws on a negative credit total", () => {
    expect(() => allocateFifoAging([{ id: "a", date: "2026-01-01", amountPaisa: 100 }], -1)).toThrow();
  });
});

describe("computeKhataBalance", () => {
  it("14. debits minus credits, simple arithmetic", () => {
    expect(computeKhataBalance(50000, 20000)).toBe(30000);
    expect(computeKhataBalance(0, 0)).toBe(0);
    expect(computeKhataBalance(10000, 10000)).toBe(0);
  });
});

describe("khata WhatsApp reminder builders", () => {
  it("15. builds a reminder text including the customer name and formatted balance", () => {
    const text = buildKhataReminderText({
      customerName: "Bilal Traders",
      outstandingPaisa: 123456,
      tenantName: "Al-Madina Kiryana Store",
    });
    expect(text).toContain("Bilal Traders");
    expect(text).toContain("Al-Madina Kiryana Store");
    expect(text).toContain("Rs 1,234.56");
  });

  it("16. builds a wa.me url with digits-only phone and encoded text", () => {
    const url = buildWhatsAppReminderUrl("+92 300 1234567", {
      customerName: "Bilal Traders",
      outstandingPaisa: 5000,
      tenantName: "Al-Madina Kiryana Store",
    });
    expect(url.startsWith("https://wa.me/923001234567?text=")).toBe(true);
    expect(url).not.toContain(" ");
  });
});
