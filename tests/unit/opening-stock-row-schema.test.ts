import { describe, expect, it } from "vitest";
import { openingStockRowSchema } from "@/lib/validation";

// csv-parse gives "" for a blank cell, never undefined -- this is what caught a real bug during
// manual browser testing: z.coerce.number().optional() still coerces "" to 0 before the optional
// check applies, so a blank optional numeric column (e.g. purchase_to_stock_factor, which has
// .min(1)) failed validation on every row that simply didn't fill it in, even though leaving it
// blank is the normal, expected case.
describe("openingStockRowSchema: blank CSV cells for optional numeric fields", () => {
  const baseRow = {
    row: 2,
    name_en: "Sprite 500ml",
    stock_unit_key: "piece",
    opening_quantity: "20",
  };

  it("accepts a row where optional numeric columns are blank strings (the common CSV case)", () => {
    const result = openingStockRowSchema.safeParse({
      ...baseRow,
      purchase_to_stock_factor: "",
      sale_to_stock_factor: "",
      reorder_level: "",
      unit_cost_paisa: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchase_to_stock_factor).toBeUndefined();
      expect(result.data.sale_to_stock_factor).toBeUndefined();
      expect(result.data.reorder_level).toBeUndefined();
      expect(result.data.unit_cost_paisa).toBeUndefined();
    }
  });

  it("still coerces a filled-in numeric column correctly", () => {
    const result = openingStockRowSchema.safeParse({
      ...baseRow,
      purchase_to_stock_factor: "24",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchase_to_stock_factor).toBe(24);
    }
  });

  it("still rejects a genuinely invalid (non-blank) value", () => {
    const result = openingStockRowSchema.safeParse({
      ...baseRow,
      purchase_to_stock_factor: "0", // below the min(1) floor -- not blank, a real bad value
    });

    expect(result.success).toBe(false);
  });

  it("treats a blank opening_quantity as 0", () => {
    const result = openingStockRowSchema.safeParse({
      ...baseRow,
      opening_quantity: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.opening_quantity).toBe(0);
    }
  });
});
