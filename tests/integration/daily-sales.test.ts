// ডেইলি বিক্রয় রিপোর্ট against a real database. Hand-worked figures for 10 Oct:
//   sale 1 (রহিম স্টোর, চালান C-101): চাল 100 কেজি × 55 = 5 500; খুদ 20 কেজি × 25 − 50 = 450; voucher discount 100; paid 3 000
//   sale 2 (cash):                   চাল 10 কেজি × 56 = 560; খালি বস্তা 5 পিস × 35 = 175; paid 735
//   → lines 6 685, discount 100, net 6 585, collected 3 735, due 2 850; quantity 130 কেজি · 5 পিস
//   a sale on 11 Oct is not in the sheet
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { featureForPath } from "@/lib/features";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { createRiceMillTemplate } from "@/server/services/production";
import { dailySales, quantityText, DAILY_SALES_REPORT } from "@/server/reports/daily-sales";
import { toCsv, toXlsx } from "@/server/reports/export";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("ডেইলি বিক্রয় রিপোর্ট (daily sales report)", () => {
  let ctx: Ctx;
  let p: Record<"rice" | "broken" | "bag", string>;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Sell", email: `dailysell${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "বিক্রয় খাতা টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    const acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    await createRiceMillTemplate(ctx);
    const pcs = await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } });
    const bag = await prisma.product.create({ data: { businessId: ctx.businessId, name: "খালি বস্তা", unitId: pcs.id } });
    const products = await prisma.product.findMany({ where: { businessId: ctx.businessId } });
    const id = (n: string) => products.find((x) => x.name.startsWith(n))!.id;
    p = { rice: id("চাল"), broken: id("খুদ"), bag: bag.id };
    const customer = await saveParty(ctx, "CUSTOMER", { name: "রহিম স্টোর", mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

    const line = (productId: string, quantity: number, rate: number, discount = 0) => ({ productId, quantity, rate, unitId: null, discount, batchNo: null, expiryDate: null, mfgDate: null });
    const trade = (type: "SALES" | "PURCHASE", date: string, partyAccountId: string | null, items: ReturnType<typeof line>[], o: { discount?: number; paid?: number; reference?: string; narration?: string } = {}) =>
      saveTradeVoucher(ctx, type, {
        date: D(date), reference: o.reference ?? null, narration: o.narration ?? null, partyAccountId, warehouseId, returnOfId: null, dueDate: null, discount: o.discount ?? 0, vatPercent: 0,
        payments: o.paid ? [{ accountId: acc.CASH, amount: o.paid, reference: null }] : [], items,
      });
    const stock = [line(p.rice, 1000, 40), line(p.broken, 100, 20), line(p.bag, 50, 30)];
    await trade("PURCHASE", "2026-10-09", null, stock, { paid: 40_000 + 2_000 + 1_500 });
    await trade("SALES", "2026-10-10", customer.accountId, [line(p.rice, 100, 55), line(p.broken, 20, 25, 50)], { discount: 100, paid: 3_000, reference: "C-101", narration: "বাকিতে বিক্রয়" });
    await trade("SALES", "2026-10-10", null, [line(p.rice, 10, 56), line(p.bag, 5, 35)], { paid: 735 });
    await trade("SALES", "2026-10-11", null, [line(p.rice, 1, 55)], { paid: 55 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lines: party, product, quantity, rate, amount and the চালান note", async () => {
    const d = await dailySales(ctx.businessId, { date: "2026-10-10" });
    expect(d.lines.map((l) => [l.party, l.product.slice(0, 3), l.quantity, l.unit, l.rate, l.amount])).toEqual([
      ["রহিম স্টোর", "চাল", 100, "কেজি", 55, 5_500],
      ["রহিম স্টোর", "খুদ", 20, "কেজি", 25, 450],
      ["নগদ বিক্রয়", "চাল", 10, "কেজি", 56, 560],
      ["নগদ বিক্রয়", "খাল", 5, "পিস", 35, 175],
    ]);
    expect(d.lines[1].discount).toBe(50);
    expect(d.lines[0].note).toBe("চালান C-101 · বাকিতে বিক্রয়");
    expect(d.lines[2].note).toBe("");
    expect(d.invoices).toBe(2);
  });

  it("summary: quantity per unit, total, voucher discount, net, collected and due", async () => {
    const d = await dailySales(ctx.businessId, { date: "2026-10-10" });
    expect(d.quantityByUnit).toEqual([{ unit: "কেজি", quantity: 130 }, { unit: "পিস", quantity: 5 }]);
    expect(quantityText(d.quantityByUnit)).toBe("১৩০ কেজি · ৫ পিস");
    expect([d.total, d.discount, d.vat, d.net, d.collected, d.due]).toEqual([6_685, 100, 0, 6_585, 3_735, 2_850]);
    // net = what the vouchers posted as sales
    const posted = await prisma.voucher.aggregate({ where: { businessId: ctx.businessId, type: "SALES", date: D("2026-10-10") }, _sum: { amount: true } });
    expect(Number(posted._sum.amount)).toBe(d.net);
  });

  it("other days, a bad date and another business", async () => {
    const next = await dailySales(ctx.businessId, { date: "2026-10-11" });
    expect([next.lines.length, next.total, quantityText(next.quantityByUnit)]).toEqual([1, 55, "১ কেজি"]);
    const empty = await dailySales(ctx.businessId, { date: "2026-10-01" });
    expect([empty.lines.length, empty.total, quantityText(empty.quantityByUnit)]).toEqual([0, 0, "০"]);
    expect((await dailySales(ctx.businessId, { date: "2026-02-30x" })).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const user = await prisma.user.create({ data: { name: "O", email: `dailysell-o${Date.now()}@test.local`, passwordHash: "x" } });
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য", ownerUserId: user.id }));
    expect((await dailySales(other.id, { date: "2026-10-10" })).lines).toHaveLength(0);
  });

  it("export: Excel / CSV columns and totals; the report belongs to the sales module", async () => {
    const report = await DAILY_SALES_REPORT.run({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7 }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } } as never, { date: "2026-10-10" });
    expect(report.columns.map((c) => c.label)).toEqual(["নম্বর", "পার্টির নাম", "পণ্যের নাম", "পরিমাণ", "একক", "দর", "টাকা", "নোট"]);
    const csv = toCsv(report);
    for (const s of ["রহিম স্টোর (INV-", "নগদ বিক্রয়", "5500.00", "6685.00", "6585.00", "১৩০ কেজি · ৫ পিস", "চালান C-101"]) expect(csv).toContain(s);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(report, "বিক্রয় খাতা টেস্ট")) as unknown as ArrayBuffer);
    const cells: unknown[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => cells.push(c.value)));
    expect(cells).toContain("পণ্যের নাম");
    expect(cells).toContain(6685);
    expect(featureForPath("/reports/daily-sales")).toBe("SALES");
    expect(featureForPath("/api/reports/daily-sales")).toBe("SALES");
  });
});
