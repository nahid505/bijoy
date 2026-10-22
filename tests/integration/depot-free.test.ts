// Free / scheme goods against a real database. Hand-worked figures (cement, unit পিস):
//   stock in:    1 000 bags @ 450 + 50 free → stock 1 050, bill 450 000, average cost 450 000 / 1 050 = 428.5714
//   market sale: 100 bags @ 480 + 10 free   → stock 940, bill 48 000 (free not billed), COGS 110 × 428.5714 = 47 142.85
//   DO release:  200 bags + 20 free, commission 10 → stock 720, commission 2 000 (free earns none),
//                company ledger −(220 × 428.5714) = −94 285.71
//   free report: received 50, given 30, left 20
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { depotTotals } from "@/lib/depot";
import { depotDeliverySchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { profitAndLoss, trialBalance } from "@/server/services/report";
import { saveDepotDelivery } from "@/server/services/depot";
import { DEPOT_REPORTS } from "@/server/reports/depot";
import { exportBusiness, restoreBackup } from "@/server/services/backup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

run("free / scheme goods (ফ্রি পণ্য)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let cement: string;
  let company: { accountId: string };
  let dealer: { accountId: string };
  let purchaseId: string;

  const product = () => prisma.product.findUniqueOrThrow({ where: { id: cement } });
  const balance = async (id: string) => (await balancesBefore(ctx.businessId, undefined, [id], "DEPOT")).get(id) ?? 0;
  const line = (quantity: number, rate: number, freeQuantity = 0) => ({ productId: cement, quantity, freeQuantity, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null });
  const delivery = (o: Record<string, unknown>) => depotDeliverySchema.parse({ date: "2026-10-12", warehouseId, paidAmount: 0, cashAccountId: "", ...o });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Free", email: `free${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ফ্রি স্কিম ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    const pcs = await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } });
    cement = (await prisma.product.create({ data: { businessId: ctx.businessId, isDepotProduct: true, name: "সিমেন্ট", unitId: pcs.id, salePrice: 480, depotCommissionRate: 10 } })).id;
    company = await saveParty(ctx, "SUPPLIER", party("এসিআই সিমেন্ট"));
    dealer = await saveParty(ctx, "CUSTOMER", party("রহিম ট্রেডার্স"), undefined, { dealer: true });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stock in with free goods: physical stock grows, the bill does not, the average cost falls", async () => {
    const v = await saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-10"), reference: null, narration: null, partyAccountId: company.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [line(1000, 450, 50)],
    }, undefined, "DEPOT"); // depot stock in
    purchaseId = v.id;
    expect(Number(v.amount)).toBe(450_000);
    const p = await product();
    expect(Number(p.stock)).toBe(1050);
    expect(Number(p.avgCost)).toBeCloseTo(428.5714, 4);
    expect(await balance(company.accountId)).toBe(-450_000);
    expect(await balance(acc.INVENTORY)).toBe(450_000);
    const item = await prisma.voucherItem.findFirstOrThrow({ where: { voucherId: v.id } });
    expect([Number(item.quantity), Number(item.freeQuantity), Number(item.amount)]).toEqual([1000, 50, 450_000]);
  });

  it("market sale with free goods: stock out = paid + free, bill = paid × rate, COGS includes the free goods", async () => {
    expect(depotTotals([{ quantity: 100, freeQuantity: 10, rate: 480 }])).toMatchObject({ total: 48_000, quantity: 100, free: 10, stockOut: 110 });
    const v = await saveDepotDelivery(ctx, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: dealer.accountId, lines: [{ productId: cement, quantity: 100, freeQuantity: 10, rate: 480 }] }));
    expect(Number(v.amount)).toBe(48_000);
    expect(Number((await product()).stock)).toBe(940);
    expect(await balance(dealer.accountId)).toBe(48_000);
    const item = await prisma.voucherItem.findFirstOrThrow({ where: { voucherId: v.id } });
    expect(Number(item.costAmount)).toBe(47_142.85); // 110 × 428.5714 (unit cost kept to 4 decimals)
    expect((await profitAndLoss(ctx.businessId, {}, "DEPOT")).grossProfit).toBe(857.15);
  });

  it("DO release with free goods: stock out = paid + free, commission only on the paid quantity", async () => {
    const v = await saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: dealer.accountId, lines: [{ productId: cement, quantity: 200, freeQuantity: 20, rate: 10 }] }));
    expect(Number((await product()).stock)).toBe(720);
    expect(Number((await prisma.depotDelivery.findUniqueOrThrow({ where: { voucherId: v.id } })).commissionTotal)).toBe(2_000);
    expect(await balance(company.accountId)).toBeCloseTo(-450_000 + 94_285.71, 2);
    expect(await balance(dealer.accountId)).toBe(48_000); // unchanged by the DO release
    expect((await trialBalance(ctx.businessId, {}, "DEPOT")).balanced).toBe(true);
  });

  it("free scheme report: received 50, given 30, left 20", async () => {
    const fake = { business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "DEPOT" }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } } as never;
    const r = await DEPOT_REPORTS.find((x) => x.slug === "depot-free")!.run(fake, { from: "2026-10-01", to: "2026-10-31" });
    expect(r.rows[0].cells).toMatchObject({ product: "সিমেন্ট", unit: "পিস", received: 50, given: 30, balance: 20 });
    expect(r.summary?.map((s) => s.value)).toEqual(["৫০ পিস", "৩০ পিস", "২০ পিস"]);
    // before the deliveries: only the received 50
    const early = await DEPOT_REPORTS.find((x) => x.slug === "depot-free")!.run(fake, { from: "2026-10-01", to: "2026-10-10" });
    expect(early.rows[0].cells).toMatchObject({ received: 50, given: 0, balance: 50 });
  });

  it("editing the purchase's free quantity re-costs everything after it", async () => {
    await saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-10"), reference: null, narration: null, partyAccountId: company.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [line(1000, 450, 0)],
    }, purchaseId);
    expect(Number((await product()).stock)).toBe(670); // 1 000 − 110 − 220
    expect(Number((await product()).avgCost)).toBe(450);
    expect((await trialBalance(ctx.businessId, {}, "DEPOT")).balanced).toBe(true);
    await saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-10"), reference: null, narration: null, partyAccountId: company.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [line(1000, 450, 50)],
    }, purchaseId);
  });

  it("returns cannot carry free goods; negative free is refused by validation", async () => {
    await expect(saveTradeVoucher(ctx, "PURCHASE_RETURN", {
      date: D("2026-10-13"), reference: null, narration: null, partyAccountId: company.accountId, warehouseId, returnOfId: purchaseId, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [line(10, 450, 1)],
    })).rejects.toThrow(/ফেরত ভাউচারে ফ্রি/);
    expect(depotDeliverySchema.safeParse({ date: "2026-10-12", mode: "COMPANY_PAID", companyAccountId: "c", dealerAccountId: "d", lines: [{ productId: "p", quantity: 1, freeQuantity: -1, rate: 1 }] }).success).toBe(false);
  });

  it("backup keeps free quantities: the restored stock and cost are the same", async () => {
    const restored = await restoreBackup(await exportBusiness(ctx.businessId), ctx.userId);
    const p = await prisma.product.findFirstOrThrow({ where: { businessId: restored.businessId, name: "সিমেন্ট" } });
    const orig = await product();
    expect(Number(p.stock)).toBe(Number(orig.stock));
    expect(Number(p.avgCost)).toBeCloseTo(Number(orig.avgCost), 4);
    expect(await prisma.voucherItem.count({ where: { voucher: { businessId: restored.businessId }, freeQuantity: { gt: 0 } } })).toBe(3);
  });
});
