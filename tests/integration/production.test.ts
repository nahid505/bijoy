// Production management (BOM) against a real database: a rice mill.
// Hand-worked figures:
//   purchase 1 000 kg paddy @ 30 = 30 000 (cash)
//   production: 1 000 kg paddy → 650 kg rice (88 %), 50 kg broken rice (5 %), 80 kg bran (5 %), 200 kg husk (2 %)
//               extra cost 2 000 (cash) → total 32 000 → rice 28 160 (43.3231/kg), broken 1 600 (32/kg),
//               bran 1 600 (20/kg), husk 640 (3.2/kg); ledger: Dr Inventory 2 000 / Cr Cash 2 000 only
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { productionSchema, type ProductionInput } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { deleteVoucher, saveTradeVoucher } from "@/server/services/voucher";
import { balancesBefore } from "@/server/services/ledger";
import { trialBalance } from "@/server/services/report";
import { createRiceMillTemplate, getRecipe, saveProduction, saveRecipe } from "@/server/services/production";
import { exportBusiness, restoreBackup, validateBackup } from "@/server/services/backup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("production management (rice mill)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let recipeId: string;
  let p: Record<"paddy" | "rice" | "broken" | "bran" | "husk", string>;
  let purchaseId: string;
  let productionId: string;
  let saleId: string;

  const product = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });
  const stock = async (id: string) => Number((await product(id)).stock);
  const avg = async (id: string) => Number((await product(id)).avgCost);
  const balance = async (accountId: string) => (await balancesBefore(ctx.businessId, undefined, [accountId])).get(accountId) ?? 0;
  const purchase = (rate: number, editId?: string) =>
    saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-09-01"), reference: null, narration: null, partyAccountId: null, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 1000 * rate, reference: null }],
      items: [{ productId: p.paddy, quantity: 1000, rate, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    }, editId);
  const production = (o: Partial<ProductionInput> = {}): ProductionInput => ({
    date: D("2026-09-05"), reference: "লট-১", narration: null, recipeId, batches: 10, warehouseId,
    inputs: [{ productId: p.paddy, quantity: 1000, batchNo: null }],
    outputs: [
      { productId: p.rice, quantity: 650, costShare: 88, batchNo: null, expiryDate: null },
      { productId: p.broken, quantity: 50, costShare: 5, batchNo: null, expiryDate: null },
      { productId: p.bran, quantity: 80, costShare: 5, batchNo: null, expiryDate: null },
      { productId: p.husk, quantity: 200, costShare: 2, batchNo: null, expiryDate: null },
    ],
    extraCost: 2000, costAccountId: acc.CASH, ...o,
  });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Mill", email: `mill${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "রাইস মিল টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rice-mill template: products in kg and the 100 kg paddy recipe (idempotent)", async () => {
    const t = await createRiceMillTemplate(ctx);
    expect(t.created).toBe(true);
    expect((await createRiceMillTemplate(ctx)).created).toBe(false);
    recipeId = t.recipeId;
    const r = (await getRecipe(ctx.businessId, recipeId))!;
    const byName = (n: string) => r.lines.find((l) => l.product.name.startsWith(n))!.productId;
    p = { paddy: byName("ধান"), rice: byName("চাল"), broken: byName("খুদ"), bran: byName("কুঁড়া"), husk: byName("তুষ") };
    expect(r.lines.map((l) => [l.kind, Number(l.quantity)])).toEqual([["INPUT", 100], ["OUTPUT", 65], ["OUTPUT", 5], ["OUTPUT", 8], ["OUTPUT", 20]]);
    expect(r.lines.every((l) => l.product.unit.name === "কেজি")).toBe(true);
  });

  it("production: paddy out, rice + by-products in, cost split by share, only the extra cost in the ledger", async () => {
    purchaseId = (await purchase(30)).id;
    const v = await saveProduction(ctx, production());
    productionId = v.id;
    expect(v.voucherNo).toMatch(/^PRD-/);
    expect(Number(v.amount)).toBe(32_000);
    expect(await stock(p.paddy)).toBe(0);
    expect([await stock(p.rice), await stock(p.broken), await stock(p.bran), await stock(p.husk)]).toEqual([650, 50, 80, 200]);
    expect(await avg(p.rice)).toBeCloseTo(43.3231, 4);
    expect([await avg(p.broken), await avg(p.bran), await avg(p.husk)]).toEqual([32, 20, 3.2]);
    const entries = await prisma.journalEntry.findMany({ where: { voucherId: v.id } });
    expect(entries.map((e) => [e.accountId, Number(e.debit), Number(e.credit)]).sort()).toEqual([[acc.CASH, 0, 2000], [acc.INVENTORY, 2000, 0]].sort());
    expect(await balance(acc.INVENTORY)).toBe(32_000); // 30 000 paddy bought + 2 000 milling cost
    expect(await balance(acc.CASH)).toBe(-32_000);
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
    const run = await prisma.productionRun.findUniqueOrThrow({ where: { voucherId: v.id } });
    expect([Number(run.batches), Number(run.extraCost), run.recipeId]).toEqual([10, 2000, recipeId]);
    const moves = await prisma.stockMovement.findMany({ where: { voucherId: v.id } });
    expect(moves.filter((m) => m.type === "PRODUCTION_OUT")).toHaveLength(1);
    expect(moves.filter((m) => m.type === "PRODUCTION_IN")).toHaveLength(4);
  });

  it("cannot consume more paddy than is in stock on that date; nothing is saved", async () => {
    const before = await prisma.voucher.count({ where: { businessId: ctx.businessId } });
    await expect(saveProduction(ctx, production({ date: D("2026-09-06"), inputs: [{ productId: p.paddy, quantity: 500, batchNo: null }] }))).rejects.toThrow(/পর্যাপ্ত স্টক নেই/);
    expect(await prisma.voucher.count({ where: { businessId: ctx.businessId } })).toBe(before);
    expect(await stock(p.paddy)).toBe(0);
  });

  it("a backdated purchase price change re-costs the production AND the later rice sale (cascade)", async () => {
    // sell 100 kg rice @ 60 → COGS 100 × 43.3231 = 4 332.31
    saleId = (await saveTradeVoucher(ctx, "SALES", {
      date: D("2026-09-10"), reference: null, narration: null, partyAccountId: null, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 6000, reference: null }],
      items: [{ productId: p.rice, quantity: 100, rate: 60, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    })).id;
    expect(await balance(acc.COGS)).toBeCloseTo(4332.31, 2);
    // paddy actually cost 32/kg → run 34 000 → rice 29 920 (46.0308/kg) → COGS 4 603.08
    await purchase(32, purchaseId);
    expect(await avg(p.rice)).toBeCloseTo(46.0308, 4);
    expect(Number((await prisma.voucher.findUniqueOrThrow({ where: { id: productionId } })).amount)).toBe(34_000);
    expect(await balance(acc.COGS)).toBeCloseTo(4603.08, 2);
    expect(await balance(acc.INVENTORY)).toBeCloseTo(34_000 - 4603.08, 2);
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
  });

  it("editing keeps the number and re-posts; deleting is refused while its products are sold, then restores stock", async () => {
    const edited = await saveProduction(ctx, production({ extraCost: 3000 }), productionId);
    expect(edited.id).toBe(productionId);
    const entries = await prisma.journalEntry.findMany({ where: { voucherId: productionId } });
    expect(entries.reduce((s, e) => s + Number(e.debit), 0)).toBe(3000);
    expect(Number(edited.amount)).toBe(35_000);
    // the rice sold on 10 Sep would have no stock without this production
    await expect(deleteVoucher(ctx, productionId)).rejects.toThrow(/পর্যাপ্ত স্টক নেই/);
    await deleteVoucher(ctx, saleId);
    await deleteVoucher(ctx, productionId);
    expect(await stock(p.paddy)).toBe(1000);
    expect([await stock(p.rice), await stock(p.husk)]).toEqual([0, 0]);
    expect(await prisma.productionRun.count({ where: { voucherId: productionId } })).toBe(0);
    expect(await balance(acc.INVENTORY)).toBe(32_000);
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
    productionId = (await saveProduction(ctx, production())).id; // again, for the backup test
  });

  it("validation: cost shares must total 100 %, a product cannot be both material and product, extra cost needs an account", () => {
    const base = { ...production(), date: "2026-09-05" };
    expect(productionSchema.safeParse({ ...base, outputs: base.outputs.map((o) => ({ ...o, costShare: 20 })) }).success).toBe(false);
    expect(productionSchema.safeParse({ ...base, outputs: [{ productId: p.paddy, quantity: 10, costShare: 100 }] }).success).toBe(false);
    expect(productionSchema.safeParse({ ...base, costAccountId: null }).success).toBe(false);
    expect(productionSchema.safeParse({ ...base, extraCost: 0, costAccountId: null }).success).toBe(true);
  });

  it("tenant isolation: another business cannot use this recipe or these products", async () => {
    const user = await prisma.user.create({ data: { name: "Other", email: `other${Date.now()}@test.local`, passwordHash: "x" } });
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য মিল", ownerUserId: user.id }));
    const ctx2: Ctx = { businessId: other.id, userId: user.id };
    const cash2 = (await prisma.$transaction((tx) => systemAccounts(tx, other.id))).CASH;
    await expect(saveProduction(ctx2, { ...production(), warehouseId: null, costAccountId: cash2 })).rejects.toThrow(/রেসিপি পাওয়া যায়নি/);
    await expect(saveProduction(ctx2, { ...production(), recipeId: null, warehouseId: null, costAccountId: cash2 })).rejects.toThrow(/পণ্য পাওয়া যায়নি/);
    await expect(saveRecipe(ctx2, { name: "চুরি", code: null, description: null, isActive: true, inputs: [{ productId: p.paddy, quantity: 1 }], outputs: [{ productId: p.rice, quantity: 1, costShare: 100 }] })).rejects.toThrow(/পণ্য পাওয়া যায়নি/);
    expect(await getRecipe(other.id, recipeId)).toBeNull();
  });

  it("backup v5 carries recipes and production entries; the restored copy has the same stock and costs", async () => {
    const file = await exportBusiness(ctx.businessId);
    expect(file.version).toBe(5);
    const report = validateBackup(file);
    expect(report.ok).toBe(true);
    expect(report.stats["production.recipes"]).toBe(1);
    expect(report.stats["production.runs"]).toBe(1);
    const restored = await restoreBackup(file, ctx.userId);
    const rp = await prisma.product.findFirstOrThrow({ where: { businessId: restored.businessId, name: "চাল" } });
    expect(Number(rp.stock)).toBe(650);
    expect(Number(rp.avgCost)).toBeCloseTo(await avg(p.rice), 4);
    expect(await prisma.recipe.count({ where: { businessId: restored.businessId } })).toBe(1);
    const rRun = await prisma.productionRun.findFirstOrThrow({ where: { businessId: restored.businessId } });
    expect(Number(rRun.extraCost)).toBe(2000);
    expect((await trialBalance(restored.businessId, {})).balanced).toBe(true);
  });
});
