/**
 * Multi-UOM conversion helpers. Every product has a `stock_unit` -- the atomic, most-granular
 * unit stock is tracked/adjusted in, always as an integer quantity. `purchase_unit` and
 * `sale_unit` are each independently convertible to stock_unit via a single integer
 * `conversionFactor` ("1 [purchase/sale] unit = N stock units"). A chain like carton->packet->
 * gram is mathematically just a composition of two such factors, so this flat model (each unit
 * independently convertible to the one stock_unit) is equivalent and much simpler to query than
 * a recursive/chained conversion table.
 */

/** Converts a quantity expressed in a purchase/sale unit into stock_unit terms (e.g. "3 cartons"
 * with conversionFactor 24 -> 72 stock units). Always exact -- integer * integer -- since this is
 * the storage direction. Throws on a non-integer/negative quantity or a factor below 1. */
export function toStockQuantity(quantityInOtherUnit: number, conversionFactor: number): number {
  if (!Number.isInteger(quantityInOtherUnit) || quantityInOtherUnit < 0) {
    throw new Error(`toStockQuantity: quantity must be a non-negative integer: ${quantityInOtherUnit}`);
  }

  if (!Number.isInteger(conversionFactor) || conversionFactor < 1) {
    throw new Error(`toStockQuantity: conversionFactor must be an integer >= 1: ${conversionFactor}`);
  }

  return quantityInOtherUnit * conversionFactor;
}

/** Converts a stock_unit quantity back into a purchase/sale unit, for display only -- e.g. "72
 * stock units" with conversionFactor 24 -> 3. Can be fractional (e.g. 80 / 24 = 3.33 cartons);
 * never feed the result back into a stock write, only render it. */
export function fromStockQuantity(stockQuantity: number, conversionFactor: number): number {
  if (!Number.isInteger(stockQuantity)) {
    throw new Error(`fromStockQuantity: stockQuantity must be an integer: ${stockQuantity}`);
  }

  if (!Number.isInteger(conversionFactor) || conversionFactor < 1) {
    throw new Error(`fromStockQuantity: conversionFactor must be an integer >= 1: ${conversionFactor}`);
  }

  return stockQuantity / conversionFactor;
}

/** Formats a stock_unit quantity alongside a unit name for display, e.g. (72, "packet") ->
 * "72 packet". Kept deliberately simple (no pluralization rules -- Urdu/English unit names in
 * this project don't follow English plural conventions uniformly). */
export function formatQuantity(stockQuantity: number, unitName: string): string {
  if (!Number.isInteger(stockQuantity)) {
    throw new Error(`formatQuantity: stockQuantity must be an integer: ${stockQuantity}`);
  }

  return `${stockQuantity} ${unitName}`;
}
