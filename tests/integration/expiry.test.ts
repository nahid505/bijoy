// Batch / expiry management end-to-end: lots, FEFO, expired-sale rule, daily notifications,
// write-off accounting — against a real PostgreSQL database.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { EXPIRED_SALE_MESSAGE } from "@/lib/expiry";
import { UserError } from "@/lib/errors";
import type { TradeVoucherInput } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveTradeVoucher, writeOffExpired } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { trialBalance } from "@/server/services/report";
import { markRead, runDailyChecks } from "@/server/services/notifications";
import { listBatches } from "@/server/services/expiry";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("product expiry management (batch level)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let medicine: string;
  let soap: string;
  let supplier: { id: string; accountId: string };
  let customer: { id: string; accountId: string };
  let splitSaleId: string;

  type Line = { productId: string; quantity: number; rate: number; batchNo?: string | null; expiryDate?: string; mfgDate?: string };
  const trade = (type: "SALES" | "PURCHASE" | "SALES_RETURN", date: string, party: string | null, items: Line[], opts: { returnOfId?: string; pay?: number } = {}) => {
    const input: TradeVoucherInput = {
      date: D(date), reference: null, narration: null, partyAccountId: party, warehouseId, returnOfId: opts.returnOfId ?? null, dueDate: null, discount: 0, vatPercent: 0,
      payments: opts.pay ? [{ accountId: acc.CASH, amount: opts.pay, reference: null }] : [],
      items: items.map((i) => ({
        productId: i.productId, quantity: i.quantity, rate: i.rate, unitId: null, discount: 0, batchNo: i.batchNo ?? null,
        expiryDate: i.expiryDate ? D(i.expiryDate) : null, mfgDate: i.mfgDate ? D(i.mfgDate) : null,
      })),
    };
    return saveTradeVoucher(ctx, type, input);
  };
  const batch = (batchNo: string, productId = medicine) => prisma.productBatch.findUniqueOrThrow({ where: { productId_batchNo: { productId, batchNo } } });
  const qty = async (batchNo: string) => Number((await batch(batchNo)).quantity);
  const balance = async (accountId: string) => (await balancesBefore(ctx.businessId, undefined, [accountId])).get(accountId) ?? 0;
  const assertBalanced = async (voucherId: string) => {
    const e = await prisma.journalEntry.findMany({ where: { voucherId } });
    expect(e.reduce((s, x) => s + Number(x.debit), 0)).toBeCloseTo(e.reduce((s, x) => s + Number(x.credit), 0), 2);
  };

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Expiry", email: `e${Date.now()}@test.local`, passwordHash: "x" } });
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "ফার্মেসি টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: b.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    const piece = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } })).id;
    const product = (name: string, code: string, trackBatch: boolean, minStock = 0) =>
      saveProduct(ctx, { name, code, barcode: null, categoryId: null, brandId: null, unitId: piece, purchasePrice: 10, salePrice: 15, wholesalePrice: 0, minStock, openingStock: 0, openingRate: 0, trackBatch });
    medicine = await product("মেডিসিন এ", "MED-A", true);
    soap = await product("সাবান", "SOAP", false, 10);
    const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 30 }); // 30 days: no overdue alerts in this scenario
    supplier = await saveParty(ctx, "SUPPLIER", party("ফার্মা ডিপো"));
    customer = await saveParty(ctx, "CUSTOMER", party("রোগী"));
  });

  it("stores several batches of one product, each with its own expiry, mfg date, supplier and cost", async () => {
    await trade("PURCHASE", "2026-09-01", supplier.accountId, [
      { productId: medicine, quantity: 20, rate: 10, batchNo: "A", expiryDate: "2026-10-10", mfgDate: "2025-10-10" },
      { productId: medicine, quantity: 50, rate: 12, batchNo: "B", expiryDate: "2026-12-20", mfgDate: "2025-12-20" },
      { productId: medicine, quantity: 30, rate: 8, batchNo: "C", expiryDate: "2026-09-30" },
    ]);
    const a = await batch("A");
    expect(Number(a.quantity)).toBe(20);
    expect(a.expiryDate?.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(a.mfgDate?.toISOString().slice(0, 10)).toBe("2025-10-10");
    expect(a.supplierId).toBe(supplier.id);
    expect(Number(a.purchasePrice)).toBe(10);
    expect(Number((await batch("B")).purchasePrice)).toBe(12);
    expect(await prisma.productBatch.count({ where: { productId: medicine } })).toBe(3);
    const moves = await prisma.stockMovement.findMany({ where: { productId: medicine } });
    expect(moves.every((m) => m.batchId)).toBe(true);
  });

  it("rejects a second receipt of the same batch number with a different expiry", async () => {
    await expect(trade("PURCHASE", "2026-09-05", supplier.accountId, [{ productId: medicine, quantity: 5, rate: 12, batchNo: "B", expiryDate: "2027-01-01" }])).rejects.toThrow(/ভিন্ন মেয়াদ/);
    await expect(trade("PURCHASE", "2026-09-05", supplier.accountId, [{ productId: medicine, quantity: 5, rate: 12, batchNo: "Z", expiryDate: "2026-01-01", mfgDate: "2026-06-01" }])).rejects.toThrow(/উৎপাদনের তারিখ/);
  });

  it("FEFO: a sale without a batch takes the earliest-expiring valid batch (10 units → batch A)", async () => {
    const v = await trade("SALES", "2026-10-03", null, [{ productId: medicine, quantity: 10, rate: 15 }], { pay: 150 });
    const item = await prisma.voucherItem.findFirstOrThrow({ where: { voucherId: v.id } });
    expect(item.batchNo).toBe("A");
    expect(await qty("A")).toBe(10);
    expect(await qty("B")).toBe(50);
    expect(await qty("C")).toBe(30); // expired on the sale date → never picked automatically
    await assertBalanced(v.id);
  });

  it("FEFO spans batches when the first one runs out, and COGS is the sum of both batches' costs", async () => {
    const v = await trade("SALES", "2026-10-03", customer.accountId, [{ productId: medicine, quantity: 15, rate: 15 }]);
    splitSaleId = v.id;
    const moves = await prisma.stockMovement.findMany({ where: { voucherId: v.id }, include: { batch: true }, orderBy: { createdAt: "asc" } });
    expect(moves.map((m) => [m.batch!.batchNo, Number(m.quantityOut)])).toEqual([["A", 10], ["B", 5]]);
    const item = await prisma.voucherItem.findFirstOrThrow({ where: { voucherId: v.id } });
    expect(item.batchNo).toBeNull(); // line spans two batches; details live on its movements
    expect(Number(item.costAmount)).toBeCloseTo(moves.reduce((s, m) => s + Number(m.value), 0), 2);
    expect(await qty("A")).toBe(0);
    expect(await qty("B")).toBe(45);
    await assertBalanced(v.id);
  });

  it("prevents selling an expired batch (default setting) with the Bangla message", async () => {
    const attempt = trade("SALES", "2026-10-03", null, [{ productId: medicine, quantity: 2, rate: 15, batchNo: "C" }], { pay: 30 });
    await expect(attempt).rejects.toThrow(UserError);
    await expect(trade("SALES", "2026-10-03", null, [{ productId: medicine, quantity: 2, rate: 15, batchNo: "C" }], { pay: 30 })).rejects.toThrow(EXPIRED_SALE_MESSAGE);
    // only expired stock could cover the rest → refused, never silently taken from the expired batch
    await expect(trade("SALES", "2026-10-03", null, [{ productId: medicine, quantity: 60, rate: 15 }], { pay: 900 })).rejects.toThrow(/মেয়াদোত্তীর্ণ/);
    expect(await qty("C")).toBe(30);
  });

  it("allows an expired batch only when an administrator enables it, and FEFO still skips it", async () => {
    await prisma.business.update({ where: { id: ctx.businessId }, data: { allowExpiredSale: true } });
    await trade("SALES", "2026-10-03", null, [{ productId: medicine, quantity: 2, rate: 15, batchNo: "C" }], { pay: 30 });
    expect(await qty("C")).toBe(28);
    const auto = await trade("SALES", "2026-10-03", null, [{ productId: medicine, quantity: 1, rate: 15 }], { pay: 15 });
    const m = await prisma.stockMovement.findFirstOrThrow({ where: { voucherId: auto.id }, include: { batch: true } });
    expect(m.batch!.batchNo).toBe("B");
    await prisma.business.update({ where: { id: ctx.businessId }, data: { allowExpiredSale: false } });
  });

  it("a sales return puts goods back into the batch they came from", async () => {
    await trade("SALES_RETURN", "2026-10-04", customer.accountId, [{ productId: medicine, quantity: 5, rate: 15, batchNo: "B" }], { returnOfId: splitSaleId });
    expect(await qty("B")).toBe(49);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: medicine } });
    const batches = await prisma.productBatch.findMany({ where: { productId: medicine } });
    expect(batches.reduce((s, b) => s + Number(b.quantity), 0)).toBeCloseTo(Number(product.stock), 3); // batch quantities reconcile with stock
  });

  it("daily check: creates expiry / low-stock notifications once, at the right warning level", async () => {
    await trade("PURCHASE", "2026-10-01", supplier.accountId, [
      { productId: medicine, quantity: 5, rate: 11, batchNo: "D", expiryDate: "2026-10-08" }, // 5 days left on 3 Oct → 7-day warning
      { productId: medicine, quantity: 6, rate: 11, batchNo: "E", expiryDate: "2026-10-25" }, // 22 days → 30-day warning
    ]);
    const r1 = await runDailyChecks(ctx.businessId, { today: D("2026-10-03") });
    const keys = (await prisma.notification.findMany({ where: { businessId: ctx.businessId, resolvedAt: null } })).map((n) => n.dedupeKey.replace(/:[^:]+:/, ":<id>:"));
    expect(keys.sort()).toEqual(["expiry:<id>:expired", "expiry:<id>:w30", "expiry:<id>:w7", "lowstock:<id>:2026-10-03"].sort());
    expect(await prisma.notification.count({ where: { businessId: ctx.businessId, kind: "LOW_STOCK", productId: soap } })).toBe(1);
    expect(r1.created).toBe(4);
    const expired = await prisma.notification.findFirstOrThrow({ where: { businessId: ctx.businessId, kind: "EXPIRED" } });
    expect(expired.message).toContain("ব্যাচ C");
    expect(Number(expired.quantity)).toBe(28);

    // same day again → skipped; even a forced re-run creates no duplicates
    expect((await runDailyChecks(ctx.businessId, { today: D("2026-10-03") })).skipped).toBe(true);
    const forced = await runDailyChecks(ctx.businessId, { today: D("2026-10-03"), force: true });
    expect(forced.created).toBe(0);
    expect(await prisma.notification.count({ where: { businessId: ctx.businessId } })).toBe(4);
  });

  it("reading a notification does not remove it", async () => {
    const before = await prisma.notification.count({ where: { businessId: ctx.businessId, resolvedAt: null } });
    expect(await markRead(ctx.businessId, ctx.userId, ["EXPIRED", "EXPIRY_WARNING", "LOW_STOCK", "OVERDUE"])).toBe(before);
    expect(await prisma.notification.count({ where: { businessId: ctx.businessId, resolvedAt: null } })).toBe(before);
    expect(await prisma.notificationRead.count({ where: { userId: ctx.userId } })).toBe(before);
  });

  it("moves batches to the next warning band and to expired as days pass (old band → history)", async () => {
    const r = await runDailyChecks(ctx.businessId, { today: D("2026-10-12") });
    // D (8 Oct) is now expired, E (25 Oct, 13 days) entered the 15-day band
    expect(r.created).toBe(2);
    expect(r.resolved).toBe(2);
    const open = await prisma.notification.findMany({ where: { businessId: ctx.businessId, resolvedAt: null, kind: { in: ["EXPIRED", "EXPIRY_WARNING"] } }, include: { batch: true } });
    expect(open.map((n) => `${n.batch!.batchNo}:${n.dedupeKey.split(":").pop()}`).sort()).toEqual(["C:expired", "D:expired", "E:w15"]);
    const history = await prisma.notification.count({ where: { businessId: ctx.businessId, resolvedAt: { not: null } } });
    expect(history).toBe(2); // D's 7-day and E's 30-day warnings are kept as history
    expect((await runDailyChecks(ctx.businessId, { today: D("2026-10-12"), force: true })).created).toBe(0);
  });

  it("lists batches with status filters and value = quantity × cost price", async () => {
    const all = await listBatches(ctx.businessId, D("2026-10-12"));
    const expiredRows = await listBatches(ctx.businessId, D("2026-10-12"), { filter: "expired" });
    expect(expiredRows.map((r) => r.batchNo).sort()).toEqual(["C", "D"]);
    const c = expiredRows.find((r) => r.batchNo === "C")!;
    expect(c.value).toBe(28 * 8);
    expect((await listBatches(ctx.businessId, D("2026-10-12"), { within: 15 })).map((r) => r.batchNo)).toEqual(["E"]);
    expect(all.map((r) => r.batchNo)).toEqual(["C", "D", "E", "B"]); // sorted by expiry date
  });

  it("writes off expired stock: reduces inventory, posts Dr expiry loss / Cr inventory, audits", async () => {
    const stockBefore = Number((await prisma.product.findUniqueOrThrow({ where: { id: medicine } })).stock);
    const inventoryBefore = await balance(acc.INVENTORY);
    const C = await batch("C");
    await expect(writeOffExpired(ctx, { date: D("2026-10-12"), batchIds: [(await batch("B")).id] })).rejects.toThrow(/মেয়াদোত্তীর্ণ/); // B is not expired

    const v = await writeOffExpired(ctx, { date: D("2026-10-12"), batchIds: [C.id] });
    expect(v.type).toBe("STOCK_JOURNAL");
    expect(await qty("C")).toBe(0);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: medicine } })).stock)).toBe(stockBefore - 28);

    const loss = await prisma.account.findFirstOrThrow({ where: { businessId: ctx.businessId, systemKey: "EXPIRY_LOSS" } });
    const entries = await prisma.journalEntry.findMany({ where: { voucherId: v.id } });
    const value = Number(v.amount);
    expect(value).toBeGreaterThan(0);
    expect(entries.map((e) => [e.accountId, Number(e.debit), Number(e.credit)]).sort()).toEqual(
      [[loss.id, value, 0], [acc.INVENTORY, 0, value]].sort(),
    );
    expect(await balance(loss.id)).toBe(value);
    expect(await balance(acc.INVENTORY)).toBeCloseTo(inventoryBefore - value, 2);
    await assertBalanced(v.id);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { businessId: ctx.businessId, entity: "ExpiryWriteOff", entityId: v.id } });
    expect(JSON.stringify(audit.details)).toContain('"batchNo":"C"');

    // the alert for C is resolved, history kept
    await runDailyChecks(ctx.businessId, { today: D("2026-10-12"), force: true });
    const cAlerts = await prisma.notification.findMany({ where: { batchId: C.id } });
    expect(cAlerts.length).toBe(1);
    expect(cAlerts[0].resolvedAt).not.toBeNull();
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
  });

  it("refuses a write-off when there is nothing expired to write off", async () => {
    const D_ = await batch("D");
    await writeOffExpired(ctx, { date: D("2026-10-12") }); // all remaining expired batches (D)
    expect(await qty("D")).toBe(0);
    await expect(writeOffExpired(ctx, { date: D("2026-10-12"), batchIds: [D_.id] })).rejects.toThrow(UserError);
    await expect(writeOffExpired(ctx, { date: D("2026-10-12") })).rejects.toThrow(/নেই/);
  });
});
