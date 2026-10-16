import { describe, expect, it } from "vitest";
import { allocateCost, batchesFor, processLoss, RICE_MILL_TEMPLATE, scaleLines, sharesBySaleValue, sharesValid, yieldPercent } from "@/lib/production";

describe("production calculations (rice mill)", () => {
  const recipeOut = RICE_MILL_TEMPLATE.outputs.map((o) => ({ productId: o.name, quantity: o.quantity, costShare: o.costShare }));

  it("the rice-mill template: 100 kg paddy → 98 kg products, 2 kg loss, shares total 100 %", () => {
    expect(RICE_MILL_TEMPLATE.outputs.reduce((s, o) => s + o.quantity, 0)).toBe(98);
    expect(sharesValid(recipeOut)).toBe(true);
    const loss = processLoss([{ quantity: 100, unitId: "kg" }], RICE_MILL_TEMPLATE.outputs.map((o) => ({ quantity: o.quantity, unitId: "kg" })));
    expect(loss).toEqual({ quantity: 2, percent: 2, totalIn: 100, totalOut: 98 });
  });

  it("scales the recipe by the main material: 1 000 kg paddy = 10 batches → 650 kg rice", () => {
    const b = batchesFor(100, 1000);
    expect(b).toBe(10);
    const scaled = scaleLines(recipeOut, b);
    expect(scaled.map((l) => l.quantity)).toEqual([650, 50, 80, 200]);
    expect(yieldPercent(650, 1000)).toBe(65);
    expect(batchesFor(100, 250)).toBe(2.5);
    expect(batchesFor(0, 100)).toBe(0);
  });

  it("splits the run cost by share; Σ amounts = total cost exactly (ledger stays balanced)", () => {
    // 1 000 kg paddy @ 30 = 30 000 + 2 000 labour/power = 32 000
    const split = allocateCost(32_000, scaleLines(recipeOut, 10).map((l) => ({ quantity: l.quantity, costShare: l.costShare! })));
    expect(split.map((s) => s.amount)).toEqual([28_160, 1_600, 1_600, 640]);
    expect(split.reduce((s, x) => s + x.amount, 0)).toBe(32_000);
    expect(split[0].unitCost).toBeCloseTo(43.3231, 4); // rice per kg
    expect(split[3].unitCost).toBe(3.2); // husk per kg
    // awkward numbers: still exact to the paisa
    const odd = allocateCost(1000.01, [{ quantity: 3, costShare: 33.33 }, { quantity: 7, costShare: 33.33 }, { quantity: 11, costShare: 33.34 }]);
    expect(Math.round(odd.reduce((s, x) => s + x.amount, 0) * 100)).toBe(100001);
  });

  it("cost shares from sale value, exactly 100 %; falls back to quantity without prices", () => {
    const shares = sharesBySaleValue([{ quantity: 650, salePrice: 60 }, { quantity: 50, salePrice: 35 }, { quantity: 80, salePrice: 25 }, { quantity: 200, salePrice: 4 }]);
    expect(Math.round(shares.reduce((s, v) => s + v, 0) * 100)).toBe(10_000);
    expect(shares[0]).toBeGreaterThan(85);
    expect(sharesBySaleValue([{ quantity: 3, salePrice: 0 }, { quantity: 1, salePrice: 0 }])).toEqual([75, 25]);
  });

  it("process loss is not computed for mixed units", () => {
    expect(processLoss([{ quantity: 100, unitId: "kg" }], [{ quantity: 10, unitId: "pcs" }])).toBeNull();
  });
});
