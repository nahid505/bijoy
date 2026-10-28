import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { amountInBanglaWords, amountInEnglishWords, numberToBanglaWords, numberToEnglishWords } from "@/lib/words";
import { toCsv, toXlsx } from "@/server/reports/export";
import type { ReportResult } from "@/server/reports/types";

describe("amount in Bangla words (money receipts)", () => {
  it("handles irregular Bangla numbers", () => {
    expect(numberToBanglaWords(0)).toBe("শূন্য");
    expect(numberToBanglaWords(21)).toBe("একুশ");
    expect(numberToBanglaWords(99)).toBe("নিরানব্বই");
    expect(numberToBanglaWords(105)).toBe("এক শত পাঁচ");
  });
  it("uses কোটি / লক্ষ / হাজার grouping", () => {
    expect(numberToBanglaWords(1_234_567)).toBe("বারো লক্ষ চৌত্রিশ হাজার পাঁচ শত সাতষট্টি");
    expect(numberToBanglaWords(25_00_00_000)).toBe("পঁচিশ কোটি");
  });
  it("formats taka and paisa", () => {
    expect(amountInBanglaWords(1500.5)).toBe("এক হাজার পাঁচ শত টাকা পঞ্চাশ পয়সা মাত্র");
    expect(amountInBanglaWords(3045)).toBe("তিন হাজার পঁয়তাল্লিশ টাকা মাত্র");
  });
});

describe("amount in English words (English UI)", () => {
  it("uses Crore / Lakh / Thousand grouping", () => {
    expect(numberToEnglishWords(0)).toBe("Zero");
    expect(numberToEnglishWords(1_234_567)).toBe("Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven");
    expect(numberToEnglishWords(25_00_00_000)).toBe("Twenty-Five Crore");
  });
  it("formats taka and paisa", () => {
    expect(amountInEnglishWords(1500.5)).toBe("One Thousand Five Hundred Taka and Fifty Paisa Only");
    expect(amountInEnglishWords(0)).toBe("Zero Taka Only");
    expect(amountInEnglishWords(-3045)).toBe("Minus Three Thousand Forty-Five Taka Only");
  });
});

const sample: ReportResult = {
  title: "ট্রায়াল ব্যালেন্স",
  subtitle: "১ জুলাই — ৩০ জুন",
  columns: [{ key: "name", label: "হিসাব" }, { key: "date", label: "তারিখ", format: "date" }, { key: "amount", label: "টাকা", format: "money" }, { key: "bal", label: "ব্যালেন্স", format: "drcr" }],
  rows: [
    { kind: "group", cells: { name: "নগদ", date: null, amount: null, bal: null } },
    { indent: 1, cells: { name: "=HYPERLINK(\"x\")", date: new Date("2026-08-01T00:00:00Z"), amount: 1234.5, bal: -50 } },
    { kind: "total", cells: { name: "মোট", date: null, amount: 1234.5, bal: -50 } },
  ],
};

describe("report export", () => {
  it("CSV has BOM, neutralises formulas and marks Dr/Cr", () => {
    const csv = toCsv(sample);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("HYPERLINK");
    expect(csv).not.toMatch(/(^|,)"[=+@-]/m); // no cell may start with a formula character
    expect(toCsv({ ...sample, rows: [{ cells: { name: "=1+1", date: null, amount: null, bal: null } }] })).toContain(`"'=1+1"`);
    expect(csv).toContain('"50.00 Cr"');
  });

  it("XLSX is a real workbook with numeric money cells", async () => {
    const buf = await toXlsx(sample, "বিজয় ট্রেডার্স");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("বিজয় ট্রেডার্স");
    const values = ws.getSheetValues().flat().filter((v) => typeof v === "number");
    expect(values).toContain(1234.5);
    expect(ws.getColumn(3).numFmt).toContain("#,##0.00");
  });
});
