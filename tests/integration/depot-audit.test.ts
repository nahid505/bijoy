// Integration audit: depot inventory ↔ free scheme report ↔ stock movements stay in sync through edits,
// deletes and general (non-depot) free goods; the company's depot ledger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { depotDeliverySchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { deleteVoucher, saveStockJournal, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore, statement } from "@/server/services/ledger";
import { profitAndLoss } from "@/server/services/report";
import { systemAccounts } from "@/server/services/accounting";
import { trialBalance } from "@/server/services/report";
import { depotDashboard, saveDepotDelivery } from "@/server/services/depot";
import { DEPOT_REPORTS } from "@/server/reports/depot";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

run("depot integration audit", () => {
  let ctx: Ctx;
  let warehouseId: string;
  let cement: string;
  let company: { accountId: string };
  let dealer: { accountId: string };
  let doId: string;
  let saleId: string;
  const fake = () => ({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "DEPOT" }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } }) as never;
  const report = (slug: string, p: Record<string, string>) => DEPOT_REPORTS.find((r) => r.slug === slug)!.run(fake(), p);
  const line = (quantity: number, rate: number, freeQuantity = 0) => ({ productId: cement, quantity, freeQuantity, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null });
  const purchase = (items: ReturnType<typeof line>[], book: "GENERAL" | "DEPOT") =>
    saveTradeVoucher(ctx, "PURCHASE", { date: D("2026-10-09"), reference: null, narration: null, partyAccountId: company.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items }, undefined, book);
  const delivery = (o: Record<string, unknown>) =>
    depotDeliverySchema.parse({ date: "2026-10-10", reference: null, narration: null, warehouseId, doNumber: null, vehicleNo: null, driverName: null, notes: null, paidAmount: 0, cashAccountId: "", ...o });
  /** stock three ways: product cache, Σ movements, Σ(in + free) − Σ(out + free) from the voucher lines */
  const stock = async () => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id: cement } });
    const m = await prisma.stockMovement.aggregate({ where: { productId: cement }, _sum: { quantityIn: true, quantityOut: true } });
    return { cache: Number(p.stock), movements: Number(m._sum.quantityIn ?? 0) - Number(m._sum.quantityOut ?? 0) };
  };
  const free = async (to = "2026-10-31") => {
    const r = await report("depot-free", { from: "2026-10-01", to });
    return r.rows.length ? (r.rows[0].cells as { received: number; given: number; balance: number }) : { received: 0, given: 0, balance: 0 };
  };

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Audit", email: `audit${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "অডিট ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    const pcs = await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } });
    cement = (await prisma.product.create({ data: { businessId: ctx.businessId, isDepotProduct: true, name: "সিমেন্ট", unitId: pcs.id, salePrice: 480, depotCommissionRate: 10 } })).id;
    company = await saveParty(ctx, "SUPPLIER", party("এসিআই"));
    dealer = await saveParty(ctx, "CUSTOMER", party("রহিম ডিলার"), undefined, { dealer: true });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stock in with free (depot); a general purchase of the depot product is refused — the free scheme report counts the depot's", async () => {
    await purchase([line(1000, 450, 50)], "DEPOT");
    await expect(purchase([line(100, 450, 5)], "GENERAL")).rejects.toThrow(/ডিপো পণ্য/); // depot products never enter the general stock
    expect(await stock()).toEqual({ cache: 1050, movements: 1050 });
    expect(await free()).toMatchObject({ received: 50, given: 0, balance: 50 });
  });

  it("DO release and market sale move paid + free; the report counts the free given", async () => {
    doId = (await saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: dealer.accountId, lines: [{ productId: cement, quantity: 200, freeQuantity: 20, rate: 10 }] }))).id;
    saleId = (await saveDepotDelivery(ctx, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: dealer.accountId, lines: [{ productId: cement, quantity: 100, freeQuantity: 10, rate: 480 }] }))).id;
    expect(await stock()).toEqual({ cache: 1050 - 220 - 110, movements: 1050 - 220 - 110 });
    expect(await free()).toMatchObject({ received: 50, given: 30, balance: 20 });
    expect((await depotDashboard(ctx.businessId, "2026-10-10")).today.quantity).toBe(300); // paid quantity
  });

  it("editing a challan's free quantity and deleting a challan keep stock, movements and the report in step", async () => {
    await saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: dealer.accountId, lines: [{ productId: cement, quantity: 200, freeQuantity: 40, rate: 10 }] }), doId);
    expect(await stock()).toEqual({ cache: 1050 - 240 - 110, movements: 1050 - 240 - 110 });
    expect(await free()).toMatchObject({ received: 50, given: 50, balance: 0 });
    await deleteVoucher(ctx, saleId);
    expect(await stock()).toEqual({ cache: 1050 - 240, movements: 1050 - 240 });
    expect(await free()).toMatchObject({ received: 50, given: 40, balance: 10 });
    expect(await prisma.depotDelivery.count({ where: { voucherId: saleId } })).toBe(0); // the challan row goes with its voucher
    for (const b of ["GENERAL", "DEPOT"] as const) expect((await trialBalance(ctx.businessId, {}, b)).balanced, b).toBe(true);
  });

  it("company ledger (depot book): stock in and the DO release, not the general purchase", async () => {
    const r = await report("depot-company-ledger", { accountId: company.accountId, from: "2026-10-01", to: "2026-10-31" });
    const lines = r.rows.filter((x) => !x.kind);
    expect(lines.map((x) => x.cells.voucher)).toEqual([expect.stringMatching(/^SI-/), expect.stringMatching(/^DO-/)]);
    expect(JSON.stringify(r.rows)).not.toContain("PUR-");
    expect((await report("depot-company-ledger", {})).emptyMessage).toContain("নির্বাচন");
  });

  it("depot stock adjustment: DEPOT book (DSA-), moves the depot inventory and depot P&L, never the general books", async () => {
    const acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    const general = async () => (await balancesBefore(ctx.businessId, undefined, [acc.INVENTORY])).get(acc.INVENTORY) ?? 0;
    const depotInv = async () => (await balancesBefore(ctx.businessId, undefined, [acc.INVENTORY], "DEPOT")).get(acc.INVENTORY) ?? 0;
    const [g0, d0, s0] = [await general(), await depotInv(), (await stock()).cache];
    const v = await saveStockJournal(ctx, { date: D("2026-10-12"), reference: null, narration: "ভাঙা বস্তা", lines: [{ productId: cement, warehouseId, direction: -1, quantity: 5, rate: null, batchNo: null, expiryDate: null, mfgDate: null }] } as never, undefined, "DEPOT");
    expect(v.book).toBe("DEPOT");
    expect(v.voucherNo).toMatch(/^DSA-/);
    expect((await stock()).cache).toBe(s0 - 5);
    expect(await general()).toBe(g0); // the general inventory is untouched
    expect(await depotInv()).toBeLessThan(d0);
    expect((await profitAndLoss(ctx.businessId, {})).expenses).toBe(0);
    expect((await profitAndLoss(ctx.businessId, {}, "DEPOT")).netProfit).toBeLessThan(0 + (await profitAndLoss(ctx.businessId, {}, "DEPOT")).otherIncome);
    expect((await statement(ctx.businessId, [acc.INVENTORY], {})).lines.some((l) => l.voucherNo === v.voucherNo)).toBe(false);
    for (const b of ["GENERAL", "DEPOT"] as const) expect((await trialBalance(ctx.businessId, {}, b)).balanced, b).toBe(true);
    // an edit keeps it in the depot book
    const e = await saveStockJournal(ctx, { date: D("2026-10-12"), reference: null, narration: "ভাঙা বস্তা", lines: [{ productId: cement, warehouseId, direction: -1, quantity: 3, rate: null, batchNo: null, expiryDate: null, mfgDate: null }] } as never, v.id);
    expect(e.book).toBe("DEPOT");
    expect(await general()).toBe(g0);
    await deleteVoucher(ctx, v.id);
    expect((await stock()).cache).toBe(s0);
  });
});
