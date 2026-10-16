import { describe, expect, it } from "vitest";
import { KG_PER_MON, monAndKg, paddyFigures } from "@/lib/paddy";
import { paddyPurchaseSchema } from "@/lib/validation";

describe("paddy purchase calculations", () => {
  it("net = gross − dhalta, mon = net ÷ 40 (2 dp), total = mon × rate", () => {
    expect(KG_PER_MON).toBe(40);
    // 1 050 − 13 = 1 037 kg → 25.925 → 25.93 mon × 1 250 = 32 412.50
    expect(paddyFigures({ grossKg: 1050, dhaltaKg: 13, ratePerMon: 1250 })).toEqual({ netKg: 1037, mon: 25.93, totalPrice: 32412.5 });
    expect(paddyFigures({ grossKg: 4000, dhaltaKg: 0, ratePerMon: 1300 })).toEqual({ netKg: 4000, mon: 100, totalPrice: 130000 });
    // fractional kg: 1 234.5 − 4.25 = 1 230.25 → 30.75625 → 30.76 mon × 1 199.5 = 36 896.62
    expect(paddyFigures({ grossKg: 1234.5, dhaltaKg: 4.25, ratePerMon: 1199.5 })).toEqual({ netKg: 1230.25, mon: 30.76, totalPrice: 36896.62 });
  });

  it("never negative and tolerant of blanks (live form preview)", () => {
    expect(paddyFigures({ grossKg: 10, dhaltaKg: 20, ratePerMon: 100 })).toEqual({ netKg: 0, mon: 0, totalPrice: 0 });
    expect(paddyFigures({ grossKg: NaN, dhaltaKg: NaN, ratePerMon: NaN })).toEqual({ netKg: 0, mon: 0, totalPrice: 0 });
  });

  it("mon + kg split for the slip", () => {
    expect(monAndKg(1037)).toEqual({ mon: 25, kg: 37 });
    expect(monAndKg(39.5)).toEqual({ mon: 0, kg: 39.5 });
    expect(monAndKg(80)).toEqual({ mon: 2, kg: 0 });
  });

  it("validation: bag count is a whole number, dhalta below gross, cash purchase needs an account", () => {
    const base = { date: "2026-10-14", productId: "p1", bagCount: "30", grossKg: "1050", dhaltaKg: "13", ratePerMon: "1250", partyAccountId: "s1", paidAmount: "0", cashAccountId: "", notes: "ট্রাক ঢাকা-মেট্রো ১২৩৪" };
    const ok = paddyPurchaseSchema.safeParse(base);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ bagCount: 30, grossKg: 1050, dhaltaKg: 13, ratePerMon: 1250, notes: "ট্রাক ঢাকা-মেট্রো ১২৩৪" });
    const path = (o: object) => {
      const r = paddyPurchaseSchema.safeParse({ ...base, ...o });
      return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    };
    expect(path({ bagCount: "2.5" })).toContain("bagCount");
    expect(path({ bagCount: "-1" })).toContain("bagCount");
    expect(path({ dhaltaKg: "1050" })).toContain("dhaltaKg");
    expect(path({ dhaltaKg: "-1" })).toContain("dhaltaKg");
    expect(path({ grossKg: "0" })).toContain("grossKg");
    expect(path({ ratePerMon: "0" })).toContain("ratePerMon");
    expect(path({ partyAccountId: "" })).toContain("cashAccountId");
    expect(path({ paidAmount: "500" })).toContain("cashAccountId");
    expect(path({ notes: "x".repeat(501) })).toContain("notes");
    expect(path({ bagCount: "" })).toEqual([]);
  });
});
