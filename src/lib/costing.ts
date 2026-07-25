/**
 * Weighted-average inventory costing -- the highest-risk logic in the app per plan.md, since a
 * wrong number here silently corrupts every future valuation/margin report. This module is a
 * spec of the algorithm, unit-tested for the pure math; the actual authoritative implementation
 * runs inside the `record_goods_receipt` Postgres RPC (same formula, same rounding policy) because
 * it needs the row lock on `products` that only a transaction can hold. Do not let this file's
 * tests stand in for the RPC-level integration tests -- a divergence between this spec and the
 * deployed SQL (e.g. a missed `::numeric` cast) would only ever be caught by the latter.
 */

import type { Paisa } from "./money";

/**
 * Computes the new running average cost after a batch of stock arrives, using the TOTAL paisa
 * cost of the incoming batch (not a pre-rounded per-unit figure) so only one rounding happens, at
 * the very end -- mirrors complete_sale's "recompute totals from stored rows, round once"
 * discipline. Never called for stock reductions (returns, sales, adjustments) -- removing stock at
 * the current average leaves the average unchanged by construction (S*A - k*A = (S-k)*A).
 */
export function computeWeightedAverageCost(
  currentStockUnits: number,
  currentAvgCostPaisa: Paisa,
  incomingStockUnits: number,
  incomingTotalCostPaisa: Paisa,
): Paisa {
  if (!Number.isInteger(currentStockUnits) || currentStockUnits < 0) {
    throw new Error(`computeWeightedAverageCost: currentStockUnits must be a non-negative integer: ${currentStockUnits}`);
  }
  if (!Number.isInteger(incomingStockUnits) || incomingStockUnits <= 0) {
    throw new Error(`computeWeightedAverageCost: incomingStockUnits must be a positive integer: ${incomingStockUnits}`);
  }
  if (!Number.isInteger(currentAvgCostPaisa) || currentAvgCostPaisa < 0) {
    throw new Error(`computeWeightedAverageCost: currentAvgCostPaisa must be a non-negative integer: ${currentAvgCostPaisa}`);
  }
  if (!Number.isInteger(incomingTotalCostPaisa) || incomingTotalCostPaisa < 0) {
    throw new Error(`computeWeightedAverageCost: incomingTotalCostPaisa must be a non-negative integer: ${incomingTotalCostPaisa}`);
  }

  const totalValueBefore = currentStockUnits * currentAvgCostPaisa;
  const newStockUnits = currentStockUnits + incomingStockUnits;

  return Math.round((totalValueBefore + incomingTotalCostPaisa) / newStockUnits);
}
