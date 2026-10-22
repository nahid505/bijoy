// Depot management against a real database. Hand-worked figures (cement, unit বস্তা):
//   stock in:  1 000 bags from the company @ 450 on credit  → company payable 450 000, inventory 450 000
//   DO release (কোম্পানি পেইড): 300 bags to রহিম @ commission 10 → cost 135 000, commission 3 000
//              company ledger −135 000 (payable 315 000); commission receivable 3 000 / income 3 000; রহিম owes 0
//   market sale (ডিপো কালেকশন): 100 bags to করিম @ 480 = 48 000, collected 20 000 → করিম owes 28 000
//   stock 600 bags; settle commission: 1 000 adjusted with the company + 500 in cash → receivable 1 500
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { depotTotals } from "@/lib/depot";
import { commissionSettlementSchema, depotDeliverySchema, registrationSchema } from "@/lib/validation";
import { createBusiness, ensureDefaultRoles } from "@/server/services/bootstrap";
import { DEPOT_ROLE } from "@/lib/depot";
import { DEPOT_PERMISSIONS } from "@/lib/permissions";
import { strList } from "@/lib/dialect";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { deleteVoucher, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { profitAndLoss, trialBalance } from "@/server/services/report";
import { commissionSummary, depotDashboard, loadDepotDelivery, listDepotDeliveries, saveDepotDelivery, settleCommission } from "@/server/services/depot";
import { DEPOT_REPORTS } from "@/server/reports/depot";
import { exportBusiness, restoreBackup, validateBackup } from "@/server/services/backup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string, route: string | null = null) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0, route });

run("depot management (ডিপো ব্যবসা)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let cement: string;
  let company: { accountId: string };
  let rahim: { accountId: string };
  let karim: { accountId: string };
  let doId: string;
  let saleId: string;
  let purchaseId: string;

  // depot figures live in the depot book (src/lib/book.ts)
  const balance = async (accountId: string) => (await balancesBefore(ctx.businessId, undefined, [accountId], "DEPOT")).get(accountId) ?? 0;
  const stock = async () => Number((await prisma.product.findUniqueOrThrow({ where: { id: cement } })).stock);
  const receivableId = async () => (await prisma.account.findFirstOrThrow({ where: { businessId: ctx.businessId, systemKey: `DEPOT_COMMISSION_RECEIVABLE:${company.accountId}` } })).id;
  const delivery = (o: Record<string, unknown>) =>
    depotDeliverySchema.parse({ date: "2026-10-10", reference: null, narration: null, warehouseId, doNumber: "DO-7781", vehicleNo: "ঢাকা মেট্রো-ট ১১-২২৩৩", driverName: "সেলিম", notes: null, paidAmount: 0, cashAccountId: "", ...o });
  const purchase = (rate: number, editId?: string) =>
    saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-09"), reference: null, narration: "কোম্পানি থেকে স্টক ইন", partyAccountId: company.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [],
      items: [{ productId: cement, quantity: 1000, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    }, editId, "DEPOT");

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Depot", email: `depot${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "বীরগঞ্জ সিমেন্ট ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    const pcs = await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } });
    cement = (await prisma.product.create({ data: { businessId: ctx.businessId, isDepotProduct: true, name: "সিমেন্ট (৫০ কেজি বস্তা)", unitId: pcs.id, salePrice: 480, depotCommissionRate: 10 } })).id;
    company = await saveParty(ctx, "SUPPLIER", party("এসিআই সিমেন্ট লিমিটেড"));
    rahim = await saveParty(ctx, "CUSTOMER", party("রহিম ট্রেডার্স", "রুট-১ বীরগঞ্জ"), undefined, { dealer: true });
    karim = await saveParty(ctx, "CUSTOMER", party("করিম স্টোর", "রুট-২ কাহারোল"), undefined, { dealer: true });
    purchaseId = (await purchase(450)).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registration accepts 'depot' (any case) as the DEPOT business type", () => {
    const base = { businessName: "ডিপো", ownerName: "মালিক", mobile: "01712345678", password: "Dokan-2026x", confirmPassword: "Dokan-2026x" };
    for (const v of ["DEPOT", "depot", " Depot "]) expect(registrationSchema.parse({ ...base, businessType: v }).businessType).toBe("DEPOT");
  });

  it("company-paid DO release: stock out at cost against the company, commission receivable, no dealer due", async () => {
    expect(depotTotals([{ quantity: 300, rate: 10 }]).total).toBe(3_000);
    const v = await saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: rahim.accountId, lines: [{ productId: cement, quantity: 300, rate: 10 }] }));
    doId = v.id;
    expect(v.type).toBe("DEPOT_DELIVERY");
    expect(v.voucherNo).toMatch(/^DO-/);
    expect(await stock()).toBe(700);
    expect(await balance(company.accountId)).toBe(-315_000); // payable 450 000 − 135 000
    expect(await balance(acc.INVENTORY)).toBe(315_000);
    expect(await balance(await receivableId())).toBe(3_000);
    expect(await balance(rahim.accountId)).toBe(0);
    const income = await prisma.account.findFirstOrThrow({ where: { businessId: ctx.businessId, systemKey: "DEPOT_COMMISSION_INCOME" } });
    expect(await balance(income.id)).toBe(-3_000);
    const pl = await profitAndLoss(ctx.businessId, {}, "DEPOT");
    expect(pl.netProfit).toBe(3_000);
    const d = (await loadDepotDelivery(ctx.businessId, doId))!;
    expect(d).toMatchObject({ mode: "COMPANY_PAID", doNumber: "DO-7781", vehicleNo: "ঢাকা মেট্রো-ট ১১-২২৩৩", driverName: "সেলিম" });
    expect(Number(d.commissionTotal)).toBe(3_000);
    expect(d.dealerAccount?.customer?.route).toBe("রুট-১ বীরগঞ্জ");
    // the dealer challan rate defaults to the latest purchase price (450 from the stock-in); commission stays the line rate
    expect([Number(d.voucher.items[0].challanRate), Number(d.voucher.items[0].rate)]).toEqual([450, 10]);
  });

  it("depot collection (market sale): a sale to the dealer — collected cash and market due", async () => {
    const cashBefore = await balance(acc.CASH);
    const v = await saveDepotDelivery(ctx, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: karim.accountId, paidAmount: 20_000, cashAccountId: acc.CASH, lines: [{ productId: cement, quantity: 100, rate: 480 }] }));
    saleId = v.id;
    expect(v.type).toBe("SALES");
    expect(Number(v.amount)).toBe(48_000);
    expect(await stock()).toBe(600);
    expect(await balance(karim.accountId)).toBe(28_000);
    expect(await balance(acc.CASH)).toBe(cashBefore + 20_000);
    const sale = (await loadDepotDelivery(ctx.businessId, saleId))!;
    expect(Number(sale.commissionTotal)).toBe(0);
    expect(Number(sale.voucher.items[0].challanRate)).toBe(480); // a market sale prints its own sale rate
    expect((await trialBalance(ctx.businessId, {}, "DEPOT")).balanced).toBe(true);
  });

  it("commission settlement: adjusted against the company or received in cash; never more than due", async () => {
    const settle = (o: Record<string, unknown>) => settleCommission(ctx, commissionSettlementSchema.parse({ date: "2026-10-11", companyAccountId: company.accountId, reference: null, cashAccountId: "", ...o }));
    await settle({ amount: 1_000, method: "ADJUST" });
    expect(await balance(company.accountId)).toBe(-314_000);
    await settle({ amount: 500, method: "CASH", cashAccountId: acc.CASH });
    expect(await balance(await receivableId())).toBe(1_500);
    await expect(settle({ amount: 5_000, method: "CASH", cashAccountId: acc.CASH })).rejects.toBeInstanceOf(UserError);
    const s = await commissionSummary(ctx.businessId);
    expect(s.rows).toEqual([expect.objectContaining({ company: "এসিআই সিমেন্ট লিমিটেড", deliveries: 1, earned: 3_000, settled: 1_500, outstanding: 1_500 })]);
    expect(s.outstanding).toBe(1_500);
  });

  it("dashboard cards: today's deliveries, commission receivable, market due, stock value", async () => {
    const d = await depotDashboard(ctx.businessId, "2026-10-10");
    expect(d.today).toMatchObject({ count: 2, doCount: 1, marketCount: 1, quantity: 400, marketValue: 48_000, commission: 3_000 });
    expect(d.commissionReceivable).toBe(1_500);
    expect(d.marketDue).toBe(28_000);
    expect(d.dealersWithDue).toBe(1);
    expect(d.stockValue).toBe(270_000); // 600 × 450
  });

  it("edit: quantity changed, same number; the mode cannot change; an entered challan rate is kept", async () => {
    const v = await saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: rahim.accountId, lines: [{ productId: cement, quantity: 200, rate: 10, challanRate: 455 }] }), doId);
    expect(Number((await prisma.voucherItem.findFirstOrThrow({ where: { voucherId: doId } })).challanRate)).toBe(455);
    expect(v.id).toBe(doId);
    expect(await stock()).toBe(700);
    expect(await balance(await receivableId())).toBe(500); // 2 000 − 1 500 settled
    await expect(saveDepotDelivery(ctx, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: rahim.accountId, cashAccountId: acc.CASH, lines: [{ productId: cement, quantity: 1, rate: 480 }] }), doId)).rejects.toThrow(/ধরন পরিবর্তন/);
  });

  it("a backdated cost change re-costs the DO release; the books stay balanced", async () => {
    await purchase(460, purchaseId);
    expect(await balance(company.accountId)).toBe(-(460_000 - 200 * 460 - 1_000)); // 367 000
    expect(Number((await prisma.voucherItem.findFirstOrThrow({ where: { voucherId: doId } })).costAmount)).toBe(92_000);
    expect((await trialBalance(ctx.businessId, {}, "DEPOT")).balanced).toBe(true);
  });

  it("refuses: too much stock, a non-dealer / foreign party, a non-depot business", async () => {
    await expect(saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: rahim.accountId, lines: [{ productId: cement, quantity: 5_000, rate: 10 }] }))).rejects.toThrow(/পর্যাপ্ত স্টক নেই/);
    await expect(saveDepotDelivery(ctx, delivery({ mode: "COMPANY_PAID", companyAccountId: rahim.accountId, dealerAccountId: rahim.accountId, lines: [{ productId: cement, quantity: 1, rate: 10 }] }))).rejects.toThrow(/কোম্পানি পাওয়া যায়নি/);
    const user = await prisma.user.create({ data: { name: "O", email: `depot-o${Date.now()}@test.local`, passwordHash: "x" } });
    const shop = await prisma.$transaction((tx) => createBusiness(tx, { name: "সাধারণ দোকান", ownerUserId: user.id, businessType: "RETAIL" }));
    await expect(saveDepotDelivery({ businessId: shop.id, userId: user.id }, delivery({ mode: "DEPOT_COLLECTION", dealerAccountId: "", cashAccountId: acc.CASH, lines: [{ productId: cement, quantity: 1, rate: 480 }] }))).rejects.toThrow(/শুধু ডিপো ব্যবসার জন্য/);
    expect(await stock()).toBe(700);
  });

  it("validation: a DO release needs company and dealer; a market sale needs a rate and a cash account for cash sales", () => {
    const issues = (o: Record<string, unknown>) => {
      const r = depotDeliverySchema.safeParse({ date: "2026-10-10", lines: [{ productId: "p", quantity: 1, rate: 0 }], ...o });
      return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    };
    expect(issues({ mode: "COMPANY_PAID" })).toEqual(expect.arrayContaining(["companyAccountId", "dealerAccountId"]));
    expect(issues({ mode: "DEPOT_COLLECTION", dealerAccountId: "d" })).toContain("lines.0.rate");
    expect(issues({ mode: "DEPOT_COLLECTION", lines: [{ productId: "p", quantity: 1, rate: 5 }] })).toContain("cashAccountId");
    expect(issues({ mode: "COMPANY_PAID", companyAccountId: "c", dealerAccountId: "d" })).toEqual([]); // commission 0 is allowed
  });

  it("reports: delivery register, market dues by route, company commission", async () => {
    const fake = { business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "DEPOT" }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } } as never;
    const run = (slug: string, p: Record<string, string>) => DEPOT_REPORTS.find((r) => r.slug === slug)!.run(fake, p);
    const reg = await run("depot-deliveries", { from: "2026-10-01", to: "2026-10-31" });
    const total = reg.rows.at(-1)!.cells;
    expect([total.quantity, total.sale, total.commission]).toEqual([300, 139_000, 2_000]); // sale value = DO 200 × 455 (challan rate) + market 100 × 480
    expect(reg.rows.filter((r) => r.kind !== "total").map((r) => r.cells.sale)).toEqual([91_000, 48_000]);
    expect(reg.summary?.find((x) => x.label === "মোট বিক্রয় মূল্য")?.value).toContain("১,৩৯,০০০");
    // the list page: mode filter, all dates, totals over the whole filter (not just the page)
    const all = await run("depot-deliveries", { all: "1", mode: "DEPOT_COLLECTION" });
    expect(all.rows.filter((r) => r.kind !== "total").map((r) => r.cells.mode)).toEqual(["মার্কেট সেলস"]);
    const list = await listDepotDeliveries(ctx.businessId, { take: 1 });
    expect(list.rows).toHaveLength(1);
    expect(list.totals).toEqual({ saleValue: 139_000, commission: 2_000, doCount: 1, marketCount: 1 });
    expect(reg.rows.filter((r) => r.cells.mode === "ডিও রিলিজ").map((r) => r.cells.route)).toEqual(["রুট-১ বীরগঞ্জ"]);
    const dues = await run("depot-market-dues", { asOf: "2026-10-31" });
    expect(dues.rows.map((r) => [r.kind ?? "row", r.cells.dealer, r.cells.due])).toEqual([["group", "রুট-২ কাহারোল", 28_000], ["row", "করিম স্টোর", 28_000], ["total", "সর্বমোট মার্কেট বাকি", 28_000]]);
    const com = await run("depot-commission", { from: "2026-10-01", to: "2026-10-31" });
    expect(com.rows[0].cells).toMatchObject({ company: "এসিআই সিমেন্ট লিমিটেড", earned: 2_000, settled: 1_500, outstanding: 500 });
    // a non-depot business sees an explanation, not data
    const other = await DEPOT_REPORTS[0].run({ ...(fake as object), business: { ...(fake as { business: object }).business, businessType: "RETAIL" } } as never, {});
    expect(other.rows).toHaveLength(0);
    expect(other.emptyMessage).toContain("শুধু ডিপো ব্যবসার জন্য");
  });

  it("roles: a depot business gets the depot-only role; other businesses do not; ensureDefaultRoles adds it", async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { businessId: ctx.businessId, name: DEPOT_ROLE.name } });
    expect(strList(role.permissions)).toEqual(DEPOT_PERMISSIONS);
    expect(role.isSystem).toBe(false);
    const user = await prisma.user.create({ data: { name: "R", email: `depot-r${Date.now()}@test.local`, passwordHash: "x" } });
    const shop = await prisma.$transaction((tx) => createBusiness(tx, { name: "মুদি দোকান", ownerUserId: user.id, businessType: "RETAIL" }));
    expect(await prisma.role.count({ where: { businessId: shop.id, name: DEPOT_ROLE.name } })).toBe(0);
    // an existing business switched to depot: the seeder (ensureDefaultRoles) adds the role once
    await prisma.business.update({ where: { id: shop.id }, data: { businessType: "DEPOT" } });
    expect(await prisma.$transaction((tx) => ensureDefaultRoles(tx, shop.id))).toBe(1);
    expect(await prisma.$transaction((tx) => ensureDefaultRoles(tx, shop.id))).toBe(0);
    expect(await prisma.role.count({ where: { businessId: shop.id, name: DEPOT_ROLE.name } })).toBe(1);
  });

  it("backup: challans, business type, commission rate, dealer route and the commission ledger survive a restore", async () => {
    const file = await exportBusiness(ctx.businessId);
    expect(validateBackup(file).ok).toBe(true);
    expect(validateBackup(file).stats.depotDeliveries).toBe(2);
    const restored = await restoreBackup(file, ctx.userId);
    const rb = restored.businessId;
    expect((await prisma.business.findUniqueOrThrow({ where: { id: rb } })).businessType).toBe("DEPOT");
    expect(await prisma.depotDelivery.count({ where: { businessId: rb } })).toBe(2);
    expect(Number((await prisma.product.findFirstOrThrow({ where: { businessId: rb } })).depotCommissionRate)).toBe(10);
    expect((await prisma.customer.findFirstOrThrow({ where: { businessId: rb, name: "রহিম ট্রেডার্স" } })).route).toBe("রুট-১ বীরগঞ্জ");
    const newCompany = (await prisma.supplier.findFirstOrThrow({ where: { businessId: rb } })).accountId;
    const recv = await prisma.account.findFirstOrThrow({ where: { businessId: rb, systemKey: `DEPOT_COMMISSION_RECEIVABLE:${newCompany}` } });
    expect((await balancesBefore(rb, undefined, [recv.id], "DEPOT")).get(recv.id)).toBe(500);
    expect((await trialBalance(rb, {}, "ALL")).balanced).toBe(true);
  });

  it("delete: the DO release and its challan are removed, stock comes back", async () => {
    await deleteVoucher(ctx, doId);
    expect(await prisma.depotDelivery.count({ where: { voucherId: doId } })).toBe(0);
    expect(await stock()).toBe(900);
    expect(await balance(await receivableId())).toBe(-1_500); // settled more than now earned — visible to the user
    expect((await trialBalance(ctx.businessId, {}, "DEPOT")).balanced).toBe(true);
  });
});
