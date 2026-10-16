// Paddy purchase (weighbridge slip) against a real database.
// Hand-worked figures:
//   30 bags, gross 1 050 kg, dhalta 13 kg → net 1 037 kg → 25.93 mon × 1 250 = 32 412.50
//   supplier, paid 10 000 cash → supplier owed 22 412.50; stock +1 037 kg; inventory +32 412.50
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { paddyPurchaseSchema, type PaddyPurchaseInput } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { deleteVoucher, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { trialBalance } from "@/server/services/report";
import { createRiceMillTemplate } from "@/server/services/production";
import { listPaddyPurchases, loadPaddyPurchase, savePaddyPurchase } from "@/server/services/paddy";
import { exportBusiness, restoreBackup, validateBackup } from "@/server/services/backup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("paddy purchase (weighbridge slip)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let paddyId: string;
  let supplier: { id: string; accountId: string };
  let voucherId: string;
  let voucherNo: string;

  const stock = async () => Number((await prisma.product.findUniqueOrThrow({ where: { id: paddyId } })).stock);
  const balance = async (accountId: string) => (await balancesBefore(ctx.businessId, undefined, [accountId])).get(accountId) ?? 0;
  const input = (o: Record<string, unknown> = {}): PaddyPurchaseInput =>
    paddyPurchaseSchema.parse({
      date: "2026-10-01", productId: paddyId, warehouseId, partyAccountId: supplier.accountId, bagCount: 30, grossKg: 1050, dhaltaKg: 13, ratePerMon: 1250,
      paidAmount: 10000, cashAccountId: acc.CASH, notes: "গাড়ি: ঢাকা মেট্রো-ট ১২-৩৪৫৬, ড্রাইভার করিম", ...o,
    });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Paddy", email: `paddy${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ধান ক্রয় টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    await createRiceMillTemplate(ctx);
    paddyId = (await prisma.product.findFirstOrThrow({ where: { businessId: ctx.businessId, name: { startsWith: "ধান" } } })).id;
    supplier = await saveParty(ctx, "SUPPLIER", { name: "কৃষক রহমান", mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves a purchase voucher: line in মণ, amount = mon × rate, stock = exact net kg, supplier dues", async () => {
    const v = await savePaddyPurchase(ctx, input());
    voucherId = v.id;
    voucherNo = v.voucherNo;
    const full = await prisma.voucher.findUniqueOrThrow({ where: { id: v.id }, include: { items: { include: { unit: true } }, paddyPurchase: true } });
    expect(full.type).toBe("PURCHASE");
    expect(Number(full.amount)).toBe(32412.5);
    expect(Number(full.paidAmount)).toBe(10000);
    const line = full.items[0];
    expect(full.items).toHaveLength(1);
    expect(line.unit?.name).toBe("মণ (৪০ কেজি)");
    expect(Number(line.unitFactor)).toBe(40);
    expect(Number(line.quantity)).toBe(25.93);
    expect(Number(line.baseQuantity)).toBe(1037);
    expect(Number(line.rate)).toBe(1250);
    expect(Number(line.amount)).toBe(32412.5);
    expect(full.paddyPurchase).toMatchObject({ bagCount: 30, notes: "গাড়ি: ঢাকা মেট্রো-ট ১২-৩৪৫৬, ড্রাইভার করিম" });
    const pp = full.paddyPurchase!;
    expect([pp.grossKg, pp.dhaltaKg, pp.netKg, pp.mon, pp.ratePerMon, pp.totalPrice].map(Number)).toEqual([1050, 13, 1037, 25.93, 1250, 32412.5]);
    expect(await stock()).toBe(1037);
    expect(await balance(supplier.accountId)).toBe(-22412.5);
    expect(await balance(acc.INVENTORY)).toBe(32412.5);
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
  });

  it("bag count is information only: changing it does not change any figure", async () => {
    await savePaddyPurchase(ctx, input({ bagCount: 45 }), voucherId);
    const pp = (await loadPaddyPurchase(ctx.businessId, voucherId))!;
    expect(pp.bagCount).toBe(45);
    expect(Number(pp.voucher.amount)).toBe(32412.5);
    expect(await stock()).toBe(1037);
  });

  it("edit re-posts with the same number; new weights, dhalta and rate", async () => {
    const v = await savePaddyPurchase(ctx, input({ grossKg: 2000, dhaltaKg: 20, ratePerMon: 1300, paidAmount: 0 }), voucherId);
    expect(v.id).toBe(voucherId);
    expect(v.voucherNo).toBe(voucherNo);
    // 1 980 kg → 49.5 mon × 1 300 = 64 350
    const pp = (await loadPaddyPurchase(ctx.businessId, voucherId))!;
    expect([pp.netKg, pp.mon, pp.totalPrice].map(Number)).toEqual([1980, 49.5, 64350]);
    expect(await stock()).toBe(1980);
    expect(await balance(supplier.accountId)).toBe(-64350);
    expect(await prisma.voucher.count({ where: { businessId: ctx.businessId, type: "PURCHASE" } })).toBe(1);
  });

  it("cash purchase without a supplier is paid in full", async () => {
    const cashBefore = await balance(acc.CASH);
    const v = await savePaddyPurchase(ctx, input({ partyAccountId: "", paidAmount: 0, grossKg: 400, dhaltaKg: 0, ratePerMon: 1200, bagCount: 8 }));
    const full = await prisma.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect(Number(full.amount)).toBe(12000);
    expect(Number(full.paidAmount)).toBe(12000);
    expect(await balance(acc.CASH)).toBe(cashBefore - 12000);
    const list = await listPaddyPurchases(ctx.businessId, { skip: 0, take: 20 });
    expect(list.total).toBe(2);
    expect(list.sums).toEqual({ bags: 38, netKg: 2380, mon: 59.5, total: 76350 });
    const october = await listPaddyPurchases(ctx.businessId, { from: D("2026-11-01"), skip: 0, take: 20 });
    expect(october.total).toBe(0);
  });

  it("rejects a non-kg product, dhalta ≥ gross, a too-small net, and another business's slip", async () => {
    const unit = await prisma.unit.create({ data: { businessId: ctx.businessId, name: "বস্তা-একক" } });
    const bag = await prisma.product.create({ data: { businessId: ctx.businessId, name: "বস্তা ধান", unitId: unit.id } });
    await expect(savePaddyPurchase(ctx, input({ productId: bag.id }))).rejects.toThrow(/কেজি/);
    expect(paddyPurchaseSchema.safeParse({ ...input(), date: "2026-10-01", dhaltaKg: 1050 }).success).toBe(false);
    await expect(savePaddyPurchase(ctx, input({ grossKg: 0.3, dhaltaKg: 0 }))).rejects.toBeInstanceOf(UserError);

    const user = await prisma.user.create({ data: { name: "Other", email: `paddy-other${Date.now()}@test.local`, passwordHash: "x" } });
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য মিল", ownerUserId: user.id }));
    expect(await loadPaddyPurchase(other.id, voucherId)).toBeNull();
    await expect(savePaddyPurchase({ businessId: other.id, userId: user.id }, input(), voucherId)).rejects.toBeInstanceOf(UserError);
    expect(await stock()).toBe(2380);
  });

  it("the stock override must match quantity × unit factor", async () => {
    const mon = await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, factor: 40 } });
    const trade = (baseQuantity: number) => saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-02"), reference: null, narration: null, partyAccountId: null, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 1250, reference: null }],
      items: [{ productId: paddyId, unitId: mon.id, quantity: 1, rate: 1250, discount: 0, batchNo: null, expiryDate: null, mfgDate: null, baseQuantity }],
    } as never);
    await expect(trade(45)).rejects.toThrow(/মিলছে না/);
    expect(await stock()).toBe(2380);
  });

  it("backup carries the slips; the restored copy has the same figures", async () => {
    const file = await exportBusiness(ctx.businessId);
    const report = validateBackup(file);
    expect(report.ok).toBe(true);
    expect(report.stats.paddyPurchases).toBe(2);
    const restored = await restoreBackup(file, ctx.userId);
    const rows = await prisma.paddyPurchase.findMany({ where: { businessId: restored.businessId }, orderBy: { bagCount: "desc" } });
    expect(rows.map((r) => [r.bagCount, Number(r.netKg), Number(r.totalPrice)])).toEqual([[30, 1980, 64350], [8, 400, 12000]]);
    const rp = await prisma.product.findFirstOrThrow({ where: { businessId: restored.businessId, name: { startsWith: "ধান" } } });
    expect(Number(rp.stock)).toBe(2380);
    expect((await trialBalance(restored.businessId, {})).balanced).toBe(true);
  });

  it("deleting the voucher removes the slip and the stock", async () => {
    await deleteVoucher(ctx, voucherId);
    expect(await prisma.paddyPurchase.count({ where: { voucherId } })).toBe(0);
    expect(await stock()).toBe(400);
  });
});
