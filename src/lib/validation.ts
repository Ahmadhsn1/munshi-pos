import { z } from "zod";

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const signupSchema = z.object({
  tenantName: z.string().trim().min(2, "Shop name is too short").max(100),
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Shop URL is too short")
    .max(50)
    .regex(slugPattern, "Use lowercase letters, numbers and hyphens only"),
  ownerFullName: z.string().trim().min(2, "Full name is too short").max(100),
  ownerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  ownerPhone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

const pinField = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits");

// A manager gets a real email+password login (full dashboard access, same as an owner, minus a
// few permissions). A cashier never logs in with a real Supabase session at all -- only ever via
// the PIN counter-login flow -- so a cashier's PIN is required, a manager's optional.
export const staffCreateSchema = z.discriminatedUnion("roleKey", [
  z.object({
    roleKey: z.literal("manager"),
    fullName: z.string().trim().min(2, "Full name is too short").max(100),
    phone: z.string().trim().max(20).optional().or(z.literal("")),
    email: z.string().trim().toLowerCase().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
    pin: pinField.optional().or(z.literal("")),
  }),
  z.object({
    roleKey: z.literal("cashier"),
    fullName: z.string().trim().min(2, "Full name is too short").max(100),
    phone: z.string().trim().max(20).optional().or(z.literal("")),
    pin: pinField,
  }),
]);

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const counterLoginSchema = z.object({
  userId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
});

// --- Phase 2: products & inventory ---

export const unitCreateSchema = z.object({
  key: z.string().trim().min(1, "Unit key is required").max(20),
  name: z.string().trim().min(1, "Unit name is required").max(50),
});

export type UnitCreateInput = z.infer<typeof unitCreateSchema>;

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(100),
  parentCategoryId: z.string().uuid().optional().nullable(),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

const barcodeField = z.string().trim().min(1).max(64);

export const productCreateSchema = z.object({
  nameEn: z.string().trim().min(1, "Name is required").max(200),
  nameUr: z.string().trim().max(200).optional().or(z.literal("")),
  categoryId: z.string().uuid().optional().nullable(),
  brand: z.string().trim().max(100).optional().or(z.literal("")),
  stockUnitId: z.string().uuid("Stock unit is required"),
  purchaseUnitId: z.string().uuid().optional().nullable(),
  purchaseToStockFactor: z.number().int().min(1).default(1),
  saleUnitId: z.string().uuid().optional().nullable(),
  saleToStockFactor: z.number().int().min(1).default(1),
  // Percent, e.g. "17.5" or 17.5 -- converted/range-validated via lib/tax.ts's toBps() in the
  // route handler, not duplicated here.
  taxRatePercent: z.union([z.string(), z.number()]).optional(),
  // Rupees, e.g. "45.00" -- converted/validated via lib/money.ts's toPaisa() in the route
  // handler, matching taxRatePercent's client-friendly-string-in/paisa-out convention.
  salePriceRupees: z.union([z.string(), z.number()]).optional(),
  reorderLevel: z.number().int().min(0).default(0),
  imagePath: z.string().trim().max(500).optional().nullable(),
  barcodes: z.array(barcodeField).max(20).optional().default([]),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = productCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  quantityDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, "Adjustment quantity cannot be zero"),
  reasonCode: z.enum(["damage", "theft", "wastage", "recount", "other"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// A CSV always includes every column as a string, even when the shopkeeper left it blank --
// csv-parse gives "" for an empty cell, not undefined. Plain `z.coerce.number().optional()`
// doesn't help there: z.coerce still coerces "" to 0 before the optional check ever applies,
// which then fails a `.min(1)` constraint on a field that was only ever meant to be skippable.
// Blank out empty strings to undefined before coercion runs.
function csvOptionalInt(min: number) {
  return z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.coerce.number().int().min(min).optional(),
  );
}

// One row of a parsed opening-stock CSV. Values arrive as strings from csv-parse, hence
// z.coerce for numeric fields -- unlike productCreateSchema, which validates a real JSON body
// with real number types from the product form.
export const openingStockRowSchema = z.object({
  row: z.number().int().min(1),
  name_en: z.string().trim().min(1, "Product name is required").max(200),
  name_ur: z.string().trim().max(200).optional().or(z.literal("")),
  category_name: z.string().trim().max(100).optional().or(z.literal("")),
  brand: z.string().trim().max(100).optional().or(z.literal("")),
  barcode: barcodeField.optional().or(z.literal("")),
  stock_unit_key: z.string().trim().min(1, "Stock unit is required").max(20),
  purchase_unit_key: z.string().trim().max(20).optional().or(z.literal("")),
  purchase_to_stock_factor: csvOptionalInt(1),
  sale_unit_key: z.string().trim().max(20).optional().or(z.literal("")),
  sale_to_stock_factor: csvOptionalInt(1),
  // Percent (e.g. "17.5"), matching how a shopkeeper would actually fill a spreadsheet column --
  // converted to basis points via lib/tax.ts's toBps() before being sent to the
  // import_opening_stock RPC, which stores tax_rate_bps directly.
  tax_rate_percent: z.string().trim().optional().or(z.literal("")),
  reorder_level: csvOptionalInt(0),
  opening_quantity: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? 0 : val),
    z.coerce.number().int().min(0),
  ),
  unit_cost_paisa: csvOptionalInt(0),
});

export type OpeningStockRowInput = z.infer<typeof openingStockRowSchema>;

// --- Phase 3: point of sale ---

export const shiftOpenSchema = z.object({
  openingCashPaisa: z.number().int().min(0),
});

export type ShiftOpenInput = z.infer<typeof shiftOpenSchema>;

export const shiftCloseSchema = z.object({
  actualCashPaisa: z.number().int().min(0),
  closingNote: z.string().trim().max(500).optional().or(z.literal("")),
});

export type ShiftCloseInput = z.infer<typeof shiftCloseSchema>;

export const cartLineItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1), // sale_unit terms
  lineDiscountPaisa: z.number().int().min(0).default(0),
});

export type CartLineItemInput = z.infer<typeof cartLineItemSchema>;

export const saleDraftCreateSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  heldLabel: z.string().trim().max(100).optional().or(z.literal("")),
  lines: z.array(cartLineItemSchema).min(1, "Add at least one item"),
});

export type SaleDraftCreateInput = z.infer<typeof saleDraftCreateSchema>;

export const saleDraftUpdateSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  heldLabel: z.string().trim().max(100).optional().or(z.literal("")),
  lines: z.array(cartLineItemSchema).min(1, "Add at least one item"),
});

export type SaleDraftUpdateInput = z.infer<typeof saleDraftUpdateSchema>;

const paymentEntrySchema = z.object({
  paymentMode: z.enum(["cash", "khata", "jazzcash", "easypaisa"]),
  amountPaisa: z.number().int().min(1),
  referenceText: z.string().trim().max(100).optional().or(z.literal("")),
});

export const checkoutSchema = z.object({
  billDiscountPaisa: z.number().int().min(0).default(0),
  roundOffPaisa: z.number().int().default(0),
  payments: z.array(paymentEntrySchema).min(1, "Add at least one payment"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const saleReturnSchema = z.object({
  reasonCode: z.enum(["defective", "wrong_item", "customer_changed_mind", "other"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        saleLineItemId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1, "Select at least one item to return"),
  refundPayments: z.array(paymentEntrySchema).min(1, "Add at least one refund payment"),
});

export type SaleReturnInput = z.infer<typeof saleReturnSchema>;

export const customerQuickAddSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});

export type CustomerQuickAddInput = z.infer<typeof customerQuickAddSchema>;

// --- Phase 4: purchases & suppliers ---

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  creditTermsDays: z.number().int().min(0).optional().nullable(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;

export const supplierUpdateSchema = supplierCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export const purchaseLineItemSchema = z
  .object({
    productId: z.string().uuid(),
    batchNumber: z.string().trim().max(100).optional().or(z.literal("")),
    expiryDate: z.string().trim().optional().or(z.literal("")), // ISO date string, e.g. "2027-01-31"
    quantity: z.number().int().min(1), // purchase_unit terms
    unitCostPaisa: z.number().int().min(0),
    discountPaisa: z.number().int().min(0).default(0),
    isFreeGoods: z.boolean().default(false),
  })
  .refine((line) => !line.isFreeGoods || (line.unitCostPaisa === 0 && line.discountPaisa === 0), {
    message: "A free-goods line must have zero unit cost and zero discount",
    path: ["unitCostPaisa"],
  });

export type PurchaseLineItemInput = z.infer<typeof purchaseLineItemSchema>;

export const purchaseDraftCreateSchema = z.object({
  supplierId: z.string().uuid(),
  supplierInvoiceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  purchaseDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  lines: z.array(purchaseLineItemSchema).min(1, "Add at least one item"),
});

export type PurchaseDraftCreateInput = z.infer<typeof purchaseDraftCreateSchema>;

export const purchaseDraftUpdateSchema = purchaseDraftCreateSchema;

export type PurchaseDraftUpdateInput = z.infer<typeof purchaseDraftUpdateSchema>;

export const goodsReceiptSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        purchaseLineItemId: z.string().uuid(),
        // purchase_unit terms -- the unit the person physically counting cartons is looking at.
        quantityReceivedPurchaseUnits: z.number().int().min(1),
      }),
    )
    .min(1, "Select at least one item to receive"),
});

export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const purchaseReturnSchema = z.object({
  reasonCode: z.enum(["damaged", "wrong_item", "expired", "other"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        purchaseLineItemId: z.string().uuid(),
        quantity: z.number().int().min(1), // stock_unit terms
      }),
    )
    .min(1, "Select at least one item to return"),
});

export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>;

export const purchasePaymentSchema = z.object({
  paymentMode: z.enum(["cash", "bank_transfer", "cheque", "jazzcash", "easypaisa"]),
  amountPaisa: z.number().int().min(1),
  referenceText: z.string().trim().max(100).optional().or(z.literal("")),
  paidAt: z.string().trim().optional().or(z.literal("")),
});

export type PurchasePaymentInput = z.infer<typeof purchasePaymentSchema>;

// --- Phase 5: customer & khata ---

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  creditLimitPaisa: z.number().int().min(0).optional().nullable(),
  priceTier: z.string().trim().max(50).optional().or(z.literal("")),
  isBlacklisted: z.boolean().optional(),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerPaymentSchema = z.object({
  paymentMode: z.enum(["cash", "bank_transfer", "cheque", "jazzcash", "easypaisa"]),
  amountPaisa: z.number().int().min(1),
  referenceText: z.string().trim().max(100).optional().or(z.literal("")),
  paidAt: z.string().trim().optional().or(z.literal("")),
});

export type CustomerPaymentInput = z.infer<typeof customerPaymentSchema>;

// --- Phase 6: expenses, cash book & reports ---

export const expenseCategoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});

export type ExpenseCategoryCreateInput = z.infer<typeof expenseCategoryCreateSchema>;

export const expenseCreateSchema = z.object({
  categoryId: z.string().uuid("Pick a category"),
  amountPaisa: z.number().int().min(1, "Amount must be more than zero"),
  paymentMode: z.enum(["cash", "bank_transfer", "cheque", "jazzcash", "easypaisa"]),
  note: z.string().trim().max(300).optional().or(z.literal("")),
  expenseDate: z.string().trim().optional().or(z.literal("")),
  /**
   * "Did this money come out of the counter drawer?" -- asked explicitly rather than inferred from
   * paymentMode, because cash paid from the office safe or the owner's own pocket is still a cash
   * expense but must NOT move the cashier's expected drawer total. Only honoured for cash; the
   * route drops it otherwise and a DB check constraint enforces the same pairing independently.
   */
  paidFromCounterCash: z.boolean().optional(),
});

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

// Absolute rule 4: financial records are never hard-deleted, so voiding demands a reason. Required
// and non-empty on purpose -- an audit trail of blank reasons is no audit trail.
export const expenseVoidSchema = z.object({
  voidReason: z.string().trim().min(1, "A reason is required").max(300),
});

export type ExpenseVoidInput = z.infer<typeof expenseVoidSchema>;

/**
 * Report date range. Both ends are inclusive business dates (Asia/Karachi), matching
 * public.business_date() on the SQL side -- never the server's UTC date, which would file the first
 * five hours of every Pakistani day under yesterday (see migration 20260726000007).
 */
export const reportRangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid from date"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid to date"),
  })
  .refine((r) => r.from <= r.to, {
    message: "The start date must not be after the end date",
    path: ["from"],
  });

export type ReportRangeInput = z.infer<typeof reportRangeSchema>;
