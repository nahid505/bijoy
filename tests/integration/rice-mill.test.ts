// Auto rice mill: business type → module, weighbridge slip (loaded − empty vehicle), variety / moisture, the labour
// payment kept in step with its slip, milling yield, rice / by-product sales with cost, stock and the mill report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { strList } from "@/lib/dialect";
import { businessModules } from "@/lib/business-types";
import { paddyPurchaseSchema, type ProductionInput } from "@/lib/validation";
import { weighbridgeGross } from "@/lib/paddy";
import { createBusiness } from "@/server/services/bootstrap";
import { parseJsonPayload } from "@/server/action-utils";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { savePaddyPurchase } from "@/server/services/paddy";
import { saveProduction } from "@/server/services/production";
import { deleteVoucher, saveCashVoucher, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { trialBalance } from "@/server/services/report";
import { millProducts, millSales, millStock, millSummary } from "@/server/services/rice-mill";
import { RICE_MILL_REPORT } from "@/server/reports/rice-mill";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
const OCT = { gte: D("2026-10-01"), lt: D("2026-11-01") };

describe("auto rice mill — rules", () => {
  it("the AUTO_RICE_MILL type switches on the mill module (and the general sales module)", () => {
    expect([...businessModules(["AUTO_RICE_MILL"])].sort()).toEqual(["RICE_MILL", "TRADING"]);
    expect(businessModules(["RETAIL"]).has("RICE_MILL")).toBe(false);
  });
  it("weighbridge: loaded − empty vehicle; nothing until both are valid", () => {
    expect(weighbridgeGross(12500, 4500)).toBe(8000);
    expect([weighbridgeGross(12500, null), weighbridgeGross(4000, 4500), weighbridgeGross(0, 0)]).toEqual([null, null, null]);
  });
});

run("auto rice mill", () => {
  let ctx: Ctx;
  let acc: Record<string, string>;
  let warehouseId: string;
  const p: Record<string, string> = {};
  let supplier: { accountId: string };
  let customer: { accountId: string };
  let slipId: string;
  // the form posts a JSON payload; parseJsonPayload turns Bangla / mixed digits into numbers first
  const slip = (o: Record<string, unknown> = {}) => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ date: "2026-10-10", productId: p.paddy, warehouseId, partyAccountId: supplier.accountId, cashAccountId: acc.CASH, paidAmount: 0, bagCount: 200, grossKg: 0, dhaltaKg: 40, ratePerMon: 1200, variety: "মিনিকেট", moisturePct: "১৪", vehicleGrossKg: "১২৫০০", vehicleTareKg: "4500", labourCost: 600, ...o }));
    return parseJsonPayload(paddyPurchaseSchema, fd);
  };
  const labourVoucher = (id: string) => prisma.voucher.findFirst({ where: { businessId: ctx.businessId, sourceKey: `paddy-labour:${id}` }, include: { entries: true } });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Mill", email: `armill${Date.now()}@test.local`, passwordHash: "x" } });
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "অটো রাইস মিল", ownerUserId: user.id, businessTypes: ["AUTO_RICE_MILL"] }));
    ctx = { businessId: b.id, userId: user.id };
    acc = { ...(await systemAccounts(prisma as never, b.id)) };
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: b.id } })).id;
    const kg = await prisma.unit.findFirstOrThrow({ where: { businessId: b.id, name: "কেজি" } });
    for (const [k, name] of [["paddy", "ধান"], ["rice", "মিনিকেট চাল"], ["broken", "খুদ"], ["bran", "কুঁড়া"], ["husk", "তুষ"]]) p[k] = (await prisma.product.create({ data: { businessId: b.id, name, unitId: kg.id } })).id;
    supplier = await saveParty(ctx, "SUPPLIER", party("করিম ব্যাপারী"));
    customer = await saveParty(ctx, "CUSTOMER", party("রহিম রাইস এজেন্সি"));
    await saveCashVoucher(ctx, "RECEIPT", { date: D("2026-10-01"), reference: null, narration: "মূলধন", cashAccountId: acc.CASH, lines: [{ accountId: acc.CAPITAL ?? acc.OPENING_EQUITY, amount: 500000, narration: null }] } as never).catch(() => undefined);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("the business stores its type", async () => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
    expect([b.businessType, strList(b.businessTypes)]).toEqual(["AUTO_RICE_MILL", ["AUTO_RICE_MILL"]]);
  });

  it("weighbridge slip: gross from the vehicle weights (Bangla digits too), net, mon, total; variety and moisture kept", async () => {
    const v = await savePaddyPurchase(ctx, slip());
    slipId = v.id;
    const s = await prisma.paddyPurchase.findUniqueOrThrow({ where: { voucherId: v.id } });
    expect([Number(s.vehicleGrossKg), Number(s.vehicleTareKg), Number(s.grossKg), Number(s.netKg), Number(s.mon), Number(s.totalPrice)]).toEqual([12500, 4500, 8000, 7960, 199, 238800]);
    expect([s.variety, Number(s.moisturePct), Number(s.labourCost)]).toEqual(["মিনিকেট", 14, 600]);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p.paddy } })).stock)).toBe(7960);
  });

  it("labour: a linked payment Dr 'ধান ক্রয়ের লেবার খরচ' / Cr cash; edit changes it, 0 removes it; never edited on its own", async () => {
    let lv = await labourVoucher(slipId);
    const labourAcc = await prisma.account.findFirstOrThrow({ where: { businessId: ctx.businessId, systemKey: "PADDY_LABOUR" }, include: { group: true } });
    expect(labourAcc.group.systemKey).toBe("DIRECT_EXPENSES");
    expect(lv!.entries.map((e) => [e.accountId, Number(e.debit), Number(e.credit)]).sort()).toEqual([[acc.CASH, 0, 600], [labourAcc.id, 600, 0]].sort());
    await savePaddyPurchase(ctx, slip({ labourCost: 800 }), slipId);
    lv = await labourVoucher(slipId);
    expect(Number(lv!.amount)).toBe(800);
    await expect(deleteVoucher(ctx, lv!.id)).rejects.toThrow(/স্লিপ থেকে/);
    await savePaddyPurchase(ctx, slip({ labourCost: 0 }), slipId);
    expect(await labourVoucher(slipId)).toBeNull();
    await savePaddyPurchase(ctx, slip({ labourCost: 750 }), slipId);
    expect(Number((await labourVoucher(slipId))!.amount)).toBe(750);
  });

  it("validation: both vehicle weights or none; empty below loaded; labour needs a cash / bank", () => {
    expect(() => slip({ vehicleTareKg: "" })).toThrow(/দুটো ওজনই/);
    expect(() => slip({ vehicleTareKg: 13000 })).toThrow(/খালি গাড়ির ওজন/);
    expect(() => slip({ cashAccountId: "" })).toThrow(/লেবার খরচ/);
    expect(slip({ vehicleGrossKg: "", vehicleTareKg: "", grossKg: 1050 }).vehicleGrossKg).toBeNull(); // typed gross still works
  });

  it("milling batch: paddy out, rice and by-products in; yield and process loss", async () => {
    const input: ProductionInput = {
      date: D("2026-10-12"), reference: "ব্যাচ-১", narration: null, recipeId: null, batches: 1, warehouseId,
      inputs: [{ productId: p.paddy, quantity: 5000, batchNo: null }],
      outputs: [
        { productId: p.rice, quantity: 3300, costShare: 90, batchNo: null, expiryDate: null },
        { productId: p.broken, quantity: 250, costShare: 4, batchNo: null, expiryDate: null },
        { productId: p.bran, quantity: 400, costShare: 4, batchNo: null, expiryDate: null },
        { productId: p.husk, quantity: 1000, costShare: 2, batchNo: null, expiryDate: null },
      ],
      extraCost: 3000, costAccountId: acc.CASH,
    } as never;
    await saveProduction(ctx, input);
    const m = await millSummary(ctx.businessId, OCT);
    expect([m.milling.runs, m.milling.milledKg, m.milling.producedKg, m.milling.lossKg, m.milling.lossPercent, m.milling.extraCost]).toEqual([1, 5000, 4950, 50, 1, 3000]);
    expect(Object.fromEntries(m.milling.produced.map((o) => [o.name, o.percent]))).toEqual({ "মিনিকেট চাল": 66, "তুষ": 20, "কুঁড়া": 8, "খুদ": 5 });
    expect([m.purchase.slips, m.purchase.netKg, m.purchase.amount, m.labourCost]).toEqual([1, 7960, 238800, 750]);
    expect(m.purchase.byVariety[0].variety).toBe("মিনিকেট");
    const ids = await millProducts(ctx.businessId);
    expect([ids.paddy, ids.outputs.sort()]).toEqual([[p.paddy], [p.rice, p.broken, p.bran, p.husk].sort()]);
  });

  it("rice / by-product sales: party ledger as usual; revenue, cost and profit per product", async () => {
    const line = (productId: string, quantity: number, rate: number) => ({ productId, quantity, freeQuantity: 0, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null });
    await saveTradeVoucher(ctx, "SALES", { date: D("2026-10-13"), reference: null, narration: null, partyAccountId: customer.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [line(p.rice, 1000, 60), line(p.bran, 200, 25)] } as never);
    expect((await balancesBefore(ctx.businessId, undefined, [customer.accountId])).get(customer.accountId)).toBe(65000); // the customer owes it
    const s = await millSales(ctx.businessId, OCT);
    expect([s.voucherCount, s.revenue]).toEqual([1, 65000]);
    const rice = s.products.find((x) => x.productId === p.rice)!;
    expect([rice.quantity, rice.revenue]).toEqual([1000, 60000]);
    expect(rice.cost).toBeGreaterThan(0);
    expect(s.cost).toBeGreaterThan(rice.cost);
  });

  it("stock and the mill report; books balance", async () => {
    const st = await millStock(ctx.businessId);
    expect(st.paddy.map((r) => [r.name, r.stock, r.mon])).toEqual([["ধান", 2960, 74]]);
    expect(st.outputs.find((r) => r.name === "মিনিকেট চাল")!.stock).toBe(2300);
    const fake = { business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "AUTO_RICE_MILL", businessTypes: ["AUTO_RICE_MILL"] }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } } as never;
    const r = await RICE_MILL_REPORT.run(fake, { from: "2026-10-01", to: "2026-10-31" });
    const text = JSON.stringify(r.rows);
    expect(text).toContain("মিনিকেট — ১ টি স্লিপ");
    expect(text).toContain("৬৬.০০%");
    expect(r.summary!.map((x) => x.label)).toEqual(["ধান ক্রয়", "চালের ফলন", "চাল ও উপজাত বিক্রয়", "মিলের লাভ"]);
    expect(r.summary![1].value).toBe("৬৬.০০%");
    expect((await trialBalance(ctx.businessId, { lt: D("2026-11-01") })).balanced).toBe(true);
  });

  it("deleting a slip takes its labour payment with it", async () => {
    const v = await savePaddyPurchase(ctx, slip({ date: "2026-10-20", labourCost: 300, vehicleGrossKg: "", vehicleTareKg: "", grossKg: 400, dhaltaKg: 0 }));
    expect(await labourVoucher(v.id)).not.toBeNull();
    await deleteVoucher(ctx, v.id);
    expect(await labourVoucher(v.id)).toBeNull();
    expect((await trialBalance(ctx.businessId, { lt: D("2026-11-01") })).balanced).toBe(true);
  });
});
