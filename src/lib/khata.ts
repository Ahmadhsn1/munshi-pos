import { formatPKR, type Paisa } from "@/lib/money";

/**
 * Khata (credit ledger) aging allocation. A customer's balance is never stored -- it's always
 * computed fresh from sale_payments/sale_return_payments/customer_payments (see complete_sale's
 * own balance formula). The aging REPORT needs more than a total balance though: it needs to know
 * how OLD each unpaid rupee is, which requires allocating payments against specific sales.
 *
 * This is a two-stage model, not a single lumped FIFO pool:
 *   Stage 1 (exact, done by the caller before calling this function): net each sale's own khata
 *     debit against ITS OWN khata refunds (sale_return_payments joined via sale_returns.sale_id).
 *     A sale-return refund has a known, specific sale to net against -- lumping it into a generic
 *     credit pool can misattribute a voided sale's reversal onto a DIFFERENT, older, still-
 *     outstanding invoice (proven with a concrete before/after example during design review).
 *   Stage 2 (this function): apply customer_payments -- the genuinely unattributed "paid on
 *     account" pool, with no sale to net against -- oldest sale first, against what's left of
 *     stage 1's per-sale debits.
 */

export interface KhataDebit {
  id: string;
  date: string; // ISO date string
  amountPaisa: Paisa; // stage-1 net debit for this sale (already netted against its own returns)
}

export interface AgedKhataDebit extends KhataDebit {
  remainingPaisa: Paisa;
}

/**
 * Applies `totalCreditsPaisa` (customer_payments pool only) against `debits` oldest-first.
 * `debits` must already be sorted ascending by date and must already be net of that sale's own
 * khata refunds (stage 1) -- this function only performs stage 2. Returns only debits with a
 * positive remaining balance.
 */
export function allocateFifoAging(debits: KhataDebit[], totalCreditsPaisa: Paisa): AgedKhataDebit[] {
  if (totalCreditsPaisa < 0) {
    throw new Error(`allocateFifoAging: totalCreditsPaisa cannot be negative: ${totalCreditsPaisa}`);
  }

  let remainingCredit = totalCreditsPaisa;
  const result: AgedKhataDebit[] = [];

  for (const debit of debits) {
    if (debit.amountPaisa <= 0) {
      continue;
    }

    const applied = Math.min(debit.amountPaisa, remainingCredit);
    remainingCredit -= applied;
    const remainingPaisa = debit.amountPaisa - applied;

    if (remainingPaisa > 0) {
      result.push({ ...debit, remainingPaisa });
    }
  }

  return result;
}

/** Simple, order-independent running balance (debits minus all credits, both sale-return khata
 * refunds and customer_payments pool payments) -- used for the customer detail page's ledger and
 * the WhatsApp reminder text. Deliberately NOT the aging computation above: a running total has
 * no misattribution risk the way aging's per-invoice bucketing does. */
export function computeKhataBalance(khataDebitsPaisa: Paisa, khataCreditsPaisa: Paisa): Paisa {
  return khataDebitsPaisa - khataCreditsPaisa;
}

export interface KhataReminderInput {
  customerName: string;
  outstandingPaisa: Paisa;
  tenantName: string;
}

/** Mirrors lib/receipt.ts's buildReceiptSummaryText/buildWhatsAppReceiptUrl pattern exactly --
 * same wa.me deep link, no WhatsApp Business API, no scheduling (manual "send reminder" button
 * only, per plan.md). */
export function buildKhataReminderText(input: KhataReminderInput): string {
  return [
    input.tenantName,
    `Dear ${input.customerName}, this is a reminder of your outstanding balance:`,
    formatPKR(input.outstandingPaisa),
    "Please arrange payment at your earliest convenience. Thank you.",
  ].join("\n");
}

/** `phone` should already be in international format without a leading "+" (e.g.
 * "923001234567") -- wa.me requires this. */
export function buildWhatsAppReminderUrl(phone: string, input: KhataReminderInput): string {
  const digitsOnly = phone.replace(/\D/g, "");
  const text = encodeURIComponent(buildKhataReminderText(input));
  return `https://wa.me/${digitsOnly}?text=${text}`;
}
