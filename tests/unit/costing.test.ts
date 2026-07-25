import { describe, expect, it } from "vitest";
import { computeWeightedAverageCost } from "@/lib/costing";

describe("computeWeightedAverageCost", () => {
  it("first purchase into empty stock: average equals the incoming unit cost", () => {
    // 10 units at Rs 20.00 (2000 paisa) each -> total 20000 paisa
    expect(computeWeightedAverageCost(0, 0, 10, 20000)).toBe(2000);
  });

  it("second purchase at a different rate: blends into a true weighted average", () => {
    // Holding 10 units @ Rs 20.00 (avg 2000), receive 10 more @ Rs 30.00 (total 30000)
    // Expected avg: (10*2000 + 30000) / 20 = 50000 / 20 = 2500 (Rs 25.00)
    expect(computeWeightedAverageCost(10, 2000, 10, 30000)).toBe(2500);
  });

  it("free goods (zero cost) dilutes the average correctly", () => {
    // Holding 10 units @ Rs 20.00 (avg 2000), receive 10 free units (total cost 0)
    // Expected avg: (10*2000 + 0) / 20 = 20000 / 20 = 1000 (Rs 10.00)
    expect(computeWeightedAverageCost(10, 2000, 10, 0)).toBe(1000);
  });

  it("uses the net (discounted) total cost, not a gross per-unit figure", () => {
    // Holding 0 units, receive 5 units where gross cost is 5*1000=5000 but a 500 paisa discount
    // applies -- caller is responsible for passing the NET total (4500), matching what the
    // record_goods_receipt RPC computes before calling the equivalent SQL formula.
    expect(computeWeightedAverageCost(0, 0, 5, 4500)).toBe(900); // Rs 9.00 per unit
  });

  it("rounds to the nearest paisa when the division doesn't divide evenly", () => {
    // 3 units at a total cost of 100 paisa -> 33.33... rounds to 33
    expect(computeWeightedAverageCost(0, 0, 3, 100)).toBe(33);
    // 3 units at a total cost of 200 paisa -> 66.66... rounds to 67
    expect(computeWeightedAverageCost(0, 0, 3, 200)).toBe(67);
  });

  it("a stale nonzero average with zero current stock is ignored (drops out of the numerator)", () => {
    // current_stock=0 means the 0*currentAvg term vanishes regardless of what currentAvg is --
    // covers the "return brought stock to exactly 0, then a new purchase arrives" sequence.
    expect(computeWeightedAverageCost(0, 99999, 4, 4000)).toBe(1000);
  });

  it("multi-step sequence converges to the correct running average", () => {
    let stock = 0;
    let avg = 0;

    // Purchase 1: 10 @ Rs 10.00
    avg = computeWeightedAverageCost(stock, avg, 10, 10000);
    stock += 10;
    expect(avg).toBe(1000);

    // Purchase 2: 5 @ Rs 16.00
    avg = computeWeightedAverageCost(stock, avg, 5, 8000);
    stock += 5;
    // (10*1000 + 8000) / 15 = 18000/15 = 1200
    expect(avg).toBe(1200);

    // Purchase 3: 15 free units (total cost 0)
    avg = computeWeightedAverageCost(stock, avg, 15, 0);
    stock += 15;
    // (15*1200 + 0) / 30 = 18000/30 = 600
    expect(avg).toBe(600);
  });

  it("throws when incoming stock units is zero or negative", () => {
    expect(() => computeWeightedAverageCost(10, 1000, 0, 5000)).toThrow();
    expect(() => computeWeightedAverageCost(10, 1000, -1, 5000)).toThrow();
  });

  it("throws on non-integer or negative current stock/cost inputs", () => {
    expect(() => computeWeightedAverageCost(-1, 1000, 10, 5000)).toThrow();
    expect(() => computeWeightedAverageCost(10, -1, 10, 5000)).toThrow();
    expect(() => computeWeightedAverageCost(10.5, 1000, 10, 5000)).toThrow();
    expect(() => computeWeightedAverageCost(10, 1000, 10, -5000)).toThrow();
  });
});
