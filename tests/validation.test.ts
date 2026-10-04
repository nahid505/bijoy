import { describe, expect, it } from "vitest";
import { cashVoucherSchema, fieldErrors, journalVoucherSchema, loginSchema, partySchema, productSchema, stockJournalSchema, tradeVoucherSchema, unitSchema } from "@/lib/validation";

describe("journalVoucherSchema", () => {
  const base = { date: "2026-08-01" };
  it("rejects unbalanced journals before they reach the database", () => {
    const r = journalVoucherSchema.safeParse({ ...base, lines: [{ accountId: "a", debit: 100 }, { accountId: "b", credit: 90 }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).lines?.[0]).toContain("সমান নয়");
  });
  it("rejects a line with both debit and credit", () => {
    expect(journalVoucherSchema.safeParse({ ...base, lines: [{ accountId: "a", debit: 10, credit: 10 }, { accountId: "b", debit: 0, credit: 0 }] }).success).toBe(false);
  });
  it("accepts a balanced journal", () => {
    expect(journalVoucherSchema.safeParse({ ...base, lines: [{ accountId: "a", debit: "100.10" }, { accountId: "b", credit: "100.1" }] }).success).toBe(true);
  });
});

describe("tradeVoucherSchema", () => {
  it("requires items and positive quantities", () => {
    expect(tradeVoucherSchema.safeParse({ date: "2026-08-01", items: [] }).success).toBe(false);
    expect(tradeVoucherSchema.safeParse({ date: "2026-08-01", items: [{ productId: "p", quantity: 0, rate: 1 }] }).success).toBe(false);
  });
  it("normalises empty ids to null", () => {
    const v = tradeVoucherSchema.parse({ date: "2026-08-01", partyAccountId: "", items: [{ productId: "p", quantity: "2", rate: "10" }] });
    expect(v.partyAccountId).toBeNull();
    expect(v.items[0]).toMatchObject({ quantity: 2, rate: 10, discount: 0, unitId: null });
  });
});

describe("cash voucher / stock journal / masters", () => {
  it("cash voucher needs a cash account and positive lines", () => {
    expect(cashVoucherSchema.safeParse({ date: "2026-08-01", cashAccountId: "", lines: [{ accountId: "a", amount: 5 }] }).success).toBe(false);
    expect(cashVoucherSchema.safeParse({ date: "2026-08-01", cashAccountId: "c", lines: [{ accountId: "a", amount: 0 }] }).success).toBe(false);
  });
  it("stock journal direction must be +1 or −1", () => {
    expect(stockJournalSchema.safeParse({ date: "2026-08-01", lines: [{ productId: "p", warehouseId: "w", direction: 2, quantity: 1 }] }).success).toBe(false);
    const ok = stockJournalSchema.parse({ date: "2026-08-01", lines: [{ productId: "p", warehouseId: "w", direction: "-1", quantity: 1, rate: null }] });
    expect(ok.lines[0].direction).toBe(-1);
    expect(ok.lines[0].rate).toBeUndefined();
  });
  it("party opening balance cannot be negative; empty fields become null", () => {
    expect(partySchema.safeParse({ name: "x", openingBalance: -1 }).success).toBe(false);
    expect(partySchema.parse({ name: "রহিম", mobile: "", email: "" })).toMatchObject({ mobile: null, email: null, openingBalance: 0 });
  });
  it("product requires a unit", () => {
    expect(productSchema.safeParse({ name: "p", unitId: "", purchasePrice: 1, salePrice: 2 }).success).toBe(false);
  });
  it("base units always have factor 1", () => {
    expect(unitSchema.parse({ name: "কেজি", baseUnitId: "", factor: "7" }).factor).toBe(1);
    expect(unitSchema.parse({ name: "বস্তা", baseUnitId: "kg", factor: "50" }).factor).toBe(50);
  });
  it("login normalises email", () => {
    expect(loginSchema.parse({ email: " A@B.COM ", password: "x" }).email).toEqual({ kind: "email", value: "a@b.com" });
  });
});
