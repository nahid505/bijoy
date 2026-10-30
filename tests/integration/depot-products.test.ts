// Depot (dealership) products: the isDepotProduct flag keeps them out of the general sales / POS / stock and keeps
// general products out of the depot vouchers; commission per unit (fixed or % of DP); the backfill migration.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isMySql } from "@/lib/dialect";
import { commissionPerUnit } from "@/lib/depot";
import { depotDeliverySchema, productSchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveStockJournal, saveTradeVoucher } from "@/server/services/voucher";
import { saveDepotDelivery } from "@/server/services/depot";
import { saveProduction } from "@/server/services/production";
import { searchProducts } from "@/server/lookup";
import { inventoryOptions } from "@/server/voucher-editor";
import { REPORTS } from "@/server/reports/definitions";
import { listBatches } from "@/server/services/expiry";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

run("depot products (ডিপো পণ্য তালিকা)", () => {
  let ctx: Ctx;
  let unitId: string;
  let warehouseId: string;
  let company: { accountId: string };
  let dealer: { accountId: string };
  let cement: string; // depot product, 2.5% of DP
  let rod: string; // depot product, ৳ 15 per unit
  let rice: string; // general product
  const product = (o: Record<string, unknown>) =>
    productSchema.parse({ name: "x", code: "", barcode: "", categoryId: "", brandId: "", unitId, purchasePrice: 0, salePrice: 0, wholesalePrice: 0, minStock: 0, openingStock: 0, openingRate: 0, trackBatch: false, ...o });
  const line = (productId: string, quantity: number, rate: number) => ({ productId, quantity, freeQuantity: 0, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null });
  const trade = (type: "PURCHASE" | "SALES", items: ReturnType<typeof line>[], book: "GENERAL" | "DEPOT", partyAccountId: string | null) =>
    saveTradeVoucher(ctx, type, { date: D("2026-10-10"), reference: null, narration: null, partyAccountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items } as never, undefined, book);
  const adjust = (productId: string, book: "GENERAL" | "DEPOT", editId?: string) =>
    saveStockJournal(ctx, { date: D("2026-10-11"), reference: null, narration: null, lines: [{ productId, warehouseId, direction: -1, quantity: 1, rate: null, batchNo: null, expiryDate: null, mfgDate: null }] } as never, editId, book);
  const delivery = (productId: string) =>
    depotDeliverySchema.parse({ date: "2026-10-12", reference: null, narration: null, warehouseId, doNumber: null, vehicleNo: null, driverName: null, notes: null, paidAmount: 0, cashAccountId: "", mode: "COMPANY_PAID", companyAccountId: company.accountId, dealerAccountId: dealer.accountId, lines: [{ productId, quantity: 10, freeQuantity: 0, rate: 5 }] });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "DP", email: `dprod${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "পণ্য ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
    unitId = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "পিস" } })).id;
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    company = await saveParty(ctx, "SUPPLIER", party("আকিজ"));
    dealer = await saveParty(ctx, "CUSTOMER", party("করিম ডিলার"), undefined, { dealer: true });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a depot product: flag, company / brand created from the typed name, % commission of the DP", async () => {
    cement = await saveProduct(ctx, product({ name: "সিমেন্ট", code: "C-1", purchasePrice: 450, salePrice: 470, depotCommissionType: "PERCENT", depotCommissionRate: 2.5, newBrandName: "আকিজ সিমেন্ট", isDepotProduct: true }));
    rod = await saveProduct(ctx, product({ name: "রড", code: "R-1", purchasePrice: 900, salePrice: 920, depotCommissionType: "FIXED", depotCommissionRate: 15, newBrandName: "আকিজ সিমেন্ট", isDepotProduct: true }));
    rice = await saveProduct(ctx, product({ name: "চাল", code: "G-1", purchasePrice: 60, salePrice: 70 }));
    const c = await prisma.product.findUniqueOrThrow({ where: { id: cement }, include: { brand: true } });
    const r = await prisma.product.findUniqueOrThrow({ where: { id: rod } });
    expect([c.isDepotProduct, c.depotCommissionType, c.brand?.name, r.brandId]).toEqual([true, "PERCENT", "আকিজ সিমেন্ট", c.brandId]); // one brand, reused
    expect((await prisma.product.findUniqueOrThrow({ where: { id: rice } })).isDepotProduct).toBe(false);
    expect(commissionPerUnit({ depotCommissionType: "PERCENT", depotCommissionRate: 2.5, purchasePrice: 450 })).toBe(11.25);
    expect(() => product({ depotCommissionType: "PERCENT", depotCommissionRate: 120 })).toThrow(/১০০/);
  });

  it("a product group typed in the depot form is created once and reused (any case)", async () => {
    const a = await saveProduct(ctx, product({ name: "ক্রিম বিস্কুট", code: "B-1", purchasePrice: 20, newCategoryName: "Biscuit", isDepotProduct: true }));
    const b = await saveProduct(ctx, product({ name: "সল্ট বিস্কুট", code: "B-2", purchasePrice: 18, newCategoryName: "biscuit", isDepotProduct: true }));
    const [pa, pb] = await Promise.all([a, b].map((id) => prisma.product.findUniqueOrThrow({ where: { id }, include: { category: true } })));
    expect([pa.category?.name, pb.categoryId]).toEqual(["Biscuit", pa.categoryId]);
    expect(await prisma.category.count({ where: { businessId: ctx.businessId } })).toBe(1);
    // a group picked from the list wins over a typed name
    const c = await saveProduct(ctx, product({ name: "কেক", code: "K-1", purchasePrice: 30, categoryId: pa.categoryId, newCategoryName: "কেক", isDepotProduct: true }));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: c } })).categoryId).toBe(pa.categoryId);
    // out of the way of the picker / report checks below (no transactions yet)
    await prisma.product.deleteMany({ where: { id: { in: [a, b, c] } } });
    await prisma.category.deleteMany({ where: { businessId: ctx.businessId } });
  });

  it("pickers: depot forms see only depot products (commission per unit), general forms and the POS never", async () => {
    const depotHits = await searchProducts(ctx.businessId, "", { book: "DEPOT" });
    expect(depotHits.map((p) => p.name).sort()).toEqual(["রড", "সিমেন্ট"]);
    expect(depotHits.find((p) => p.id === cement)?.depotCommissionRate).toBe(11.25);
    expect(depotHits.find((p) => p.id === rod)?.depotCommissionRate).toBe(15);
    expect((await searchProducts(ctx.businessId, "")).map((p) => p.name)).toEqual(["চাল"]);
    expect((await searchProducts(ctx.businessId, "সিমেন্ট")).length).toBe(0);
    expect((await searchProducts(ctx.businessId, "", { ids: [cement] })).length).toBe(1); // a known line still loads
    expect((await inventoryOptions(ctx.businessId)).products.map((p) => p.name)).toEqual(["চাল"]);
  });

  it("depot vouchers take depot products only; general vouchers (sale, purchase, stock, production) general only", async () => {
    await trade("PURCHASE", [line(cement, 100, 450)], "DEPOT", company.accountId);
    await expect(trade("PURCHASE", [line(rice, 10, 60)], "DEPOT", company.accountId)).rejects.toThrow(/ডিপো পণ্য নয়/);
    await expect(trade("PURCHASE", [line(cement, 10, 450)], "GENERAL", company.accountId)).rejects.toThrow(/ডিপো পণ্য — সাধারণ/);
    await expect(trade("SALES", [line(cement, 1, 470)], "GENERAL", null)).rejects.toThrow(/ডিপো পণ্য — সাধারণ/); // POS / cash sale
    await trade("PURCHASE", [line(rice, 10, 60)], "GENERAL", company.accountId);
    await expect(adjust(cement, "GENERAL")).rejects.toThrow(/ডিপো পণ্য/);
    await expect(adjust(rice, "DEPOT")).rejects.toThrow(/ডিপো পণ্য নয়/);
    await adjust(cement, "DEPOT");
    await expect(saveDepotDelivery(ctx, delivery(rice))).rejects.toThrow(/ডিপো পণ্য নয়/);
    await saveDepotDelivery(ctx, delivery(cement));
    await expect(
      saveProduction(ctx, { date: D("2026-10-12"), reference: null, narration: null, recipeId: null, batches: 1, warehouseId, extraCost: 0, costAccountId: null, inputs: [{ productId: cement, quantity: 1, batchNo: null }], outputs: [{ productId: rice, quantity: 1, costShare: 100, batchNo: null, expiryDate: null }] } as never),
    ).rejects.toThrow(/ডিপো পণ্য/);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: cement } })).stock)).toBe(100 - 1 - 10);
  });

  it("the general stock report leaves depot products out", async () => {
    const r = await REPORTS.find((x) => x.slug === "stock")!.run({ business: { id: ctx.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: "DEPOT" }, partyScope: { customers: null, suppliers: null }, user: { id: ctx.userId } } as never, { from: "2026-07-01", to: "2026-10-31" });
    const text = JSON.stringify(r.rows);
    expect(text).toContain("চাল");
    expect(text).not.toContain("সিমেন্ট");
  });

  it("the batch / expiry list leaves depot products out", async () => {
    const pill = await saveProduct(ctx, product({ name: "ডিপো ওষুধ", code: "M-1", purchasePrice: 10, minStock: 5, trackBatch: true, isDepotProduct: true }));
    const tab = await saveProduct(ctx, product({ name: "সাধারণ ওষুধ", code: "M-2", purchasePrice: 10, minStock: 5, trackBatch: true }));
    const batchLine = (productId: string) => ({ ...line(productId, 2, 10), batchNo: "B-1", expiryDate: D("2027-01-31") });
    await trade("PURCHASE", [batchLine(pill) as never], "DEPOT", company.accountId);
    await trade("PURCHASE", [batchLine(tab) as never], "GENERAL", company.accountId);
    const today = D("2026-10-25");
    expect((await listBatches(ctx.businessId, today)).map((b) => b.productName)).toEqual(["সাধারণ ওষুধ"]);
    expect((await listBatches(ctx.businessId, today, { depot: true })).map((b) => b.productName)).toEqual(["ডিপো ওষুধ"]);
  });

  it("a product with transactions keeps its kind; an unused one may move, its opening stock moving book with it", async () => {
    await expect(saveProduct(ctx, product({ name: "সিমেন্ট", code: "C-1", purchasePrice: 450, isDepotProduct: false }), cement)).rejects.toThrow(/লেনদেন হওয়া ডিপো পণ্য/);
    await expect(saveProduct(ctx, product({ name: "চাল", code: "G-1", purchasePrice: 60, isDepotProduct: true }), rice)).rejects.toThrow(/লেনদেন হওয়া সাধারণ পণ্য/);
    const tile = await saveProduct(ctx, product({ name: "টাইলস", code: "T-1", purchasePrice: 50, openingStock: 20, openingRate: 50 }));
    const opening = () => prisma.voucher.findFirstOrThrow({ where: { businessId: ctx.businessId, sourceKey: `opening:product:${tile}` }, include: { entries: true } });
    expect((await opening()).book).toBe("GENERAL");
    await saveProduct(ctx, product({ name: "টাইলস", code: "T-1", purchasePrice: 50, openingStock: 20, openingRate: 50, isDepotProduct: true }), tile);
    const o = await opening();
    expect([o.book, o.voucherNo.startsWith("DOB-"), o.entries.every((e) => e.book === "DEPOT"), Number(o.amount)]).toEqual(["DEPOT", true, true, 1000]);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: tile } })).stock)).toBe(20);
    // edits keep their old lines: an existing depot adjustment can be saved again
    const adj = await prisma.voucher.findFirstOrThrow({ where: { businessId: ctx.businessId, type: "STOCK_JOURNAL", book: "DEPOT" } });
    await adjust(cement, "DEPOT", adj.id);
  });
});

run("depot products — backfill migration", () => {
  it("marks products only the depot used (or with a DO commission); products used by both stay general", async () => {
    const user = await prisma.user.create({ data: { name: "BF", email: `bf${Date.now()}@test.local`, passwordHash: "x" } });
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "ব্যাকফিল ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    const ctx = { businessId: b.id, userId: user.id };
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { businessId: b.id, name: "পিস" } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: b.id } })).id;
    const company = await saveParty(ctx, "SUPPLIER", party("কোম্পানি"));
    const mk = (name: string, o: Record<string, unknown> = {}) => prisma.product.create({ data: { businessId: b.id, name, unitId, ...o } }).then((p) => p.id);
    const buy = (productId: string, book: "GENERAL" | "DEPOT") =>
      saveTradeVoucher(ctx, "PURCHASE", { date: D("2026-10-10"), reference: null, narration: null, partyAccountId: company.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [{ productId, quantity: 5, freeQuantity: 0, rate: 10, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }] } as never, undefined, book);
    // history as it was before the flag existed: build it with the flag set, then clear the flag
    const depotOnly = await mk("শুধু ডিপো", { isDepotProduct: true });
    await buy(depotOnly, "DEPOT");
    const both = await mk("দুই খাতা");
    await buy(both, "GENERAL");
    await prisma.product.update({ where: { id: both }, data: { isDepotProduct: true } });
    await buy(both, "DEPOT");
    const commission = await mk("কমিশন আছে", { depotCommissionRate: 10 });
    const unused = await mk("অব্যবহৃত");
    await prisma.product.updateMany({ where: { businessId: b.id }, data: { isDepotProduct: false } });
    const sql = readFileSync(join(process.cwd(), "prisma", ...(isMySql() ? ["mysql"] : []), "migrations", "20261022000000_depot_products", "migration.sql"), "utf8");
    const updates = sql.split(/;\s*\n/).map((s) => s.replace(/^(\s*--.*\n)+/gm, "").trim()).filter((s) => s.startsWith("UPDATE") && !/Role/.test(s.slice(0, 20)));
    for (let pass = 0; pass < 2; pass++) for (const u of updates) await prisma.$executeRawUnsafe(u);
    const flag = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).isDepotProduct;
    expect([await flag(depotOnly), await flag(both), await flag(commission), await flag(unused)]).toEqual([true, false, true, false]);
  });
});
