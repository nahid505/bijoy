// ডেইলী জমা-খরচ হিসাব against a real database. Hand-worked figures (cash):
//   opening 10 000; 9 Oct: rent 500 paid           → পূর্বের জমা on 10 Oct = 9 500
//   10 Oct receipts: customer 5 000, capital 2 000  → আজকের রিসিট 7 000, মোট রিসিট 16 500
//   10 Oct payments: supplier 3 000, rent 1 200, cash → bank 4 000 → মোট পেমেন্ট 8 200
//   অবশিষ্ট ক্যাশ = 16 500 − 8 200 = 8 300 (= the cash ledger at the end of the day)
//   cash + bank: the 4 000 transfer nets out → payments 4 200, closing 12 300
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { setAccountOpening, systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveCashVoucher, saveJournalVoucher } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { dailyCash, DAILY_CASH_REPORT } from "@/server/reports/daily-cash";
import { toCsv } from "@/server/reports/export";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

run("ডেইলী জমা-খরচ হিসাব (daily cash book)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let key: (k: string) => string;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Cash", email: `cashbook${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ক্যাশ খাতা টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    const accounts = await prisma.account.findMany({ where: { businessId: ctx.businessId } });
    key = (k: string) => accounts.find((a) => a.systemKey === k)!.id;
    await prisma.$transaction((tx) => setAccountOpening(tx, ctx, acc.CASH, 10_000));

    const customer = await saveParty(ctx, "CUSTOMER", party("রহিম ট্রেডার্স"));
    const supplier = await saveParty(ctx, "SUPPLIER", party("মেঘনা এন্টারপ্রাইজ"));
    const pay = (date: string, accountId: string, amount: number, narration: string | null = null) =>
      saveCashVoucher(ctx, "PAYMENT", { date: D(date), reference: null, narration, cashAccountId: acc.CASH, lines: [{ accountId, amount, narration: null }] });
    await pay("2026-10-09", key("RENT"), 500);
    await saveCashVoucher(ctx, "RECEIPT", { date: D("2026-10-10"), reference: null, narration: "বাকি আদায়", cashAccountId: acc.CASH, lines: [{ accountId: customer.accountId, amount: 5_000, narration: null }] });
    await saveJournalVoucher(ctx, { date: D("2026-10-10"), reference: null, narration: "মূলধন জমা", lines: [
      { accountId: acc.CASH, debit: 2_000, credit: 0, narration: null },
      { accountId: key("CAPITAL"), debit: 0, credit: 2_000, narration: null },
    ] });
    await pay("2026-10-10", supplier.accountId, 3_000);
    await pay("2026-10-10", key("RENT"), 1_200, "অক্টোবরের ভাড়া");
    await saveJournalVoucher(ctx, { date: D("2026-10-10"), reference: null, narration: "ব্যাংকে জমা", lines: [
      { accountId: key("BANK"), debit: 4_000, credit: 0, narration: null },
      { accountId: acc.CASH, debit: 0, credit: 4_000, narration: null },
    ] });
    await pay("2026-10-11", key("RENT"), 100); // next day: not in the 10 Oct sheet
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cash: opening, receipts, payments and closing", async () => {
    const d = await dailyCash(ctx.businessId, { date: "2026-10-10" });
    expect(d.scopeLabel).toBe("নগদ তহবিল");
    expect(d.opening).toBe(9_500);
    const capitalName = (await prisma.account.findUniqueOrThrow({ where: { id: key("CAPITAL") } })).name;
    expect(d.receipts.map((l) => [l.particulars, l.amount])).toEqual([["রহিম ট্রেডার্স", 5_000], [capitalName, 2_000]]);
    expect(d.todayReceipts).toBe(7_000);
    expect(d.totalReceipts).toBe(16_500);
    const bankName = (await prisma.account.findUniqueOrThrow({ where: { id: key("BANK") } })).name;
    expect(d.payments.map((l) => [l.particulars, l.amount])).toEqual([["মেঘনা এন্টারপ্রাইজ", 3_000], ["দোকান/অফিস ভাড়া", 1_200], [bankName, 4_000]]);
    expect(d.payments[1].narration).toBe("অক্টোবরের ভাড়া");
    expect(d.totalPayments).toBe(8_200);
    expect(d.closing).toBe(8_300);
    // closing = the cash ledger at the end of the day
    const ledger = (await balancesBefore(ctx.businessId, D("2026-10-11"), [acc.CASH])).get(acc.CASH);
    expect(d.closing).toBe(ledger);
  });

  it("cash + bank: the transfer between them nets out", async () => {
    const d = await dailyCash(ctx.businessId, { date: "2026-10-10", scope: "cash-bank" });
    expect(d.opening).toBe(9_500);
    expect(d.todayReceipts).toBe(7_000);
    expect(d.payments.map((l) => l.amount)).toEqual([3_000, 1_200]);
    expect(d.closing).toBe(12_300);
  });

  it("one account: the bank sees the transfer as a receipt from cash", async () => {
    const d = await dailyCash(ctx.businessId, { date: "2026-10-10", scope: key("BANK") });
    expect(d.accounts.map((a) => a.id)).toEqual([key("BANK")]);
    expect(d.opening).toBe(0);
    expect(d.receipts).toHaveLength(1);
    expect(d.receipts[0]).toMatchObject({ amount: 4_000, narration: "ব্যাংকে জমা" });
    expect(d.closing).toBe(4_000);
  });

  it("a day with no entries: closing = opening; the next day's opening = this closing", async () => {
    const quiet = await dailyCash(ctx.businessId, { date: "2026-10-05" });
    expect(quiet.receipts).toHaveLength(0);
    expect(quiet.payments).toHaveLength(0);
    expect(quiet.closing).toBe(quiet.opening);
    const next = await dailyCash(ctx.businessId, { date: "2026-10-11" });
    expect(next.opening).toBe(8_300);
    expect(next.closing).toBe(8_200);
  });

  it("the books start day: the opening balance is পূর্বের জমা, not a receipt", async () => {
    const start = (await prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId } })).booksStartDate.toISOString().slice(0, 10);
    const d = await dailyCash(ctx.businessId, { date: start });
    expect(d.opening).toBe(10_000);
    expect(d.receipts).toHaveLength(0);
    expect(d.closing).toBe(10_000);
  });

  it("bad input falls back safely: invalid date → today, unknown / foreign account → all cash", async () => {
    const d = await dailyCash(ctx.businessId, { date: "2026-13-45", scope: "not-an-id" });
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.scope).toBe("cash");
    const user = await prisma.user.create({ data: { name: "O", email: `cashbook-o${Date.now()}@test.local`, passwordHash: "x" } });
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য", ownerUserId: user.id }));
    const theirs = await dailyCash(other.id, { date: "2026-10-10", scope: acc.CASH });
    expect(theirs.scope).toBe("cash");
    expect(theirs.receipts).toHaveLength(0);
    expect(theirs.opening).toBe(0);
  });

  it("export: same figures as the screen (CSV)", async () => {
    const report = await DAILY_CASH_REPORT.run({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7 } } as never, { date: "2026-10-10" });
    const csv = toCsv(report);
    for (const s of ["পূর্বের জমা (প্রারম্ভিক ব্যালেন্স)", "9500.00", "আজকের রিসিট", "7000.00", "মোট রিসিট", "16500.00", "মোট পেমেন্ট", "8200.00", "অবশিষ্ট ক্যাশ (সমাপনী ব্যালেন্স)", "8300.00", "রহিম ট্রেডার্স"]) {
      expect(csv).toContain(s);
    }
  });
});
