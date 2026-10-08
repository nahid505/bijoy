import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysUntil, effectiveStatus, entitledFeatures, invoiceAmounts, nextPeriod, planChangeKind, planPrice } from "@/lib/subscription";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const opts = { graceDays: 3, reminderDays: 7 };

describe("effectiveStatus", () => {
  it("trial: plan access until the trial end, then grace, then expired", () => {
    const sub = { status: "TRIAL" as const, endDate: D("2026-10-15"), trialEndsAt: D("2026-10-15") };
    expect(effectiveStatus(sub, D("2026-10-01"), opts)).toMatchObject({ status: "TRIAL", planAccess: true, blocked: false, inGrace: false, daysLeft: 14 });
    expect(effectiveStatus(sub, D("2026-10-16"), opts)).toMatchObject({ status: "TRIAL", planAccess: true, inGrace: true });
    const after = effectiveStatus(sub, D("2026-10-18"), opts); // end + 3 days grace
    expect(after).toMatchObject({ status: "EXPIRED", planAccess: false, blocked: false });
    expect(after.accessUntil).toEqual(D("2026-10-18"));
  });

  it("active → expiring inside the reminder window and during grace", () => {
    const sub = { status: "ACTIVE" as const, endDate: D("2026-11-01"), trialEndsAt: null };
    expect(effectiveStatus(sub, D("2026-10-01"), opts).status).toBe("ACTIVE");
    expect(effectiveStatus(sub, D("2026-10-26"), opts).status).toBe("EXPIRING");
    expect(effectiveStatus(sub, D("2026-11-02"), opts)).toMatchObject({ status: "EXPIRING", inGrace: true, planAccess: true });
    expect(effectiveStatus(sub, D("2026-11-04"), opts).status).toBe("EXPIRED");
  });

  it("no end date (free plan) never expires; stored EXPIRED stays expired", () => {
    expect(effectiveStatus({ status: "ACTIVE", endDate: null, trialEndsAt: null }, D("2030-01-01"), opts)).toMatchObject({ status: "ACTIVE", planAccess: true, accessUntil: null });
    expect(effectiveStatus({ status: "EXPIRED", endDate: D("2027-01-01"), trialEndsAt: null }, D("2026-10-01"), opts).planAccess).toBe(false);
  });

  it("suspended blocks everything; cancelled keeps access to the end without grace", () => {
    expect(effectiveStatus({ status: "SUSPENDED", endDate: D("2027-01-01"), trialEndsAt: null }, D("2026-10-01"), opts)).toMatchObject({ status: "SUSPENDED", blocked: true, planAccess: false });
    const c = { status: "CANCELLED" as const, endDate: D("2026-10-10"), trialEndsAt: null };
    expect(effectiveStatus(c, D("2026-10-09"), opts)).toMatchObject({ status: "CANCELLED", planAccess: true });
    expect(effectiveStatus(c, D("2026-10-11"), opts)).toMatchObject({ status: "EXPIRED", planAccess: false });
  });
});

describe("periods and prices", () => {
  it("calendar months clamp to the month end", () => {
    expect(addMonths(D("2027-01-31"), 1)).toEqual(D("2027-02-28"));
    expect(addMonths(D("2028-01-31"), 1)).toEqual(D("2028-02-29"));
    expect(addMonths(D("2026-10-05"), 12)).toEqual(D("2027-10-05"));
    expect(daysUntil(D("2026-10-01"), addDays(D("2026-10-01"), 7))).toBe(7);
  });

  it("renewal continues from the end date; a new plan / trial / expired starts today", () => {
    const now = D("2026-10-05");
    const active = { status: "ACTIVE" as const, endDate: D("2026-10-20"), planId: "p1", trial: false };
    expect(nextPeriod(active, "p1", "MONTHLY", now)).toEqual({ start: D("2026-10-20"), end: D("2026-11-20"), renewal: true });
    expect(nextPeriod(active, "p2", "YEARLY", now)).toEqual({ start: now, end: D("2027-10-05"), renewal: false });
    expect(nextPeriod({ ...active, trial: true }, "p1", "MONTHLY", now).start).toEqual(now);
    expect(nextPeriod({ ...active, status: "EXPIRED" }, "p1", "MONTHLY", now).start).toEqual(now);
  });

  it("invoice amounts: VAT after discount, discount capped; plan price by cycle; change kind", () => {
    expect(invoiceAmounts(1499, 0, 0)).toEqual({ subtotal: 1499, discount: 0, vatPercent: 0, vatAmount: 0, total: 1499 });
    expect(invoiceAmounts(1000, 100, 15)).toEqual({ subtotal: 1000, discount: 100, vatPercent: 15, vatAmount: 135, total: 1035 });
    expect(invoiceAmounts(100, 500, 15).total).toBe(0);
    expect(planPrice({ priceMonthly: 499, priceYearly: 4990 }, "YEARLY")).toBe(4990);
    expect(planChangeKind({ priceMonthly: 499 }, { priceMonthly: 1499 })).toBe("UPGRADED");
    expect(planChangeKind({ priceMonthly: 1499 }, { priceMonthly: 0 })).toBe("DOWNGRADED");
    expect(planChangeKind(null, { priceMonthly: 0 })).toBe("PLAN_CHANGED");
  });
});

describe("entitledFeatures", () => {
  const base = { planFeatures: ["ACCOUNTING", "SALES", "HRM"], fallbackFeatures: ["ACCOUNTING"], overrides: new Map<string, boolean>() };
  const eff = (s: Parameters<typeof effectiveStatus>[0]) => effectiveStatus(s, D("2026-10-05"), opts);
  it("plan features while active, fallback after expiry, nothing when suspended", () => {
    expect([...entitledFeatures({ ...base, effective: eff({ status: "ACTIVE", endDate: null, trialEndsAt: null }) })]).toEqual(["ACCOUNTING", "SALES", "HRM"]);
    expect([...entitledFeatures({ ...base, effective: eff({ status: "EXPIRED", endDate: D("2026-09-01"), trialEndsAt: null }) })]).toEqual(["ACCOUNTING"]);
    expect(entitledFeatures({ ...base, overrides: new Map([["POS", true]]), effective: eff({ status: "SUSPENDED", endDate: null, trialEndsAt: null }) }).size).toBe(0);
  });
  it("super-admin overrides add or remove single features", () => {
    const r = entitledFeatures({ ...base, overrides: new Map([["POS", true], ["HRM", false]]), effective: eff({ status: "ACTIVE", endDate: null, trialEndsAt: null }) });
    expect([...r].sort()).toEqual(["ACCOUNTING", "POS", "SALES"]);
  });
});
