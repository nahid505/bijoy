// "ডিপো ক্যাশ" and depot expenses: the depot cash box, fund transfer from the main cash, expenses that reach the
// business's P&L and cash flow, the depot cash book (both books) and the "not enough cash" guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DEPOT_CASH_KEY, DEPOT_EXPENSE_SOURCE, DEPOT_FUND_SOURCE } from "@/lib/depot";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveCashVoucher, saveJournalVoucher } from "@/server/services/voucher";
import { cashInHand, deleteDepotExpense, ensureDepotCash, listDepotExpenses, saveDepotExpense, transferDepotFund } from "@/server/services/depot-cash";
import { balancesBefore } from "@/server/services/ledger";
import { profitAndLoss, trialBalance } from "@/server/services/report";
import { DEPOT_REPORTS } from "@/server/reports/depot";
import { EXTRA_REPORTS } from "@/server/reports/extra";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
const OCT = { gte: D("2026-10-01"), lt: D("2026-11-01") };

run("depot cash (ডিপো ক্যাশ) and depot expenses", () => {
  let ctx: Ctx;
  let box: string;
  let sys: Record<string, string>; // systemKey → account id
  let rentId: string;
  const fake = () => ({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "DEPOT" }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } }) as never;
  const expense = (amount: number, o: Record<string, unknown> = {}) => ({ date: D("2026-10-12"), expenseAccountId: sys.RENT, cashAccountId: box, amount, reference: "M-7", narration: "গুদাম ভাড়া", ...o });
  const fund = (amount: number, direction: "IN" | "OUT" = "IN") => ({ date: D("2026-10-11"), direction, mainAccountId: sys.CASH, amount, reference: null, narration: null });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Cash", email: `dcash${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ক্যাশ ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
    sys = Object.fromEntries((await prisma.account.findMany({ where: { businessId: ctx.businessId, systemKey: { not: null } }, select: { id: true, systemKey: true } })).map((a) => [a.systemKey!, a.id]));
    rentId = sys.RENT;
    // the main cash gets 10,000 from capital
    await saveJournalVoucher(ctx, { date: D("2026-10-10"), reference: null, narration: "মূলধন", lines: [{ accountId: sys.CASH, debit: 10000, credit: 0, narration: null }, { accountId: sys.CAPITAL, debit: 0, credit: 10000, narration: null }] } as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a depot business gets one ডিপো ক্যাশ: a cash ledger under নগদ, usable in both books; other businesses none", async () => {
    const a = await prisma.account.findFirstOrThrow({ where: { businessId: ctx.businessId, systemKey: DEPOT_CASH_KEY }, include: { group: true } });
    box = a.id;
    expect({ name: a.name, kind: a.kind, nature: a.nature, group: a.group.systemKey, isSystem: a.isSystem }).toEqual({ name: "ডিপো ক্যাশ", kind: "CASH", nature: "ASSET", group: "CASH_IN_HAND", isSystem: true });
    expect(await prisma.$transaction((tx) => ensureDepotCash(tx, ctx.businessId))).toBe(box); // idempotent
    const u = await prisma.user.create({ data: { name: "R", email: `dcr${Date.now()}@test.local`, passwordHash: "x" } });
    const retail = await prisma.$transaction((tx) => createBusiness(tx, { name: "দোকান", ownerUserId: u.id, businessType: "RETAIL" }));
    expect(await prisma.$transaction((tx) => ensureDepotCash(tx, retail.id))).toBeNull();
  });

  it("an empty depot cash cannot pay an expense", async () => {
    await expect(saveDepotExpense(ctx, expense(100))).rejects.toThrow(/পর্যাপ্ত টাকা নেই/);
  });

  it("fund transfer main cash → depot cash is a general journal between two cash ledgers (no income / expense)", async () => {
    await expect(transferDepotFund(ctx, fund(20000))).rejects.toThrow(/পর্যাপ্ত টাকা নেই/); // main cash holds 10,000
    const v = await transferDepotFund(ctx, fund(5000));
    expect(v.book).toBe("GENERAL");
    expect(v.type).toBe("JOURNAL");
    expect(v.sourceKey?.startsWith(DEPOT_FUND_SOURCE)).toBe(true);
    const bal = await balancesBefore(ctx.businessId, undefined, [sys.CASH, box]);
    expect([bal.get(sys.CASH), bal.get(box)]).toEqual([5000, 5000]);
    const pl = await profitAndLoss(ctx.businessId, OCT);
    expect(pl.netProfit).toBe(0);
  });

  it("a depot expense: Dr expense head / Cr ডিপো ক্যাশ in the general book — in the P&L and the cash flow", async () => {
    const v = await saveDepotExpense(ctx, expense(1200));
    expect(v.sourceKey?.startsWith(DEPOT_EXPENSE_SOURCE)).toBe(true);
    const entries = await prisma.journalEntry.findMany({ where: { voucherId: v.id }, orderBy: { debit: "desc" } });
    expect(entries.map((e) => [e.accountId, Number(e.debit), Number(e.credit), e.book])).toEqual([[rentId, 1200, 0, "GENERAL"], [box, 0, 1200, "GENERAL"]]);
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(3800);
    const pl = await profitAndLoss(ctx.businessId, OCT);
    expect(pl.expenseLines.find((l) => l.accountId === rentId)?.amount).toBe(1200);
    expect(pl.netProfit).toBe(-1200);
    expect((await profitAndLoss(ctx.businessId, OCT, "DEPOT")).netProfit).toBe(0); // not in the depot-only P&L
    const flow = await EXTRA_REPORTS.find((r) => r.slug === "cash-flow")!.run(fake(), { from: "2026-10-01", to: "2026-10-31" });
    const text = JSON.stringify(flow.rows);
    expect(text).toContain("1200"); // operating outflow for the rent
    expect(text).not.toContain("5000"); // the fund transfer is cash → cash: no inflow / outflow
    expect((await trialBalance(ctx.businessId, { lt: D("2026-11-01") })).balanced).toBe(true);
    expect((await trialBalance(ctx.businessId, { lt: D("2026-11-01") }, "ALL")).balanced).toBe(true);
  });

  it("more than the depot cash holds is refused; an edit counts its own amount back", async () => {
    await expect(saveDepotExpense(ctx, expense(4000))).rejects.toThrow(/পর্যাপ্ত টাকা নেই/);
    const v = await saveDepotExpense(ctx, expense(800, { expenseAccountId: sys.TRANSPORT, narration: "পরিবহন" }));
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(3000);
    await saveDepotExpense(ctx, expense(3800, { expenseAccountId: sys.TRANSPORT }), v.id); // 3,000 + its own 800
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(0);
    await expect(saveDepotExpense(ctx, expense(3801), v.id)).rejects.toThrow(/পর্যাপ্ত টাকা নেই/);
    await saveDepotExpense(ctx, expense(300, { expenseAccountId: sys.TRANSPORT }), v.id);
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(3500);
  });

  it("only expense heads; a bank may be the payment method; general vouchers are not depot expenses", async () => {
    await expect(saveDepotExpense(ctx, expense(10, { expenseAccountId: sys.SALES }))).rejects.toThrow(/ব্যয়ের হিসাব/);
    await expect(saveDepotExpense(ctx, expense(10, { expenseAccountId: box }))).rejects.toThrow();
    const plain = await saveCashVoucher(ctx, "PAYMENT", { date: D("2026-10-12"), reference: null, narration: null, cashAccountId: sys.CASH, lines: [{ accountId: sys.OFFICE, amount: 50, narration: null }] } as never);
    const list = await listDepotExpenses(ctx.businessId, { from: OCT.gte, to: OCT.lt });
    expect(list.count).toBe(2);
    expect(list.total).toBe(1500);
    expect(list.rows.some((r) => r.id === plain.id)).toBe(false);
    await expect(deleteDepotExpense(ctx, plain.id)).rejects.toThrow(/ডিপো খরচ পাওয়া যায়নি/);
    expect((await listDepotExpenses(ctx.businessId, { expenseAccountId: rentId })).total).toBe(1200);
  });

  it("depot-book collections on ডিপো ক্যাশ count in the box; the depot cash book shows both books with a running balance", async () => {
    const dealer = await saveParty(ctx, "CUSTOMER", party("করিম ডিলার"), undefined, { dealer: true });
    await saveCashVoucher(ctx, "RECEIPT", { date: D("2026-10-13"), reference: null, narration: "মার্কেট কালেকশন", cashAccountId: box, lines: [{ accountId: dealer.accountId, amount: 700, narration: null }] } as never, undefined, "DEPOT");
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(4200);
    expect((await balancesBefore(ctx.businessId, undefined, [box])).get(box)).toBe(3500); // general book alone
    const r = await DEPOT_REPORTS.find((x) => x.slug === "depot-cash-book")!.run(fake(), { from: "2026-10-01", to: "2026-10-31" });
    expect(r.title).toContain("ডিপো ক্যাশ");
    const total = r.rows.at(-1)!.cells as { debit: number; credit: number; balance: number };
    expect(total).toMatchObject({ debit: 5700, credit: 1500, balance: 4200 });
    // the box alone (both books) — and a general cash ledger's depot-book view stays empty here
    const only = await DEPOT_REPORTS.find((x) => x.slug === "depot-cash-book")!.run(fake(), { from: "2026-10-01", to: "2026-10-31", accountId: box });
    expect(only.rows.at(-1)!.cells).toMatchObject({ debit: 5700, credit: 1500, balance: 4200 });
    const main = await DEPOT_REPORTS.find((x) => x.slug === "depot-cash-book")!.run(fake(), { from: "2026-10-01", to: "2026-10-31", accountId: sys.CASH });
    expect(main.rows.at(-1)!.cells).toMatchObject({ debit: 0, credit: 0, balance: 0 });
    // the general P&L is untouched by the depot collection
    expect((await profitAndLoss(ctx.businessId, OCT)).netProfit).toBe(-1550); // depot expenses 1,500 + the office payment 50
  });

  it("fund back to the main cash; delete returns an expense's money to the box", async () => {
    await transferDepotFund(ctx, fund(1000, "OUT"));
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(3200);
    await expect(transferDepotFund(ctx, fund(5000, "OUT"))).rejects.toThrow(/পর্যাপ্ত টাকা নেই/);
    const [first] = (await listDepotExpenses(ctx.businessId, { expenseAccountId: rentId })).rows;
    await deleteDepotExpense(ctx, first.id);
    expect(await cashInHand(prisma, ctx.businessId, box)).toBe(4400);
    expect((await profitAndLoss(ctx.businessId, OCT)).netProfit).toBe(-350);
  });
});

run("depot cash — backup and restore", () => {
  it("depot expense / fund sourceKeys survive a restore unchanged; the restored box holds the same cash", async () => {
    const { exportBusiness, restoreBackup } = await import("@/server/services/backup");
    const src = await prisma.voucher.findFirstOrThrow({ where: { sourceKey: { startsWith: DEPOT_EXPENSE_SOURCE } }, orderBy: { createdAt: "desc" } });
    const backup = await exportBusiness(src.businessId);
    const user = await prisma.user.findFirstOrThrow({ where: { memberships: { some: { businessId: src.businessId } } } });
    const restored = await restoreBackup(JSON.parse(JSON.stringify(backup)), user.id);
    const keys = (b: string) => prisma.voucher.findMany({ where: { businessId: b, sourceKey: { not: null } }, select: { sourceKey: true }, orderBy: { sourceKey: "asc" } });
    expect((await keys(restored.businessId)).filter((k) => /^depot-(expense|fund):/.test(k.sourceKey!))).toEqual((await keys(src.businessId)).filter((k) => /^depot-(expense|fund):/.test(k.sourceKey!)));
    const boxOf = async (b: string) => (await prisma.account.findFirstOrThrow({ where: { businessId: b, systemKey: DEPOT_CASH_KEY } })).id;
    expect(await cashInHand(prisma, restored.businessId, await boxOf(restored.businessId))).toBe(await cashInHand(prisma, src.businessId, await boxOf(src.businessId)));
    expect(await prisma.account.count({ where: { businessId: restored.businessId, systemKey: DEPOT_CASH_KEY } })).toBe(1);
  });
});
