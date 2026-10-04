import { describe, expect, it } from "vitest";
import { fiscalYearRange, reportPeriod } from "@/server/period";
import { formatDrCr } from "@/lib/format";
import { fiscalYearStart } from "@/server/services/bootstrap";

describe("fiscal year (Bangladesh July–June)", () => {
  it("before July belongs to the previous fiscal year", () => {
    expect(fiscalYearRange(7, "2026-03-15")).toEqual({ from: "2025-07-01", to: "2026-06-30", label: "2025-26" });
  });
  it("from July starts a new fiscal year", () => {
    expect(fiscalYearRange(7, "2026-10-02")).toEqual({ from: "2026-07-01", to: "2027-06-30", label: "2026-27" });
  });
  it("calendar-year businesses", () => {
    expect(fiscalYearRange(1, "2026-10-02")).toEqual({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
  });
  it("books start on the fiscal year start", () => {
    expect(fiscalYearStart(new Date("2026-03-01T00:00:00Z"), 7).toISOString()).toBe("2025-07-01T00:00:00.000Z");
  });
  it("report period ignores malformed input", () => {
    const p = reportPeriod({ from: "bad", to: "2026-08-31" }, 7);
    expect(p.to).toBe("2026-08-31");
    expect(p.from).toMatch(/^\d{4}-07-01$/);
  });
});

describe("formatDrCr", () => {
  it("shows the side of a ledger balance", () => {
    expect(formatDrCr(1200)).toBe("৳ ১,২০০.০০ ডেবিট");
    expect(formatDrCr(-50.5)).toBe("৳ ৫০.৫০ ক্রেডিট");
    expect(formatDrCr(0)).toBe("৳ ০.০০");
  });
});
