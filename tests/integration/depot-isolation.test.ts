// Depot ↔ general isolation: the depot keeps its own book (src/lib/book.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { depotDeliverySchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { deleteVoucher, saveCashVoucher, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore, statement } from "@/server/services/ledger";
import { balanceSheet, profitAndLoss, trialBalance } from "@/server/services/report";
import { saveDepotDelivery, transferableCommission, transferCommission } from "@/server/services/depot";
import { searchParties } from "@/server/lookup";
import { findReport } from "@/server/reports/registry";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

run("depot isolation (ডিপো হিসাব আলাদা)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let cement: string;
  let rice: string;
  let company: { accountId: string };
  let dealer: { id: string; accountId: string };
  let shopper: { id: string; accountId: string };
  const v: Record<string, { id: string; voucherNo: string }> = {};
  const fake = () => ({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "DEPOT" }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } }) as never;
  const items = (productId: string, quantity: number, rate: number) => [{ productId, quantity, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }];
  const trade = { reference: null, narration: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0 };
  const delivery = (o: Record<string, unknown>) =>
    depotDeliverySchema.parse({ date: "2026-10-10", reference: null, narration: null, warehouseId, doNumber: null, vehicleNo: null, driverName: null, notes: null, paidAmount: 0, cashAccountId: "", ...o });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Iso", email: `iso${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ডিপো + দোকান", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    const pcs = await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } });
    cement = (await prisma.product.create({ data: { businessId: ctx.businessId, isDepotProduct: true, name: "সিমেন্ট", unitId: pcs.id, salePrice: 480, depotCommissionRate: 10 } })).id;
    rice = (await prisma.product.create({ data: { businessId: ctx.businessId, name: "চাল", unitId: pcs.id, salePrice: 100 } })).id;
    company = await saveParty(ctx, "SUPPLIER", party("এসিআই সিমেন্ট"));
    dealer = await saveParty(ctx, "CUSTOMER", party("রহিম ডিলার"), undefined, { dealer: true });
    shopper = await saveParty(ctx, "CUSTOMER", party("সাধারণ কাস্টমার"));
    // general business: buy rice, sell rice
    await saveTradeVoucher(ctx, "PURCHASE", { ...trade, date: D("2026-10-09"), partyAccountId: company.accountId, warehouseId, payments: [], items: items(rice, 100, 80) });
    v.generalSale = await saveTradeVoucher(ctx, "SALES", { ...trade, date: D("2026-10-10"), partyAccountId: shopper.accountId, warehouseId, payments: [{ accountId: acc.CASH, amount: 1_000, reference: null }], items: items(rice, 10, 100) });
    // depot: stock in, DO release, market sale, market collection, company payment
    v.stockIn = await saveTradeVoucher(ctx, "PURCHASE", { ...trade, date: D("2026-10-09"), partyAccountId: company.accountId, warehouseId, payments: [], items: items(cement, 1000, 450) }, undefined, "DEPOT");
    v.doRelease = await saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: dealer.accountId, lines: [{ productId: cement, quantity: 300, rate: 10 }] }));
    v.marketSale = await saveDepotDelivery(ctx, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: dealer.accountId, paidAmount: 8_000, cashAccountId: acc.CASH, lines: [{ productId: cement, quantity: 100, rate: 480 }] }));
    v.collection = await saveCashVoucher(ctx, "RECEIPT", { date: D("2026-10-11"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: dealer.accountId, amount: 10_000, narration: null }] }, undefined, "DEPOT");
    v.companyPay = await saveCashVoucher(ctx, "PAYMENT", { date: D("2026-10-11"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: company.accountId, amount: 15_000, narration: null }] }, undefined, "DEPOT");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("depot vouchers are numbered in their own series and carry the DEPOT book down to every entry", async () => {
    expect(v.stockIn.voucherNo).toMatch(/^SI-/);
    expect(v.marketSale.voucherNo).toMatch(/^MS-/);
    expect(v.collection.voucherNo).toMatch(/^MC-/);
    expect(v.companyPay.voucherNo).toMatch(/^DP-/);
    expect(v.doRelease.voucherNo).toMatch(/^DO-/);
    expect(v.generalSale.voucherNo).toMatch(/^INV-000001$/); // the general series has no gap
    for (const k of ["stockIn", "doRelease", "marketSale", "collection", "companyPay"]) {
      const books = await prisma.journalEntry.findMany({ where: { voucherId: v[k].id }, select: { book: true } });
      expect(books.length, k).toBeGreaterThan(0);
      expect(books.every((b) => b.book === "DEPOT"), k).toBe(true);
    }
    expect((await prisma.journalEntry.findMany({ where: { voucherId: v.generalSale.id } })).every((e) => e.book === "GENERAL")).toBe(true);
  });

  it("general P&L, balance sheet and trial balance see the general business only — each book balances", async () => {
    const pl = await profitAndLoss(ctx.businessId, {});
    expect(pl.netSales).toBe(1_000);
    expect(pl.netProfit).toBe(200); // 10 × (100 − 80)
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
    expect((await trialBalance(ctx.businessId, {}, "DEPOT")).balanced).toBe(true);
    expect((await trialBalance(ctx.businessId, {}, "ALL")).balanced).toBe(true);
    expect((await balanceSheet(ctx.businessId, D("2999-01-01"))).difference).toBe(0);
    expect((await balanceSheet(ctx.businessId, D("2999-01-01"), "DEPOT")).difference).toBe(0);
    const depot = await profitAndLoss(ctx.businessId, {}, "DEPOT");
    expect(depot.netSales).toBe(48_000);
    expect(depot.otherIncome).toBe(3_000); // company commission
    expect(depot.netProfit).toBe(3_000 + 48_000 - 45_000);
  });

  it("general cash book, ledgers and party balances exclude every depot transaction", async () => {
    const cashGeneral = await statement(ctx.businessId, [acc.CASH], {});
    expect(cashGeneral.closing).toBe(1_000);
    expect(cashGeneral.lines.map((l) => l.voucherNo)).toEqual([v.generalSale.voucherNo]);
    const cashDepot = await statement(ctx.businessId, [acc.CASH], {}, { book: "DEPOT" });
    expect(cashDepot.closing).toBe(8_000 + 10_000 - 15_000);
    // the company is a supplier in both books: general payable 8 000 (rice); depot payable kept apart
    expect((await balancesBefore(ctx.businessId, undefined, [company.accountId])).get(company.accountId)).toBe(-8_000);
    expect((await balancesBefore(ctx.businessId, undefined, [company.accountId], "DEPOT")).get(company.accountId)).toBe(-(450_000 - 135_000 - 15_000));
    expect((await balancesBefore(ctx.businessId, undefined, [dealer.accountId])).get(dealer.accountId) ?? 0).toBe(0);
    expect((await balancesBefore(ctx.businessId, undefined, [dealer.accountId], "DEPOT")).get(dealer.accountId)).toBe(48_000 - 8_000 - 10_000);
  });

  it("general reports: sales, purchases, day book, customers — nothing of the depot; depot reports carry it", async () => {
    const rows = async (slug: string, p: Record<string, string> = { from: "2026-07-01", to: "2026-10-31" }) => (await findReport(slug)!.run(fake(), p)).rows;
    const nos = (r: { cells: Record<string, unknown> }[]) => JSON.stringify(r);
    const sales = await rows("sales");
    expect(nos(sales)).toContain(v.generalSale.voucherNo);
    expect(nos(sales)).not.toContain(v.marketSale.voucherNo);
    expect(nos(await rows("purchases"))).not.toContain(v.stockIn.voucherNo);
    const day = nos(await rows("day-book"));
    for (const k of ["stockIn", "doRelease", "marketSale", "collection", "companyPay"]) expect(day, k).not.toContain(v[k].voucherNo);
    const customers = nos(await rows("customers"));
    expect(customers).toContain("সাধারণ কাস্টমার");
    expect(customers).not.toContain("রহিম ডিলার");
    expect(nos(await rows("customer-dues", { asOf: "2026-10-31" }))).not.toContain("রহিম ডিলার");
    // depot side
    expect(nos(await rows("depot-market-dues", { asOf: "2026-10-31" }))).toContain("রহিম ডিলার");
    const depotPl = await findReport("depot-profit-loss")!.run(fake(), { from: "2026-07-01", to: "2026-10-31" });
    expect(depotPl.title).toBe("ডিপো লাভ-ক্ষতি");
    expect(nos(await rows("depot-cash-book"))).toContain(v.collection.voucherNo);
  });

  it("dealers vs customers: separate pickers; the books refuse each other's parties", async () => {
    expect((await searchParties(ctx.businessId, "CUSTOMER", "")).map((p) => p.name)).toEqual(["সাধারণ কাস্টমার"]);
    expect((await searchParties(ctx.businessId, "CUSTOMER", "", { dealer: true })).map((p) => p.name)).toEqual(["রহিম ডিলার"]);
    await expect(saveCashVoucher(ctx, "RECEIPT", { date: D("2026-10-12"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: dealer.accountId, amount: 1, narration: null }] })).rejects.toThrow(/ডিপোর হিসাব/);
    await expect(saveCashVoucher(ctx, "RECEIPT", { date: D("2026-10-12"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: shopper.accountId, amount: 1, narration: null }] }, undefined, "DEPOT")).rejects.toThrow(/সাধারণ কাস্টমার/);
    await expect(saveDepotDelivery(ctx, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: shopper.accountId, paidAmount: 0, lines: [{ productId: cement, quantity: 1, rate: 480 }] }))).rejects.toThrow(/ডিলার পাওয়া যায়নি/);
  });

  it("returns follow their invoice's book: a stock-in return / market-sale return stays in the depot book", async () => {
    const before = await profitAndLoss(ctx.businessId, {});
    const ret = await saveTradeVoucher(ctx, "PURCHASE_RETURN", { ...trade, date: D("2026-10-12"), partyAccountId: company.accountId, warehouseId, returnOfId: v.stockIn.id, payments: [], items: items(cement, 10, 450) });
    expect(ret.book).toBe("DEPOT");
    expect(ret.voucherNo).toMatch(/^SIR-/);
    expect((await balancesBefore(ctx.businessId, undefined, [acc.INVENTORY])).get(acc.INVENTORY)).toBe(8_000 - 800); // general inventory untouched (100 − 10 rice @ 80)
    const sr = await saveTradeVoucher(ctx, "SALES_RETURN", { ...trade, date: D("2026-10-12"), partyAccountId: dealer.accountId, warehouseId, returnOfId: v.marketSale.id, payments: [], items: items(cement, 5, 480) });
    expect(sr.book).toBe("DEPOT");
    expect((await profitAndLoss(ctx.businessId, {})).netSales).toBe(before.netSales);
    // a depot-book return cannot be forced into the general book
    await expect(saveTradeVoucher(ctx, "PURCHASE_RETURN", { ...trade, date: D("2026-10-12"), partyAccountId: company.accountId, warehouseId, returnOfId: v.stockIn.id, payments: [], items: items(cement, 1, 450) }, undefined, "GENERAL")).rejects.toThrow(/মূল ইনভয়েসের হিসাবেই/);
    for (const b of ["GENERAL", "DEPOT"] as const) expect((await trialBalance(ctx.businessId, {}, b)).balanced, b).toBe(true);
    await deleteVoucher(ctx, sr.id);
    await deleteVoucher(ctx, ret.id);
  });

  it("commission → general income: only the earned commission, both books stay balanced, deleting removes both halves", async () => {
    expect(await transferableCommission(ctx.businessId)).toEqual({ earned: 3_000, transferred: 0, available: 3_000 });
    await expect(transferCommission(ctx, { date: D("2026-10-12"), amount: 3_500, depotCashAccountId: acc.CASH, generalCashAccountId: acc.CASH, reference: null })).rejects.toThrow(/স্থানান্তরযোগ্য/);
    const t = await transferCommission(ctx, { date: D("2026-10-12"), amount: 2_000, depotCashAccountId: acc.CASH, generalCashAccountId: acc.CASH, reference: null });
    expect(t.depot.voucherNo).toMatch(/^DJ-/);
    expect(t.general.book).toBe("GENERAL");
    const pl = await profitAndLoss(ctx.businessId, {});
    expect(pl.otherIncome).toBe(2_000); // "ডিপো কমিশন আয় (স্থানান্তরিত)"
    expect(pl.netProfit).toBe(2_200);
    expect((await statement(ctx.businessId, [acc.CASH], {})).closing).toBe(3_000);
    expect((await statement(ctx.businessId, [acc.CASH], {}, { book: "DEPOT" })).closing).toBe(3_000 - 2_000);
    expect((await profitAndLoss(ctx.businessId, {}, "DEPOT")).netProfit).toBe(6_000); // the transfer is not a depot expense
    expect((await transferableCommission(ctx.businessId)).available).toBe(1_000);
    for (const b of ["GENERAL", "DEPOT"] as const) expect((await trialBalance(ctx.businessId, {}, b)).balanced, b).toBe(true);
    await deleteVoucher(ctx, t.general.id);
    expect(await prisma.voucher.count({ where: { id: { in: [t.depot.id, t.general.id] } } })).toBe(0);
    expect((await transferableCommission(ctx.businessId)).available).toBe(3_000);
  });
});
