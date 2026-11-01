import { describe, expect, it } from "vitest";
import { NAV, NAV_LABEL_EN } from "@/lib/nav";
import { findReport, reportOpenFor } from "@/server/reports/registry";
import { round2 } from "@/lib/calc";

describe("Production & Yield Summary Report Specifications", () => {
  it("nav includes production-yield-summary under reports", () => {
    const reportsMenu = NAV.find((e) => e.key === "reports");
    expect(reportsMenu).toBeDefined();
    expect(reportsMenu?.children).toBeDefined();

    const entry = reportsMenu?.children?.find((c) => c.href === "/reports/production-yield-summary");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("উৎপাদন ও ফলন রিপোর্ট");
    expect(entry?.permission).toBe("reports:view");
  });

  it("nav English label dictionary has translation for the report", () => {
    expect(NAV_LABEL_EN["উৎপাদন ও ফলন রিপোর্ট"]).toBe("Production & Yield Report");
  });

  it("registry has production-yield-summary report registered", () => {
    const report = findReport("production-yield-summary");
    expect(report).toBeDefined();
    expect(report?.slug).toBe("production-yield-summary");
    expect(report?.title).toBe("উৎপাদন ও ফলন সারসংক্ষেপ রিপোর্ট");
  });

  it("report is permitted for party-scoped / restricted roles", () => {
    const ctx = {
      partyScope: {
        customers: ["c1"],
        suppliers: ["s1"],
        accounts: null,
      },
    };
    expect(reportOpenFor(ctx, "production-yield-summary")).toBe(true);
  });

  it("yield formula calculation matches requirements for 75 KG standard", () => {
    // Total Produced Rice (KG) = 6500, Total Processed Paddy (KG) = 10000, Bag = 75 KG
    const totalPaddy = 10000;
    const riceKg = 6500;
    const bagKg = 75;

    const yieldPerBag = round2((riceKg * bagKg) / totalPaddy);
    const yieldPct = round2((riceKg / totalPaddy) * 100);

    expect(yieldPerBag).toBe(48.75); // 48.75 KG per 75 KG bag
    expect(yieldPct).toBe(65.0); // 65%
  });

  it("yield formula calculation matches requirements for 80 KG standard", () => {
    // Total Produced Rice (KG) = 6500, Total Processed Paddy (KG) = 10000, Bag = 80 KG
    const totalPaddy = 10000;
    const riceKg = 6500;
    const bagKg = 80;

    const yieldPerBag = round2((riceKg * bagKg) / totalPaddy);
    const yieldPct = round2((riceKg / totalPaddy) * 100);

    expect(yieldPerBag).toBe(52.0); // 52.00 KG per 80 KG bag
    expect(yieldPct).toBe(65.0); // 65%
  });

  it("production output ratios and per-bag yield sums to 100% and exact bag weight", () => {
    const totalPaddy = 10000;
    const outputs = [
      { name: "rice", kg: 6500 },
      { name: "bran", kg: 800 },
      { name: "broken", kg: 500 },
      { name: "husk", kg: 2000 },
    ];
    const producedGoods = outputs.reduce((s, o) => s + o.kg, 0); // 9800
    const lossKg = totalPaddy - producedGoods; // 200

    const all = [...outputs, { name: "loss", kg: lossKg }];

    // 75 KG test
    const bag75 = 75;
    const yields75 = all.map((o) => round2((o.kg * bag75) / totalPaddy));
    const ratios = all.map((o) => round2((o.kg / totalPaddy) * 100));

    expect(yields75).toEqual([48.75, 6.0, 3.75, 15.0, 1.5]);
    expect(round2(yields75.reduce((s, y) => s + y, 0))).toBe(75.0);
    expect(round2(ratios.reduce((s, r) => s + r, 0))).toBe(100.0);

    // 80 KG test
    const bag80 = 80;
    const yields80 = all.map((o) => round2((o.kg * bag80) / totalPaddy));
    expect(yields80).toEqual([52.0, 6.4, 4.0, 16.0, 1.6]);
    expect(round2(yields80.reduce((s, y) => s + y, 0))).toBe(80.0);
  });

  it("handles zero processed paddy safely without NaN or division by zero", () => {
    const totalPaddy = 0;
    const riceKg = 0;
    const bagKg = 75;

    const yieldPerBag = totalPaddy > 0 ? round2((riceKg * bagKg) / totalPaddy) : 0;
    const yieldPct = totalPaddy > 0 ? round2((riceKg / totalPaddy) * 100) : 0;

    expect(yieldPerBag).toBe(0);
    expect(yieldPct).toBe(0);
    expect(Number.isFinite(yieldPerBag)).toBe(true);
  });
});
