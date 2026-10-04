import { describe, expect, it } from "vitest";
import { dayRange, formatDate, formatMoney, formatNumber, toBnDigits, toDateInput } from "@/lib/format";

describe("toBnDigits", () => {
  it("converts ASCII digits to Bangla digits", () => {
    expect(toBnDigits("2026-10-02")).toBe("২০২৬-১০-০২");
    expect(toBnDigits(1234567890)).toBe("১২৩৪৫৬৭৮৯০");
  });
});

describe("formatNumber / formatMoney", () => {
  it("uses South-Asian grouping with Bangla digits", () => {
    expect(formatNumber(1234567.5)).toBe("১২,৩৪,৫৬৭.৫০");
  });

  it("formats money with symbol and sign", () => {
    expect(formatMoney(1500)).toBe("৳ ১,৫০০.০০");
    expect(formatMoney(-20, "Tk")).toBe("-Tk ২০.০০");
    expect(formatMoney(null)).toBe("৳ ০.০০");
  });
});

describe("dates (Asia/Dhaka)", () => {
  it("renders stored UTC-midnight dates on the same calendar day", () => {
    expect(formatDate(new Date("2026-01-15T00:00:00Z"))).toBe("১৫ জানুয়ারি ২০২৬");
  });

  it("converts late-evening UTC instants to the next Dhaka day", () => {
    // 20:00 UTC = 02:00 next day in Dhaka (UTC+6)
    expect(toDateInput(new Date("2026-03-31T20:00:00Z"))).toBe("2026-04-01");
  });

  it("builds inclusive day ranges", () => {
    const r = dayRange("2026-02-01", "2026-02-28");
    expect(r.gte?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(r.lt?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("ignores malformed range input", () => {
    expect(dayRange("not-a-date", undefined)).toEqual({});
  });

  it("returns a dash for empty dates", () => {
    expect(formatDate(null)).toBe("—");
  });
});
