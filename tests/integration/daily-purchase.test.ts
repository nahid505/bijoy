// ডেইলি ক্রয় রিপোর্ট against a real database. Hand-worked figures for 10 Oct:
//   অন্যান্য ক্রয়: supplier voucher — চাল 10 × 50 = 500, তুষ 4 × 125 − 20 = 480, voucher discount 30
//                  cash voucher     — চাল 5 × 52 = 260
//                  → মোট টাকা 1 240, নিট 1 210
//   ধান ক্রয়:     supplier 30 bags 1 050 − 13 = 1 037 kg → 25.93 mon × 1 250 = 32 412.50
//                  cash      8 bags   400 −  0 =   400 kg → 10.00 mon × 1 200 = 12 000.00
//                  → bags 38, gross 1 450, dhalta 13, net 1 437, mon 35.93, total 44 412.50
//   সর্বমোট ক্রয় = 1 210 + 44 412.50 = 45 622.50; 11 Oct purchases are not in the sheet
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { paddyPurchaseSchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { createRiceMillTemplate } from "@/server/services/production";
import { savePaddyPurchase } from "@/server/services/paddy";
import { dailyPurchase, DAILY_PURCHASE_REPORT } from "@/server/reports/daily-purchase";
import { toCsv, toXlsx } from "@/server/reports/export";
import { featureForPath } from "@/lib/features";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("ডেইলি ক্রয় রিপোর্ট (daily purchase report)", () => {
  let ctx: Ctx;
  let p: Record<string, string>;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Buy", email: `dailybuy${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ক্রয় খাতা টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    const acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    await createRiceMillTemplate(ctx);
    const products = await prisma.product.findMany({ where: { businessId: ctx.businessId } });
    const id = (n: string) => products.find((x) => x.name.startsWith(n))!.id;
    p = { paddy: id("ধান"), rice: id("চাল"), husk: id("তুষ") };
    const supplier = await saveParty(ctx, "SUPPLIER", { name: "মেসার্স করিম ট্রেডার্স", mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

    const line = (productId: string, quantity: number, rate: number, discount = 0) => ({ productId, quantity, rate, unitId: null, discount, batchNo: null, expiryDate: null, mfgDate: null });
    const purchase = (date: string, partyAccountId: string | null, items: ReturnType<typeof line>[], discount = 0, paid = 0, narration: string | null = null) =>
      saveTradeVoucher(ctx, "PURCHASE", {
        date: D(date), reference: null, narration, partyAccountId, warehouseId, returnOfId: null, dueDate: null, discount, vatPercent: 0,
        payments: paid ? [{ accountId: acc.CASH, amount: paid, reference: null }] : [], items,
      });
    await purchase("2026-10-10", supplier.accountId, [line(p.rice, 10, 50), line(p.husk, 4, 125, 20)], 30, 0, "সাপ্তাহিক মাল");
    await purchase("2026-10-10", null, [line(p.rice, 5, 52)], 0, 260);
    await purchase("2026-10-11", null, [line(p.rice, 1, 50)], 0, 50);

    const paddy = (o: Record<string, unknown>) => savePaddyPurchase(ctx, paddyPurchaseSchema.parse({ date: "2026-10-10", productId: p.paddy, warehouseId, cashAccountId: acc.CASH, paidAmount: 0, ...o }));
    await paddy({ partyAccountId: supplier.accountId, bagCount: 30, grossKg: 1050, dhaltaKg: 13, ratePerMon: 1250, notes: "ট্রাক ঢাকা মেট্রো-ট ১১-২২৩৩" });
    await paddy({ partyAccountId: "", bagCount: 8, grossKg: 400, dhaltaKg: 0, ratePerMon: 1200 });
    await paddy({ date: "2026-10-11", partyAccountId: "", bagCount: 5, grossKg: 200, dhaltaKg: 0, ratePerMon: 1200 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("section 1: other purchases line by line, paddy slips not repeated here", async () => {
    const d = await dailyPurchase(ctx.businessId, { date: "2026-10-10" });
    expect(d.other.map((l) => [l.product.slice(0, 3), l.quantity, l.rate, l.amount])).toEqual([["চাল", 10, 50, 500], ["তুষ", 4, 125, 480], ["চাল", 5, 52, 260]]);
    expect(d.other.some((l) => l.product.startsWith("ধান"))).toBe(false);
    expect(d.other[0].unit).toBe("কেজি");
    expect(d.other[1].discount).toBe(20);
    // বিবরণ = supplier (or নগদ ক্রয়), পণ্যের নাম = product, নোট = batch / narration
    expect(d.other.map((l) => l.party)).toEqual(["মেসার্স করিম ট্রেডার্স", "মেসার্স করিম ট্রেডার্স", "নগদ ক্রয়"]);
    expect(d.other.map((l) => l.product)).toEqual(await Promise.all([p.rice, p.husk, p.rice].map(async (id) => (await prisma.product.findUniqueOrThrow({ where: { id } })).name)));
    expect(d.other[0].note).toBe("সাপ্তাহিক মাল");
    expect(d.other[0].note).not.toContain("মেসার্স");
    expect(d.other[2].note).toBe("");
    expect(d.otherTotal).toBe(1_240);
    expect(d.otherDiscount).toBe(30);
    expect(d.otherNet).toBe(1_210);
  });

  it("section 2: paddy slips with bags, scales, dhalta, mon, rate and totals", async () => {
    const d = await dailyPurchase(ctx.businessId, { date: "2026-10-10" });
    expect(d.paddy.map((l) => [l.party, l.bagCount, l.grossKg, l.dhaltaKg, l.netKg, l.mon, l.ratePerMon, l.totalPrice])).toEqual([
      ["মেসার্স করিম ট্রেডার্স", 30, 1050, 13, 1037, 25.93, 1250, 32_412.5],
      ["নগদ ক্রয়", 8, 400, 0, 400, 10, 1200, 12_000],
    ]);
    expect(d.paddy[0].notes).toBe("ট্রাক ঢাকা মেট্রো-ট ১১-২২৩৩");
    const paddyName = (await prisma.product.findUniqueOrThrow({ where: { id: p.paddy } })).name;
    expect(d.paddy.map((l) => l.product)).toEqual([paddyName, paddyName]);
    expect(d.paddyTotals).toEqual({ bags: 38, grossKg: 1450, dhaltaKg: 13, netKg: 1437, mon: 35.93, total: 44_412.5 });
    expect(d.grandTotal).toBe(45_622.5);
  });

  it("another day / an empty day / a bad date", async () => {
    const next = await dailyPurchase(ctx.businessId, { date: "2026-10-11" });
    expect(next.other.map((l) => l.amount)).toEqual([50]);
    expect(next.paddyTotals).toMatchObject({ bags: 5, netKg: 200, mon: 5, total: 6_000 });
    const empty = await dailyPurchase(ctx.businessId, { date: "2026-10-01" });
    expect([empty.other.length, empty.paddy.length, empty.grandTotal]).toEqual([0, 0, 0]);
    expect((await dailyPurchase(ctx.businessId, { date: "10/10/2026" })).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("tenant isolation: another business sees nothing", async () => {
    const user = await prisma.user.create({ data: { name: "O", email: `dailybuy-o${Date.now()}@test.local`, passwordHash: "x" } });
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য", ownerUserId: user.id }));
    const d = await dailyPurchase(other.id, { date: "2026-10-10" });
    expect([d.other.length, d.paddy.length]).toEqual([0, 0]);
  });

  it("export (CSV) carries both sections and the totals; the report belongs to the purchase module", async () => {
    const report = await DAILY_PURCHASE_REPORT.run({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7 } } as never, { date: "2026-10-10" });
    const csv = toCsv(report);
    for (const s of ["অন্যান্য ক্রয়", "ধান ক্রয় রিপোর্ট", "1240.00", "1210.00", "32412.50", "44412.50", "45622.50", "মেসার্স করিম ট্রেডার্স", "1437"]) expect(csv).toContain(s);
    // the পণ্যের নাম column follows বিবরণ / পার্টির নাম, in both sections
    const keys = report.columns.map((c) => c.key);
    expect(keys.slice(0, 4)).toEqual(["no", "particulars", "product", "quantity"]);
    expect(report.columns[2].label).toBe("পণ্যের নাম");
    const rows = report.rows.filter((r) => r.cells.no);
    expect(rows.map((r) => String(r.cells.product).slice(0, 3))).toEqual(["চাল", "তুষ", "চাল", "ধান", "ধান"]);
    expect(rows.map((r) => r.cells.particulars)).toEqual([expect.stringContaining("মেসার্স করিম ট্রেডার্স (PUR-"), expect.stringContaining("মেসার্স করিম ট্রেডার্স (PUR-"), expect.stringContaining("নগদ ক্রয় (PUR-"), "মেসার্স করিম ট্রেডার্স", "নগদ ক্রয়"]);
    const xlsx = await toXlsx(report, "ক্রয় খাতা টেস্ট");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    const cells: string[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
    const header = cells.indexOf("নম্বর");
    expect(cells.slice(header, header + 4)).toEqual(["নম্বর", "বিবরণ / পার্টির নাম", "পণ্যের নাম", "পরিমাণ"]);
    expect(cells.filter((c) => c.startsWith("ধান")).length).toBeGreaterThanOrEqual(2);
    expect(featureForPath("/reports/daily-purchase")).toBe("PURCHASE");
    expect(featureForPath("/api/reports/daily-purchase")).toBe("PURCHASE");
  });
});
