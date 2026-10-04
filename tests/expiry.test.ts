import { describe, expect, it } from "vitest";
import { DEFAULT_WARNING_DAYS, expiryStatus, fefoAllocate, isExpired, matchesFilter, normalizeThresholds } from "@/lib/expiry";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = D("2026-10-03");

describe("expiry status", () => {
  it("detects expired, expiring today and batches without expiry", () => {
    expect(expiryStatus(D("2026-10-02"), today)).toEqual({ code: "EXPIRED", daysLeft: -1, level: 0 });
    expect(expiryStatus(D("2026-10-03"), today)).toEqual({ code: "TODAY", daysLeft: 0, level: 0 });
    expect(expiryStatus(null, today).code).toBe("NONE");
    expect(isExpired(D("2026-10-02"), today)).toBe(true);
    expect(isExpired(D("2026-10-03"), today)).toBe(false); // the expiry day itself is still sellable
  });

  it.each([
    ["2026-10-04", 1, 7],
    ["2026-10-10", 7, 7],
    ["2026-10-11", 8, 15],
    ["2026-10-18", 15, 15],
    ["2026-10-19", 16, 30],
    ["2026-11-02", 30, 30],
    ["2026-11-03", 31, 60],
    ["2026-12-02", 60, 60],
  ])("expiring %s → %i days left → %i-day warning", (date, daysLeft, level) => {
    expect(expiryStatus(D(date), today)).toEqual({ code: "SOON", daysLeft, level });
  });

  it("is valid beyond the first warning", () => {
    expect(expiryStatus(D("2026-12-03"), today)).toEqual({ code: "VALID", daysLeft: 61, level: null });
  });

  it("uses configurable thresholds", () => {
    expect(expiryStatus(D("2026-12-31"), today, [90, 45, 10]).level).toBe(90); // 89 days
    expect(expiryStatus(D("2027-01-02"), today, [90, 45, 10]).code).toBe("VALID"); // 91 days
    expect(expiryStatus(D("2026-10-12"), today, [90, 45, 10]).level).toBe(10);
    expect(expiryStatus(D("2026-11-02"), today, [10]).code).toBe("VALID");
  });

  it("normalises thresholds (unique, positive, largest first, defaults when empty)", () => {
    expect(normalizeThresholds([7, "30", 15, 30, 0, -5, 60])).toEqual([60, 30, 15, 7]);
    expect(normalizeThresholds([])).toEqual(DEFAULT_WARNING_DAYS);
    expect(normalizeThresholds(null)).toEqual(DEFAULT_WARNING_DAYS);
  });

  it("filters All / Valid / Expiring soon / Expired and 'within N days'", () => {
    const expired = expiryStatus(D("2026-09-01"), today);
    const soon = expiryStatus(D("2026-10-08"), today);
    const valid = expiryStatus(D("2027-06-01"), today);
    expect([expired, soon, valid].filter((s) => matchesFilter(s, "expired")).length).toBe(1);
    expect(matchesFilter(soon, "soon")).toBe(true);
    expect(matchesFilter(valid, "valid")).toBe(true);
    expect(matchesFilter(expired, "all")).toBe(true);
    expect(matchesFilter(soon, "all", 7)).toBe(true);
    expect(matchesFilter(soon, "all", 3)).toBe(false);
    expect(matchesFilter(expired, "all", 7)).toBe(false); // already expired is not "expiring within"
  });
});

describe("FEFO allocation", () => {
  const batches = [
    { batchNo: "B", expiryDate: D("2026-12-20"), quantity: 50 },
    { batchNo: "A", expiryDate: D("2026-10-10"), quantity: 20 },
    { batchNo: "OLD", expiryDate: D("2026-09-30"), quantity: 100 }, // expired
    { batchNo: "NOEXP", expiryDate: null, quantity: 5 },
  ];

  it("sells the earliest valid expiry first (spec example: 10 units → batch A)", () => {
    expect(fefoAllocate(batches, 10, today)).toEqual({ allocations: [{ batchNo: "A", quantity: 10 }], shortfall: 0 });
  });

  it("spans batches in expiry order and never picks an expired batch", () => {
    expect(fefoAllocate(batches, 30, today)).toEqual({ allocations: [{ batchNo: "A", quantity: 20 }, { batchNo: "B", quantity: 10 }], shortfall: 0 });
  });

  it("uses batches without expiry last and reports a shortfall", () => {
    expect(fefoAllocate(batches, 80, today)).toEqual({
      allocations: [{ batchNo: "A", quantity: 20 }, { batchNo: "B", quantity: 50 }, { batchNo: "NOEXP", quantity: 5 }],
      shortfall: 5,
    });
  });

  it("judges expiry on the sale date (a backdated sale may use a then-valid batch)", () => {
    expect(fefoAllocate(batches, 10, D("2026-09-15")).allocations).toEqual([{ batchNo: "OLD", quantity: 10 }]);
  });
});
