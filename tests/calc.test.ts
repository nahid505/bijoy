import { describe, expect, it } from "vitest";
import { computeTotals, lineAmount, paymentStatus, round2, weightedAverageCost } from "@/lib/calc";

describe("round2", () => {
  it("rounds without float drift", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("lineAmount", () => {
  it("applies line discount, never below zero", () => {
    expect(lineAmount({ quantity: 2, unitPrice: 100, discount: 15 })).toBe(185);
    expect(lineAmount({ quantity: 1, unitPrice: 10, discount: 50 })).toBe(0);
  });
});

describe("computeTotals", () => {
  it("line discounts, invoice discount before VAT", () => {
    const t = computeTotals([{ quantity: 10, unitPrice: 100, discount: 50 }, { quantity: 1, unitPrice: 50 }], 100, 15);
    expect(t.subtotal).toBe(1_000);
    expect(t.discount).toBe(100);
    expect(t.vatAmount).toBe(135);
    expect(t.total).toBe(1_035);
  });

  it("caps invoice discount at subtotal", () => {
    expect(computeTotals([{ quantity: 1, unitPrice: 50 }], 80).total).toBe(0);
  });
});

describe("weightedAverageCost", () => {
  it("averages existing and received stock", () => {
    expect(weightedAverageCost(10, 100, 30, 120)).toBe(115);
    expect(weightedAverageCost(0, 80, 5, 95)).toBe(95);
  });
});

describe("paymentStatus", () => {
  it("classifies", () => {
    expect(paymentStatus(100, 100)).toBe("PAID");
    expect(paymentStatus(100, 40)).toBe("PARTIAL");
    expect(paymentStatus(100, 0)).toBe("DUE");
  });
});
