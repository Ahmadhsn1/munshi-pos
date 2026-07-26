import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  cleanupUser,
  createAdminClient,
  createOpenSale,
  createOpenShift,
  createTenantWithOwner,
  createTestCustomer,
  createTestProduct,
  getUnitIdByKey,
  giveProductStock,
  type TenantFixture,
} from "./helpers";
import { businessToday } from "@/lib/reports";

/**
 * Builds one full business day -- mixed cash/khata sales, a partial return, a full void, a cash
 * khata payment, and a cash expense -- and cross-checks every Phase 6 report RPC against numbers
 * computed independently by hand in this test. This is plan.md's explicit Phase 6 testing
 * checklist item: "every report cross-checked against raw ledger data for at least one full day of
 * dummy transactions."
 *
 * The scenario is deliberately built to exercise the two documented gotchas at once: a voided
 * sale's revenue/COGS must net to zero (see get_sales_summary's comment), and cash khata receipts
 * plus cash expenses must both move the cash book (see the shift-close fix).
 */
describe("Phase 6 reports reconcile against a hand-built full business day", () => {
  const admin: SupabaseClient = createAdminClient();
  let tenant: TenantFixture;
  let stockUnitId: string;
  let shiftId: string;
  let customerId: string;
  let productA: string; // sale price 200, cost 120 -> 40% margin
  let productB: string; // sale price 500, cost 350 -> 30% margin
  // MUST be the Asia/Karachi business date, not a UTC one -- fixture rows are stamped with real
  // `now()`, and every report RPC buckets by public.business_date() (Karachi), not ::date (UTC).
  // Using a naive `new Date().toISOString().slice(0, 10)` here would make this test itself flaky
  // for exactly the 19:00-24:00 UTC window that's already bitten this project once (see migration
  // 20260726000007) -- the fixtures would land in "tomorrow" by Karachi reckoning while the test
  // queries "today" by UTC reckoning.
  const today = businessToday();

  beforeAll(async () => {
    tenant = await createTenantWithOwner(admin, "reports-recon");
    stockUnitId = await getUnitIdByKey(admin, tenant.tenantId, "piece");
    customerId = await createTestCustomer(admin, tenant.tenantId);

    productA = await createTestProduct(admin, tenant.tenantId, stockUnitId, {
      sale_price_paisa: 20000,
      avg_cost_paisa: 12000,
    });
    productB = await createTestProduct(admin, tenant.tenantId, stockUnitId, {
      sale_price_paisa: 50000,
      avg_cost_paisa: 35000,
    });
    await giveProductStock(admin, tenant.tenantId, productA, 100, tenant.ownerId);
    await giveProductStock(admin, tenant.tenantId, productB, 100, tenant.ownerId);

    shiftId = await createOpenShift(admin, tenant.tenantId, tenant.ownerId, tenant.ownerId, 5000_00);

    // Sale 1: cash, 2x product A = Rs 400.
    const sale1 = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId: productA, quantity: 2, unitPricePaisa: 20000 },
    ]);
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: sale1,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 40000 }],
    });

    // Sale 2: khata, 1x product B = Rs 500.
    const sale2 = await createOpenSale(
      admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId,
      [{ productId: productB, quantity: 1, unitPricePaisa: 50000 }],
      customerId,
    );
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: sale2,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "khata", amount_paisa: 50000 }],
    });

    // Sale 3: cash, 3x product A = Rs 600, later PARTIALLY returned (1 unit, Rs 200 cash refund).
    const sale3 = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId: productA, quantity: 3, unitPricePaisa: 20000 },
    ]);
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: sale3,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 60000 }],
    });
    const { data: sale3Line } = await admin
      .from("sale_line_items").select("id").eq("sale_id", sale3).single();
    await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: sale3,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "customer_changed_mind",
      p_note: null,
      p_lines: [{ sale_line_item_id: sale3Line!.id, quantity: 1 }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 20000 }],
      p_mark_sale_void: false,
    });

    // Sale 4: cash, 1x product B = Rs 500, FULLY VOIDED. Must contribute ZERO net revenue and COGS.
    const sale4 = await createOpenSale(admin, tenant.tenantId, shiftId, tenant.ownerId, tenant.ownerId, [
      { productId: productB, quantity: 1, unitPricePaisa: 50000 },
    ]);
    await admin.rpc("complete_sale", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: sale4,
      p_bill_discount_paisa: 0,
      p_round_off_paisa: 0,
      p_payments: [{ payment_mode: "cash", amount_paisa: 50000 }],
    });
    const { data: sale4Line } = await admin
      .from("sale_line_items").select("id, quantity").eq("sale_id", sale4).single();
    await admin.rpc("record_sale_return", {
      p_tenant_id: tenant.tenantId,
      p_sale_id: sale4,
      p_shift_id: shiftId,
      p_cashier_user_id: tenant.ownerId,
      p_session_user_id: tenant.ownerId,
      p_reason_code: "void",
      p_note: "test void",
      p_lines: [{ sale_line_item_id: sale4Line!.id, quantity: sale4Line!.quantity }],
      p_refund_payments: [{ payment_mode: "cash", amount_paisa: 50000 }],
      p_mark_sale_void: true,
    });

    // Cash khata payment: Rs 300 collected at this counter.
    await admin.from("customer_payments").insert({
      tenant_id: tenant.tenantId,
      customer_id: customerId,
      payment_mode: "cash",
      amount_paisa: 300_00,
      shift_id: shiftId,
      created_by: tenant.ownerId,
    });

    // Cash expense: Rs 50 chai from the drawer.
    const { data: category } = await admin
      .from("expense_categories")
      .select("id").eq("tenant_id", tenant.tenantId).eq("key", "tea_food").single();
    await admin.from("expenses").insert({
      tenant_id: tenant.tenantId,
      category_id: category!.id,
      amount_paisa: 50_00,
      payment_mode: "cash",
      shift_id: shiftId,
      created_by: tenant.ownerId,
    });
  });

  afterAll(async () => {
    await cleanupUser(admin, tenant.ownerId);
    await cleanupTenant(admin, tenant.tenantId);
  });

  it("get_sales_summary nets the void to zero and reconciles revenue/COGS by hand", async () => {
    const { data } = await admin.rpc("get_sales_summary", {
      p_tenant_id: tenant.tenantId, p_from: today, p_to: today,
    });
    const row = (data ?? [])[0];

    // Gross completed-sale totals: 400 + 500 + 600 + 500 = 2000. Returns: 200 (partial) + 500
    // (void) = 700. Net revenue = 2000 - 700 = 1300.
    expect(row.revenue_paisa).toBe(1300_00);

    // COGS: sale1 (2*120=240) + sale2 (350) + sale3 (3*120=360, netted by return of 1*120=120 ->
    // 240) + sale4 (120... wait product B cost 350, netted by its own full return -> 0).
    // = 240 + 350 + 240 + 0 = 830.
    expect(row.cogs_paisa).toBe(830_00);
    expect(row.transaction_count).toBe(4); // sale4 is 'void' status, sale1-3 are 'completed'
  });

  it("get_product_sales matches per-product hand computation, net of returns and void", async () => {
    const { data } = await admin.rpc("get_product_sales", {
      p_tenant_id: tenant.tenantId, p_from: today, p_to: today,
    });
    const rows = data as { product_id: string; quantity_sold_net: number; revenue_paisa: number; cogs_paisa: number }[];

    const a = rows.find((r) => r.product_id === productA)!;
    // Sold: 2 (sale1) + 3 (sale3) = 5. Returned: 1 (sale3 partial). Net = 4.
    expect(a.quantity_sold_net).toBe(4);
    // Revenue ex-tax: (2+3)*200 - 1*200 = 1000 - 200 = 800.
    expect(a.revenue_paisa).toBe(800_00);
    expect(a.cogs_paisa).toBe(4 * 120_00);

    const b = rows.find((r) => r.product_id === productB)!;
    // Sold: 1 (sale2) + 1 (sale4, voided) = 2. Returned: 1 (sale4's full void-return). Net = 1.
    expect(b.quantity_sold_net).toBe(1);
    expect(b.revenue_paisa).toBe(500_00);
    expect(b.cogs_paisa).toBe(1 * 350_00);
  });

  it("get_cashier_report attributes sales, returns and the void correctly", async () => {
    const { data } = await admin.rpc("get_cashier_report", {
      p_tenant_id: tenant.tenantId, p_from: today, p_to: today,
    });
    const row = (data ?? []).find((r: { cashier_user_id: string }) => r.cashier_user_id === tenant.ownerId)!;

    expect(row.sale_count).toBe(3); // sale1, sale2, sale3 -- sale4 excluded (status='void')
    expect(row.revenue_paisa).toBe(400_00 + 500_00 + 600_00); // sale4's total NOT counted
    expect(row.return_count).toBe(2); // the partial return AND the void's return row
    expect(row.return_paisa).toBe(200_00 + 500_00);
    expect(row.void_count).toBe(1);
  });

  it("get_stock_valuation values remaining stock at avg cost", async () => {
    const { data } = await admin.rpc("get_stock_valuation", { p_tenant_id: tenant.tenantId });
    const rows = data as { product_id: string; current_stock: number; valuation_paisa: number }[];

    const a = rows.find((r) => r.product_id === productA)!;
    // Opened with 100, net sold 4 (see above) -> 96 remaining. Valued at cost 120.
    expect(a.current_stock).toBe(96);
    expect(a.valuation_paisa).toBe(96 * 120_00);

    const b = rows.find((r) => r.product_id === productB)!;
    // Opened with 100, net sold 1 -> 99 remaining. Valued at cost 350.
    expect(b.current_stock).toBe(99);
    expect(b.valuation_paisa).toBe(99 * 350_00);
  });

  it("get_cash_book counts the khata receipt in and the expense out, alongside sales/refunds", async () => {
    const { data } = await admin.rpc("get_cash_book", {
      p_tenant_id: tenant.tenantId, p_from: today, p_to: today,
    });
    const row = (data ?? [])[0];

    // Cash sales: 400 (sale1) + 600 (sale3) + 500 (sale4, still cash-in even though later voided)
    // = 1500. Khata receipts: 300. Refunds: 200 (partial) + 500 (void) = 700. Expenses: 50.
    expect(row.cash_sales_paisa).toBe(1500_00);
    expect(row.khata_receipts_paisa).toBe(300_00);
    expect(row.refunds_paisa).toBe(700_00);
    expect(row.expenses_paisa).toBe(50_00);
    expect(row.net_cash_paisa).toBe(1500_00 + 300_00 - 700_00 - 50_00);
  });
});
