// End-to-end accounting engine tests against a real PostgreSQL database.
// Expected values are worked by hand in the comments so they are auditable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { UnbalancedVoucherError } from "@/lib/accounting";
import { UserError } from "@/lib/errors";
import type { TradeVoucherInput } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { setAccountOpening, systemAccounts, type Ctx, assertVouchersBalanced } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { deleteVoucher, saveCashVoucher, saveJournalVoucher, saveStockJournal, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore, statement } from "@/server/services/ledger";
import { balanceSheet, profitAndLoss, trialBalance } from "@/server/services/report";
import { partyAging } from "@/server/services/aging";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

type Item = { productId: string; quantity: number; rate: number; unitId?: string | null; discount?: number; batchNo?: string | null; expiryDate?: Date | null; mfgDate?: Date | null };
const party = (o: { name: string; openingBalance?: number; creditLimit?: number; creditDays?: number }) => ({
  name: o.name, mobile: null, email: null, address: null, notes: null, openingBalance: o.openingBalance ?? 0, creditLimit: o.creditLimit ?? 0, creditDays: o.creditDays ?? 0,
});

run("double-entry accounting engine", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let customer: { id: string; accountId: string };
  let supplier: { id: string; accountId: string };
  let productId: string;
  let units: Record<string, string>;
  let rentId: string, bankId: string, mobileId: string, capitalId: string, warehouseId: string;
  let saleId: string, purchaseId: string;

  const trade = (type: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN", o: {
    date: string; party?: string | null; payments?: { accountId: string; amount: number }[]; items: Item[]; discount?: number; vatPercent?: number; returnOfId?: string | null;
  }, editId?: string) => {
    const input: TradeVoucherInput = {
      date: D(o.date), reference: null, narration: null, partyAccountId: o.party ?? null, warehouseId, returnOfId: o.returnOfId ?? null, dueDate: null,
      discount: o.discount ?? 0, vatPercent: o.vatPercent ?? 0,
      payments: (o.payments ?? []).map((p) => ({ ...p, reference: null })),
      items: o.items.map((i) => ({ productId: i.productId, quantity: i.quantity, rate: i.rate, unitId: i.unitId ?? null, discount: i.discount ?? 0, batchNo: i.batchNo ?? null, expiryDate: i.expiryDate ?? null, mfgDate: i.mfgDate ?? null })),
    };
    return saveTradeVoucher(ctx, type, input, editId);
  };
  const balance = async (accountId: string) => (await balancesBefore(ctx.businessId, undefined, [accountId])).get(accountId) ?? 0;
  const stockOf = async (id = productId) => Number((await prisma.product.findUniqueOrThrow({ where: { id } })).stock);
  const voucherCount = () => prisma.voucher.count({ where: { businessId: ctx.businessId } });
  const newProduct = (name: string, code: string, extra: Partial<{ trackBatch: boolean }> = {}) =>
    saveProduct(ctx, { name, code, barcode: null, categoryId: null, brandId: null, unitId: units["কেজি"], purchasePrice: 50, salePrice: 60, wholesalePrice: 58, minStock: 10, openingStock: 0, openingRate: 0, trackBatch: false, ...extra });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Test", email: `t${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "টেস্ট ব্যবসা", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    units = Object.fromEntries((await prisma.unit.findMany({ where: { businessId: ctx.businessId } })).map((u) => [u.name, u.id]));
    const accounts = await prisma.account.findMany({ where: { businessId: ctx.businessId } });
    const key = (k: string) => accounts.find((a) => a.systemKey === k)!.id;
    rentId = key("RENT"); bankId = key("BANK"); mobileId = key("MOBILE"); capitalId = key("CAPITAL");
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bootstraps a complete chart of accounts", async () => {
    expect(Object.values(acc).every(Boolean)).toBe(true);
    expect(await prisma.accountGroup.count({ where: { businessId: ctx.businessId } })).toBeGreaterThanOrEqual(15);
  });

  it("posts opening balances against opening-balance equity", async () => {
    await prisma.$transaction((tx) => setAccountOpening(tx, ctx, acc.CASH, 10_000));
    customer = await saveParty(ctx, "CUSTOMER", party({ name: "রহিম", openingBalance: 1_000 }));
    supplier = await saveParty(ctx, "SUPPLIER", party({ name: "মেঘনা" }));
    expect(await balance(acc.CASH)).toBe(10_000);
    expect(await balance(customer.accountId)).toBe(1_000);
    expect(await balance(acc.OPENING_EQUITY)).toBe(-11_000);
  });

  it("purchase: increases stock, inventory and supplier payable; records payment", async () => {
    productId = await newProduct("চাল", "R1");
    // 100 kg × 50 = 5,000; paid 2,000 cash → supplier owed 3,000
    purchaseId = (await trade("PURCHASE", { date: "2026-08-01", party: supplier.accountId, payments: [{ accountId: acc.CASH, amount: 2_000 }], items: [{ productId, quantity: 100, rate: 50 }] })).id;
    expect(await stockOf()).toBe(100);
    expect(await balance(acc.INVENTORY)).toBe(5_000);
    expect(await balance(supplier.accountId)).toBe(-3_000);
    expect(await balance(acc.CASH)).toBe(8_000);
  });

  it("sale with alternative unit, discount, VAT and SPLIT payment (cash + bKash)", async () => {
    // 1 বস্তা (50 kg) @ 3,000 → subtotal 3,000; discount 100; VAT 5% of 2,900 = 145; total 3,045
    // paid 600 cash + 400 mobile banking
    const v = await trade("SALES", {
      date: "2026-08-05", party: customer.accountId, discount: 100, vatPercent: 5,
      payments: [{ accountId: acc.CASH, amount: 600 }, { accountId: mobileId, amount: 400 }],
      items: [{ productId, unitId: units["বস্তা (৫০ কেজি)"], quantity: 1, rate: 3_000 }],
    });
    saleId = v.id;
    expect(Number(v.amount)).toBe(3_045);
    expect(await stockOf()).toBe(50);
    expect(await balance(acc.SALES)).toBe(-3_000);
    expect(await balance(acc.VAT_PAYABLE)).toBe(-145);
    expect(await balance(acc.DISCOUNT_ALLOWED)).toBe(100);
    expect(await balance(acc.COGS)).toBe(2_500);
    expect(await balance(acc.INVENTORY)).toBe(2_500);
    expect(await balance(customer.accountId)).toBe(3_045); // 1,000 + 3,045 − 1,000
    expect(await balance(acc.CASH)).toBe(8_600);
    expect(await balance(mobileId)).toBe(400);
    expect(await prisma.voucherPayment.count({ where: { voucherId: v.id } })).toBe(2);
  });

  it("walk-in cash sale must be paid in full", async () => {
    await expect(trade("SALES", { date: "2026-08-05", payments: [{ accountId: acc.CASH, amount: 10 }], items: [{ productId, quantity: 1, rate: 60 }] })).rejects.toThrow(UserError);
    const before = await balance(acc.CASH);
    await trade("SALES", { date: "2026-08-05", payments: [{ accountId: acc.CASH, amount: 60 }], items: [{ productId, quantity: 1, rate: 60 }] });
    expect(await balance(acc.CASH)).toBe(before + 60);
    expect(await stockOf()).toBe(49);
  });

  it("rejects overselling and saves nothing", async () => {
    const before = await voucherCount();
    await expect(trade("SALES", { date: "2026-08-06", party: customer.accountId, items: [{ productId, quantity: 9_999, rate: 60 }] })).rejects.toThrow(/পর্যাপ্ত স্টক নেই/);
    expect(await voucherCount()).toBe(before);
    expect(await stockOf()).toBe(49);
  });

  it("enforces the customer credit limit", async () => {
    const limited = await saveParty(ctx, "CUSTOMER", party({ name: "সীমিত কাস্টমার", creditLimit: 500, creditDays: 7 }));
    await expect(trade("SALES", { date: "2026-08-06", party: limited.accountId, items: [{ productId, quantity: 10, rate: 60 }] })).rejects.toThrow(/ক্রেডিট সীমা/);
    // within the limit after a partial payment: 600 − 200 = 400 ≤ 500
    const v = await trade("SALES", { date: "2026-08-06", party: limited.accountId, payments: [{ accountId: acc.CASH, amount: 200 }], items: [{ productId, quantity: 10, rate: 60 }] });
    expect(v.dueDate?.toISOString().slice(0, 10)).toBe("2026-08-13"); // date + 7 credit days
    await deleteVoucher(ctx, v.id);
  });

  it("receipt voucher reduces customer due", async () => {
    await saveCashVoucher(ctx, "RECEIPT", { date: D("2026-08-07"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: customer.accountId, amount: 545, narration: null }] });
    expect(await balance(customer.accountId)).toBe(2_500);
  });

  it("payment voucher with multiple lines (supplier + rent)", async () => {
    const cashBefore = await balance(acc.CASH);
    await saveCashVoucher(ctx, "PAYMENT", {
      date: D("2026-08-08"), reference: null, narration: null, cashAccountId: acc.CASH,
      lines: [{ accountId: supplier.accountId, amount: 1_000, narration: null }, { accountId: rentId, amount: 300, narration: null }],
    });
    expect(await balance(supplier.accountId)).toBe(-2_000);
    expect(await balance(rentId)).toBe(300);
    expect(await balance(acc.CASH)).toBe(cashBefore - 1_300);
  });

  it("journal voucher must balance; an unbalanced journal is rejected atomically", async () => {
    await saveJournalVoucher(ctx, { date: D("2026-08-09"), reference: null, narration: "মূলধন জমা", lines: [
      { accountId: bankId, debit: 5_000, credit: 0, narration: null },
      { accountId: capitalId, debit: 0, credit: 5_000, narration: null },
    ] });
    expect(await balance(bankId)).toBe(5_000);
    const before = await voucherCount();
    await expect(saveJournalVoucher(ctx, { date: D("2026-08-09"), reference: null, narration: null, lines: [
      { accountId: bankId, debit: 100, credit: 0, narration: null },
      { accountId: capitalId, debit: 0, credit: 90, narration: null },
    ] })).rejects.toThrow(UnbalancedVoucherError);
    expect(await voucherCount()).toBe(before);
  });

  it("an unbalanced voucher never commits (PostgreSQL: deferred trigger; MySQL: in-transaction re-check)", async () => {
    const v = await prisma.voucher.findFirstOrThrow({ where: { businessId: ctx.businessId, type: "JOURNAL" } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.journalEntry.create({ data: { businessId: ctx.businessId, voucherId: v.id, accountId: bankId, date: v.date, debit: 1, credit: 0 } });
        await assertVouchersBalanced(tx, [v.id]); // what every posting path runs (no-op on PostgreSQL, where the trigger fires at commit)
      }),
    ).rejects.toThrow(/Unbalanced voucher|অসমতাপূর্ণ/);
    expect(await balance(bankId)).toBe(5_000);
  });

  it("sales return against the invoice restores stock, reverses revenue and cost, and is limited to sold quantity", async () => {
    await expect(trade("SALES_RETURN", { date: "2026-08-10", party: customer.accountId, returnOfId: saleId, items: [{ productId, quantity: 60, rate: 60 }] })).rejects.toThrow(/সর্বোচ্চ/);
    // 5 kg @ 60 = 300 credited to customer; cost 5 × 50 = 250 back to inventory
    await trade("SALES_RETURN", { date: "2026-08-10", party: customer.accountId, returnOfId: saleId, items: [{ productId, quantity: 5, rate: 60 }] });
    expect(await stockOf()).toBe(54);
    expect(await balance(acc.SALES_RETURN)).toBe(300);
    expect(await balance(customer.accountId)).toBe(2_200);
    await expect(deleteVoucher(ctx, saleId)).rejects.toThrow(/ফেরত/); // invoice with returns cannot be deleted
  });

  it("purchase return reduces stock and supplier payable", async () => {
    await trade("PURCHASE_RETURN", { date: "2026-08-11", party: supplier.accountId, returnOfId: purchaseId, items: [{ productId, quantity: 10, rate: 50 }] });
    expect(await stockOf()).toBe(44);
    expect(await balance(supplier.accountId)).toBe(-1_500);
  });

  it("stock journal shortage reduces stock and books the loss", async () => {
    await saveStockJournal(ctx, { date: D("2026-08-12"), reference: null, narration: "ঘাটতি", lines: [{ productId, warehouseId, direction: -1, quantity: 2, rate: undefined, batchNo: null, expiryDate: null, mfgDate: null }] });
    expect(await stockOf()).toBe(42);
    expect(await balance(acc.STOCK_ADJUSTMENT)).toBe(100);
  });

  it("BACKDATED purchase revalues the cost of later sales (COGS)", async () => {
    const p = await newProduct("ডাল", "D1");
    await trade("PURCHASE", { date: "2026-09-01", party: supplier.accountId, items: [{ productId: p, quantity: 10, rate: 100 }] });
    const sale = await trade("SALES", { date: "2026-09-10", party: customer.accountId, items: [{ productId: p, quantity: 10, rate: 150 }] });
    const cogsLine = async () => Number((await prisma.journalEntry.findFirstOrThrow({ where: { voucherId: sale.id, accountId: acc.COGS } })).debit);
    expect(await cogsLine()).toBe(1_000); // 10 × 100
    // Inserted BEFORE the sale: 10 more at 160 → average at sale date = (10×100 + 10×160)/20 = 130
    const late = await trade("PURCHASE", { date: "2026-09-05", party: supplier.accountId, items: [{ productId: p, quantity: 10, rate: 160 }] });
    expect(await cogsLine()).toBe(1_300);
    expect(await stockOf(p)).toBe(10);
    // Deleting it again restores the original cost
    await deleteVoucher(ctx, late.id);
    expect(await cogsLine()).toBe(1_000);
  });

  it("a BACKDATED sale that would make stock negative on that date is rejected", async () => {
    const p = await newProduct("চিনি", "S1");
    await trade("PURCHASE", { date: "2026-09-20", party: supplier.accountId, items: [{ productId: p, quantity: 5, rate: 120 }] });
    // final stock would be 5 − 3 = 2, but on 2026-09-15 nothing was in stock yet
    await expect(trade("SALES", { date: "2026-09-15", party: customer.accountId, items: [{ productId: p, quantity: 3, rate: 140 }] })).rejects.toThrow(/ঋণাত্মক/);
    expect(await stockOf(p)).toBe(5);
  });

  it("batch / expiry tracking: sales draw from a specific batch", async () => {
    const p = await newProduct("ওষুধ", "M1", { trackBatch: true });
    await expect(trade("PURCHASE", { date: "2026-09-02", party: supplier.accountId, items: [{ productId: p, quantity: 10, rate: 20 }] })).rejects.toThrow(/ব্যাচ/);
    await trade("PURCHASE", { date: "2026-09-02", party: supplier.accountId, items: [{ productId: p, quantity: 10, rate: 20, batchNo: "B-1", expiryDate: D("2027-01-31") }, { productId: p, quantity: 5, rate: 20, batchNo: "B-2", expiryDate: D("2027-06-30") }] });
    await expect(trade("SALES", { date: "2026-09-03", party: customer.accountId, items: [{ productId: p, quantity: 6, rate: 30, batchNo: "B-2" }] })).rejects.toThrow(/B-2/);
    await trade("SALES", { date: "2026-09-03", party: customer.accountId, items: [{ productId: p, quantity: 6, rate: 30, batchNo: "B-1" }] });
    expect(await stockOf(p)).toBe(9);
  });

  it("customer aging allocates payments to the oldest invoices first (FIFO)", async () => {
    const c = await saveParty(ctx, "CUSTOMER", party({ name: "বাকি কাস্টমার", openingBalance: 100, creditDays: 10 }));
    const p = await newProduct("লবণ", "L1");
    await trade("PURCHASE", { date: "2026-06-01", party: supplier.accountId, items: [{ productId: p, quantity: 100, rate: 10 }] });
    await trade("SALES", { date: "2026-06-10", party: c.accountId, items: [{ productId: p, quantity: 30, rate: 10 }] }); // 300, due 06-20
    await trade("SALES", { date: "2026-08-20", party: c.accountId, items: [{ productId: p, quantity: 20, rate: 10 }] }); // 200, due 08-30
    await saveCashVoucher(ctx, "RECEIPT", { date: D("2026-08-25"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: c.accountId, amount: 250, narration: null }] });
    // credits 250 clear opening 100 + 150 of the June invoice → open: June 150, August 200
    const [row] = await partyAging(ctx.businessId, "CUSTOMER", D("2026-09-05"), [c.accountId]);
    expect(row.balance).toBe(350);
    expect(row.overdue).toBe(350); // June due 06-20, August due 08-30: both before 09-05
    expect(row.buckets).toEqual({ "0-30": 200, "31-60": 0, "61-90": 150, "90+": 0 });
  });

  it("period lock blocks changes on or before the lock date", async () => {
    await prisma.business.update({ where: { id: ctx.businessId }, data: { lockDate: D("2026-08-31") } });
    await expect(saveCashVoucher(ctx, "RECEIPT", { date: D("2026-08-31"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: customer.accountId, amount: 1, narration: null }] })).rejects.toThrow(/লক/);
    await expect(deleteVoucher(ctx, purchaseId)).rejects.toThrow(/লক/);
    await prisma.business.update({ where: { id: ctx.businessId }, data: { lockDate: null } });
  });

  it("customer and supplier statements reconcile with their ledgers", async () => {
    const s = await statement(ctx.businessId, [customer.accountId], {});
    expect(s.closing).toBe(await balance(customer.accountId));
    const sup = await statement(ctx.businessId, [supplier.accountId], {});
    expect(sup.closing).toBe(await balance(supplier.accountId));
  });

  it("trial balance balances; P&L and balance sheet tie out", async () => {
    const tb = await trialBalance(ctx.businessId, {});
    expect(tb.balanced).toBe(true);
    const pl = await profitAndLoss(ctx.businessId, {});
    const bs = await balanceSheet(ctx.businessId, D("2100-01-01"));
    expect(bs.difference).toBe(0);
    expect(bs.currentProfit).toBe(pl.netProfit);
  });

  it("inventory ledger equals the stock valuation (movements)", async () => {
    const value = await prisma.stockMovement.findMany({ where: { businessId: ctx.businessId } });
    const stockValue = value.reduce((s, m) => s + (Number(m.quantityIn) - Number(m.quantityOut)) * Number(m.unitCost), 0);
    expect(Math.abs((await balance(acc.INVENTORY)) - stockValue)).toBeLessThan(0.05);
  });

  it("editing a sale reposts entries and stock (reverse & repost)", async () => {
    const before = await stockOf();
    await trade("SALES", { date: "2026-08-05", party: customer.accountId, items: [{ productId, quantity: 10, rate: 60 }] }, saleId);
    // old sale 50 kg undone, new sale 10 kg → +40
    expect(await stockOf()).toBe(before + 40);
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
  });

  it("deleting a purchase whose goods were sold is refused", async () => {
    await expect(deleteVoucher(ctx, purchaseId)).rejects.toThrow(UserError);
  });

  it("tenant isolation: another business cannot post to these ledgers", async () => {
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য ব্যবসা", ownerUserId: ctx.userId }));
    const otherCash = (await prisma.account.findFirstOrThrow({ where: { businessId: other.id, systemKey: "CASH" } })).id;
    await expect(
      saveCashVoucher({ businessId: other.id, userId: ctx.userId }, "RECEIPT", { date: D("2026-08-13"), reference: null, narration: null, cashAccountId: otherCash, lines: [{ accountId: customer.accountId, amount: 10, narration: null }] }),
    ).rejects.toThrow(UserError);
  });

  it("every voucher is balanced and the whole ledger nets to zero", async () => {
    const perVoucher = await prisma.journalEntry.groupBy({ by: ["voucherId"], where: { businessId: ctx.businessId }, _sum: { debit: true, credit: true } });
    for (const v of perVoucher) expect(Number(v._sum.debit)).toBe(Number(v._sum.credit));
    const all = await prisma.journalEntry.aggregate({ where: { businessId: ctx.businessId }, _sum: { debit: true, credit: true } });
    expect(Number(all._sum.debit)).toBe(Number(all._sum.credit));
  });
});
