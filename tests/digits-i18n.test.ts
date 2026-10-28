import { describe, expect, it } from "vitest";
import { digitVariants, normalizeNumericInput, sanitizeNumber, toAsciiDigits, toBanglaDigits } from "@/lib/digits";
import { DEFAULT_LANG } from "@/lib/i18n";
import { translate } from "@/lib/i18n-dict";
import { NAV } from "@/lib/nav";
import bn from "@/locales/bn.json";
import en from "@/locales/en.json";

describe("mixed Bangla / English digits", () => {
  it("digits map both ways; other characters stay", () => {
    expect(toAsciiDigits("১২451৩৩")).toBe("1245133");
    expect(toAsciiDigits("Miniket চাল ৫০kg")).toBe("Miniket চাল 50kg");
    expect(toBanglaDigits("Aman ধান 100 বস্তা")).toBe("Aman ধান ১০০ বস্তা");
  });

  it("a number field: digits in any script, one '.', a leading '-'; the rest is dropped", () => {
    expect(sanitizeNumber("১২451৩৩")).toBe("1245133");
    expect(sanitizeNumber("১,২৫০.৫০ টাকা")).toBe("1250.50");
    expect(sanitizeNumber("-৩.৫")).toBe("-3.5");
    expect(sanitizeNumber("1.2.3")).toBe("1.23");
    expect(sanitizeNumber("৫-০")).toBe("50");
    expect(sanitizeNumber("abc")).toBe("");
    expect(sanitizeNumber("৪২.৯", { decimal: false })).toBe("429");
  });

  it("a submitted value: numbers become plain English numbers; text keeps its digits", () => {
    expect(normalizeNumericInput("১২451৩৩")).toBe("1245133");
    expect(normalizeNumericInput("১,২৫,০০০.৫০")).toBe("125000.50");
    expect(normalizeNumericInput(" ৫০ ")).toBe("50");
    expect(normalizeNumericInput("1,250")).toBe("1250");
    expect(normalizeNumericInput("০১৭১২৩৪৫৬৭৮")).toBe("01712345678");
    expect(normalizeNumericInput("০১৭১১০০০০০০, ০১৮১১০০০০০০")).toBe("01711000000, 01811000000"); // a list keeps its commas
    expect(normalizeNumericInput("২০২৬-১০-২৮")).toBe("2026-10-28");
    expect(normalizeNumericInput("Miniket চাল ৫০kg")).toBe("Miniket চাল ৫০kg");
    expect(normalizeNumericInput("Aman ধান 100 বস্তা")).toBe("Aman ধান 100 বস্তা");
    expect(normalizeNumericInput("12,34,5")).toBe("12,34,5"); // not a valid grouping: left as typed
  });

  it("search terms in both scripts", () => {
    expect(digitVariants("চাল 50")).toEqual(["চাল 50", "চাল ৫০"]);
    expect(digitVariants("চাল ৫০")).toEqual(["চাল ৫০", "চাল 50"]);
    expect(digitVariants("miniket")).toEqual(["miniket"]);
  });
});

describe("locales (src/locales/bn.json, en.json)", () => {
  it("Bangla is the default; both files hold the same keys", () => {
    expect(DEFAULT_LANG).toBe("bn");
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
  });

  it("translates, and falls back to the text itself", () => {
    expect(translate("en", "লগআউট")).toBe("Logout");
    expect(translate("bn", "লগআউট")).toBe("লগআউট");
    expect(translate("en", "অচেনা লেখা")).toBe("অচেনা লেখা");
  });

  it("every sidebar label has an English translation", () => {
    const labels = NAV.flatMap((e) => [e.label, ...(e.children ?? []).map((c) => c.label)]);
    const missing = labels.filter((l) => translate("en", l) === l);
    expect(missing).toEqual([]);
  });
});
