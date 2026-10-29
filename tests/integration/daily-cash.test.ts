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
import { cashLineDetail, cashLineTitle, dailyCash, DAILY_CASH_REPORT } from "@/server/reports/daily-cash";
import { formatDrCr } from "@/lib/format";
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

    const customer = await saveParty(ctx, "CUSTOMER", { ...party("রহিম ট্রেডার্স"), address: "বীরগঞ্জ, দিনাজপুর" });
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
    // 12 Oct: one payment voucher, two ledgers (rent 300, bank 200); a journal Dr cash 1 000, Dr bank 500, Cr capital 1 500
    await saveCashVoucher(ctx, "PAYMENT", { date: D("2026-10-12"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [
      { accountId: key("RENT"), amount: 300, narration: null },
      { accountId: key("BANK"), amount: 200, narration: null },
    ] });
    await saveJournalVoucher(ctx, { date: D("2026-10-12"), reference: null, narration: null, lines: [
      { accountId: acc.CASH, debit: 1_000, credit: 0, narration: null },
      { accountId: key("BANK"), debit: 500, credit: 0, narration: null },
      { accountId: key("CAPITAL"), debit: 0, credit: 1_500, narration: null },
    ] });
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

  it("বিবরণ: ledger, address (entered by) / current balance, note — empty parts leave no stray commas", async () => {
    const d = await dailyCash(ctx.businessId, { date: "2026-10-10" });
    const [fromCustomer] = d.receipts;
    const rent = d.payments.find((l) => l.particulars === "দোকান/অফিস ভাড়া")!;
    const supplier = d.payments.find((l) => l.particulars === "মেঘনা এন্টারপ্রাইজ")!;
    expect([fromCustomer.enteredBy, fromCustomer.address, fromCustomer.balance, fromCustomer.narration]).toEqual(["Cash", "বীরগঞ্জ, দিনাজপুর", -5_000, "বাকি আদায়"]); // the customer paid 5 000: credit
    // row 1: name, address (user); row 2: balance, note
    expect(cashLineTitle(fromCustomer)).toBe("রহিম ট্রেডার্স, বীরগঞ্জ, দিনাজপুর (Cash)");
    expect(cashLineDetail(fromCustomer, (n) => formatDrCr(n))).toBe("বর্তমান জের: ৳ ৫,০০০.০০ ক্রেডিট, বাকি আদায়");
    // no address: name (user); the note follows the balance — running through the days (500 on 9 Oct + 1 200 today)
    expect([rent.address, rent.balance]).toEqual([null, 1_700]);
    expect(cashLineTitle(rent)).toBe("দোকান/অফিস ভাড়া (Cash)");
    expect(cashLineDetail(rent, (n) => formatDrCr(n))).toBe("বর্তমান জের: ৳ ১,৭০০.০০ ডেবিট, অক্টোবরের ভাড়া");
    // no note: the balance alone
    expect(supplier.narration).toBeNull();
    expect(cashLineDetail(supplier, (n) => formatDrCr(n))).toBe("বর্তমান জের: ৳ ৩,০০০.০০ ডেবিট");
    // nothing known: no second row, no comma, no brackets
    expect(cashLineDetail({ balance: null, narration: null }, String)).toBe("");
    expect(cashLineDetail({ balance: null, narration: "  " }, String)).toBe("");
    expect(cashLineTitle({ particulars: "নগদ", address: null, enteredBy: null })).toBe("নগদ");
    expect(cashLineTitle({ particulars: "নগদ", address: "", enteredBy: "Delower" })).toBe("নগদ (Delower)");
  });

  it("several ledgers in one voucher: one line each, its own amount, never joined", async () => {
    const d = await dailyCash(ctx.businessId, { date: "2026-10-12" });
    const name = async (k: string) => (await prisma.account.findUniqueOrThrow({ where: { id: key(k) } })).name;
    const [rentName, bankName, capitalName] = await Promise.all(["RENT", "BANK", "CAPITAL"].map(name));
    expect(d.payments.map((l) => [l.particulars, l.amount])).toEqual([[rentName, 300], [bankName, 200]]);
    expect(d.payments.every((l) => !l.particulars.includes(","))).toBe(true);
    expect(new Set(d.payments.map((l) => l.key)).size).toBe(2); // one voucher, two lines
    expect(d.payments[0].voucherId).toBe(d.payments[1].voucherId);
    // each line: its own ledger's running balance (rent 500 + 1 200 + 100 + 300; bank 4 000 + 200)
    expect(d.payments.map((l) => l.balance)).toEqual([2_100, 4_200]);
    // the journal: only 1 000 of the 1 500 capital came into cash — the line carries the cash amount
    expect(d.receipts.map((l) => [l.particulars, l.amount])).toEqual([[capitalName, 1_000]]);
    expect(d.totalPayments).toBe(500);
    expect(d.todayReceipts).toBe(1_000);
    expect(d.closing).toBe((await balancesBefore(ctx.businessId, D("2026-10-13"), [acc.CASH])).get(acc.CASH));
    // cash + bank: bank is now one of "our" accounts — rent alone is paid out, capital brings in the whole 1 500
    const both = await dailyCash(ctx.businessId, { date: "2026-10-12", scope: "cash-bank" });
    expect(both.payments.map((l) => [l.particulars, l.amount])).toEqual([[rentName, 300]]);
    expect(both.receipts.map((l) => [l.particulars, l.amount])).toEqual([[capitalName, 1_500]]);
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
