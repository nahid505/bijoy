// Production management (BOM / recipes): raw materials → finished products and by-products.
//
// A production entry is a PRODUCTION voucher in ONE transaction:
//   materials out (PRODUCTION_OUT, costed at moving average by the replay)
//   products in   (PRODUCTION_IN, cost = (materials + extra cost) × cost share ÷ quantity)
//   ledger        Dr Inventory / Cr cost account for the extra cost only (materials and products are both
//                 inventory; the normal process loss is absorbed by the products made)
// Backdated purchases or edits that change a material's cost re-split the run's cost automatically
// (posting.ts → recostProduction), and stock can never go negative at any date.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { RICE_MILL_TEMPLATE } from "@/lib/production";
import { round2, round3, round4 } from "@/lib/calc";
import type { ProductionInput, RecipeInput } from "@/lib/validation";
import { assertAccounts, assertNotLocked, nextVoucherNo, type Ctx } from "./accounting";
import { allocateSaleBatches, ensureInboundBatch } from "./batches";
import { defaultWarehouseId, lockProducts, writeMovements, type MovementInput } from "./inventory";
import { recostProduction, repostVoucher, revalueProducts } from "./posting";
import { assertWarehouse, clearPostings, loadEditable, TX_OPTIONS } from "./voucher";

// ───────────────────────── recipes ─────────────────────────

export async function saveRecipe(ctx: Ctx, input: RecipeInput, id?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const ids = [...input.inputs, ...input.outputs].map((l) => l.productId);
      const found = await tx.product.count({ where: { id: { in: ids }, businessId: ctx.businessId } });
      if (found !== new Set(ids).size) throw new UserError("একটি পণ্য পাওয়া যায়নি");
      const data = { name: input.name, code: input.code, description: input.description, isActive: input.isActive };
      let recipeId = id;
      if (id) {
        const existing = await tx.recipe.findFirst({ where: { id, businessId: ctx.businessId } });
        if (!existing) throw new UserError("রেসিপি পাওয়া যায়নি");
        await tx.recipe.update({ where: { id }, data });
        await tx.recipeLine.deleteMany({ where: { recipeId: id } });
      } else {
        recipeId = (await tx.recipe.create({ data: { ...data, businessId: ctx.businessId } })).id;
      }
      await tx.recipeLine.createMany({
        data: [
          ...input.inputs.map((l, i) => ({ recipeId: recipeId!, productId: l.productId, kind: "INPUT" as const, quantity: l.quantity, costShare: 0, lineNo: i })),
          ...input.outputs.map((l, i) => ({ recipeId: recipeId!, productId: l.productId, kind: "OUTPUT" as const, quantity: l.quantity, costShare: l.costShare, lineNo: i })),
        ],
      });
      return tx.recipe.findUniqueOrThrow({ where: { id: recipeId } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError("এই নামে আগেই একটি রেসিপি আছে", { name: ["এই নামে আগেই একটি রেসিপি আছে"] });
    throw e;
  }
}

/** Deleting a recipe keeps every production entry made with it (they only lose the link). */
export async function deleteRecipe(ctx: Ctx, id: string) {
  const r = await prisma.recipe.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!r) throw new UserError("রেসিপি পাওয়া যায়নি");
  await prisma.recipe.delete({ where: { id } });
  return r;
}

const lineProduct = { select: { id: true, name: true, code: true, barcode: true, unitId: true, unit: { select: { name: true } }, avgCost: true, purchasePrice: true, salePrice: true, wholesalePrice: true, stock: true, trackBatch: true } } as const;

type LineProduct = Prisma.ProductGetPayload<typeof lineProduct>;
/** A product in the shape of the product picker (ProductOption). */
export function toProductOption(p: LineProduct) {
  return { id: p.id, name: p.name, code: p.code, barcode: p.barcode, unitId: p.unitId, salePrice: num(p.salePrice), wholesalePrice: num(p.wholesalePrice), purchasePrice: num(p.purchasePrice), avgCost: num(p.avgCost), stock: num(p.stock), trackBatch: p.trackBatch };
}

/** Units, warehouses and recipes for the production forms. */
export async function productionFormData(businessId: string) {
  const [units, warehouses, recipes] = await Promise.all([
    prisma.unit.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    listRecipes(businessId, { activeOnly: true }),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, name: u.name, baseUnitId: u.baseUnitId, factor: num(u.factor) })),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    recipes: recipes.map(recipeData),
  };
}

export function recipeData(r: Prisma.RecipeGetPayload<{ include: { lines: { include: { product: typeof lineProduct } } } }>) {
  const line = (l: (typeof r.lines)[number]) => ({ product: toProductOption(l.product), quantity: num(l.quantity), costShare: num(l.costShare) });
  return {
    id: r.id, name: r.name, code: r.code, description: r.description, isActive: r.isActive,
    inputs: r.lines.filter((l) => l.kind === "INPUT").map(line),
    outputs: r.lines.filter((l) => l.kind === "OUTPUT").map(line),
  };
}

export async function getRecipe(businessId: string, id: string) {
  return prisma.recipe.findFirst({ where: { id, businessId }, include: { lines: { orderBy: [{ kind: "asc" }, { lineNo: "asc" }], include: { product: lineProduct } } } });
}

export async function listRecipes(businessId: string, opts: { activeOnly?: boolean } = {}) {
  return prisma.recipe.findMany({
    where: { businessId, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: { name: "asc" },
    include: { lines: { orderBy: [{ kind: "asc" }, { lineNo: "asc" }], include: { product: lineProduct } }, _count: { select: { runs: true } } },
  });
}

// ───────────────────────── production entries ─────────────────────────

/** Creates or edits (reverse & repost, same number) a production entry. */
export async function saveProduction(ctx: Ctx, input: ProductionInput, editId?: string) {
  return prisma.$transaction(async (tx) => {
    const existing = editId ? await loadEditable(tx, ctx, editId, "PRODUCTION") : null;
    await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
    if (input.recipeId && !(await tx.recipe.findFirst({ where: { id: input.recipeId, businessId: ctx.businessId }, select: { id: true } }))) throw new UserError("রেসিপি পাওয়া যায়নি");
    if (input.costAccountId) await assertAccounts(tx, ctx.businessId, [input.costAccountId], { label: "খরচের হিসাব" });
    const warehouseId = input.warehouseId ?? (await defaultWarehouseId(tx, ctx.businessId));
    await assertWarehouse(tx, ctx.businessId, warehouseId);

    const removed = existing ? await clearPostings(tx, existing.id) : [];
    const inputIds = input.inputs.map((l) => l.productId);
    const outputIds = input.outputs.map((l) => l.productId);
    await lockProducts(tx, [...inputIds, ...outputIds, ...removed]);
    const products = new Map((await tx.product.findMany({ where: { id: { in: [...inputIds, ...outputIds] }, businessId: ctx.businessId } })).map((p) => [p.id, p]));
    if (products.size !== new Set([...inputIds, ...outputIds]).size) throw new UserError("একটি পণ্য পাওয়া যায়নি");
    // the old lines are replayed together with the new ones below (replaying them first would show
    // later sales of the products without this production and refuse them as negative stock)

    const header = { date: input.date, reference: input.reference, narration: input.narration, amount: 0, adjustmentAccountId: input.extraCost > 0 ? input.costAccountId : null };
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
      : await tx.voucher.create({ data: { ...header, businessId: ctx.businessId, type: "PRODUCTION", voucherNo: await nextVoucherNo(tx, ctx.businessId, "PRODUCTION"), createdById: ctx.userId } });
    const run = { recipeId: input.recipeId, batches: round4(input.batches), extraCost: round2(input.extraCost) };
    await tx.productionRun.upsert({ where: { voucherId: voucher.id }, create: { ...run, voucherId: voucher.id, businessId: ctx.businessId }, update: run });

    const items: Prisma.VoucherItemCreateManyInput[] = [];
    const moves: MovementInput[] = [];
    const used = new Map<string, number>();
    for (const [i, l] of input.inputs.entries()) {
      const p = products.get(l.productId)!;
      const itemId = randomUUID();
      const allocs = p.trackBatch
        ? await allocateSaleBatches(tx, { product: p, batchNo: l.batchNo, baseQuantity: l.quantity, warehouseId, saleDate: input.date, allowExpiredSale: false, used })
        : [{ batchId: null, batchNo: null, expiryDate: null, baseQuantity: l.quantity }];
      const single = allocs.length === 1 ? allocs[0] : null;
      items.push({ id: itemId, voucherId: voucher.id, productId: p.id, warehouseId, unitId: p.unitId, quantity: l.quantity, baseQuantity: l.quantity, rate: 0, amount: 0, direction: -1, batchId: single?.batchId ?? null, batchNo: single?.batchNo ?? null, expiryDate: single?.expiryDate ?? null, lineNo: i });
      for (const a of allocs) moves.push({ productId: p.id, warehouseId, voucherItemId: itemId, type: "PRODUCTION_OUT", quantityOut: a.baseQuantity, unitCost: 0, batchId: a.batchId, batchNo: a.batchNo, expiryDate: a.expiryDate });
    }
    for (const [i, l] of input.outputs.entries()) {
      const p = products.get(l.productId)!;
      const itemId = randomUUID();
      const batch = p.trackBatch
        ? await ensureInboundBatch(tx, ctx.businessId, { productId: p.id, productName: p.name, batchNo: l.batchNo || voucher.voucherNo, expiryDate: l.expiryDate, mfgDate: input.date, date: input.date, unitCost: 0, salePrice: Number(p.salePrice) })
        : null;
      items.push({ id: itemId, voucherId: voucher.id, productId: p.id, warehouseId, unitId: p.unitId, quantity: l.quantity, baseQuantity: l.quantity, rate: 0, amount: 0, direction: 1, costShare: l.costShare, batchId: batch?.id ?? null, batchNo: batch?.batchNo ?? null, expiryDate: batch?.expiryDate ?? null, lineNo: input.inputs.length + i });
      moves.push({ productId: p.id, warehouseId, voucherItemId: itemId, type: "PRODUCTION_IN", quantityIn: l.quantity, unitCost: 0, batchId: batch?.id ?? null, batchNo: batch?.batchNo ?? null, expiryDate: batch?.expiryDate ?? null });
    }
    await tx.voucherItem.createMany({ data: items });
    await writeMovements(tx, ctx, voucher, moves);

    // 1. materials: replay (moving-average cost on the entry date; refuses negative stock)
    const skip = new Set([voucher.id]);
    await revalueProducts(tx, ctx.businessId, [...inputIds, ...removed], { skipRepost: skip });
    // 2. products: split the cost, then replay them (their later sales take the new cost)
    await recostProduction(tx, voucher.id);
    await revalueProducts(tx, ctx.businessId, outputIds, { skipRepost: skip });
    for (const it of await tx.voucherItem.findMany({ where: { voucherId: voucher.id, direction: -1 } })) {
      await tx.voucherItem.update({ where: { id: it.id }, data: { rate: round2(Number(it.costRate)), amount: it.costAmount } });
    }
    await repostVoucher(tx, voucher.id);
    return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
  }, TX_OPTIONS);
}

/** A production entry with its lines, for the form (edit) and the detail views. */
export async function loadProduction(businessId: string, voucherId: string) {
  return prisma.voucher.findFirst({
    where: { id: voucherId, businessId, type: "PRODUCTION" },
    include: {
      productionRun: { include: { recipe: { select: { id: true, name: true } } } },
      adjustmentAccount: { select: { id: true, name: true, code: true, kind: true } },
      items: { orderBy: { lineNo: "asc" }, include: { product: lineProduct, warehouse: { select: { id: true, name: true } } } },
    },
  });
}

export async function listProductions(businessId: string, opts: { from?: Date; to?: Date; recipeId?: string; skip: number; take: number }) {
  const where: Prisma.VoucherWhereInput = {
    businessId, type: "PRODUCTION",
    ...(opts.from || opts.to ? { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}),
    ...(opts.recipeId ? { productionRun: { recipeId: opts.recipeId } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.voucher.findMany({
      where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: opts.skip, take: opts.take,
      include: { productionRun: { include: { recipe: { select: { name: true } } } }, items: { orderBy: { lineNo: "asc" }, include: { product: { select: { name: true, unit: { select: { name: true } } } } } } },
    }),
    prisma.voucher.count({ where }),
  ]);
  return { rows, total };
}

/** Quantities consumed / produced per product in a period (dashboard summary). */
export async function productionSummary(businessId: string, from: Date, to: Date) {
  const moves = await prisma.stockMovement.groupBy({
    by: ["productId", "type"],
    where: { businessId, type: { in: ["PRODUCTION_IN", "PRODUCTION_OUT"] }, date: { gte: from, lte: to } },
    _sum: { quantityIn: true, quantityOut: true, value: true },
  });
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.productId))] } }, select: { id: true, name: true, unit: { select: { name: true } } } });
  const name = new Map(products.map((p) => [p.id, p]));
  const runs = await prisma.voucher.count({ where: { businessId, type: "PRODUCTION", date: { gte: from, lte: to } } });
  const extra = await prisma.productionRun.aggregate({ where: { businessId, voucher: { date: { gte: from, lte: to } } }, _sum: { extraCost: true } });
  return {
    runs,
    extraCost: num(extra._sum.extraCost),
    consumed: moves.filter((m) => m.type === "PRODUCTION_OUT").map((m) => ({ product: name.get(m.productId)?.name ?? "—", unit: name.get(m.productId)?.unit.name ?? "", quantity: round3(num(m._sum.quantityOut)), value: round2(num(m._sum.value)) })),
    produced: moves.filter((m) => m.type === "PRODUCTION_IN").map((m) => ({ product: name.get(m.productId)?.name ?? "—", unit: name.get(m.productId)?.unit.name ?? "", quantity: round3(num(m._sum.quantityIn)), value: round2(num(m._sum.value)) })),
  };
}

// ───────────────────────── rice mill starter ─────────────────────────

/**
 * Creates (or reuses) the products ধান, চাল, খুদ, কুঁড়া, তুষ in kg and the recipe
 * "ধান ভাঙানো (চাল উৎপাদন)": 100 kg paddy → 65 rice, 5 broken rice, 8 bran, 20 husk (2 kg loss).
 * Idempotent: existing products / recipe with these names are reused, nothing is overwritten.
 */
export async function createRiceMillTemplate(ctx: Ctx) {
  return prisma.$transaction(async (tx) => {
    const unit = (await tx.unit.findFirst({ where: { businessId: ctx.businessId, name: "কেজি" } })) ?? (await tx.unit.create({ data: { businessId: ctx.businessId, name: "কেজি", factor: 1 } }));
    const ensure = async (name: string) => {
      const found = await tx.product.findFirst({ where: { businessId: ctx.businessId, name } });
      return found ?? tx.product.create({ data: { businessId: ctx.businessId, name, unitId: unit.id, purchasePrice: 0, salePrice: 0 } });
    };
    const paddy = await ensure(RICE_MILL_TEMPLATE.input.name);
    const outputs = [];
    for (const o of RICE_MILL_TEMPLATE.outputs) outputs.push({ product: await ensure(o.name), ...o });
    const existing = await tx.recipe.findFirst({ where: { businessId: ctx.businessId, name: RICE_MILL_TEMPLATE.recipeName } });
    if (existing) return { recipeId: existing.id, created: false };
    const recipe = await tx.recipe.create({
      data: {
        businessId: ctx.businessId, name: RICE_MILL_TEMPLATE.recipeName, code: "RICE-MILL",
        description: "প্রতি ১০০ কেজি ধানে আনুমানিক ফলন — নিজের মিলের প্রকৃত ফলন অনুযায়ী পরিবর্তন করুন। খরচ-ভাগ: চাল প্রধান পণ্য, খুদ/কুঁড়া/তুষ বাই-প্রোডাক্ট।",
        lines: {
          create: [
            { productId: paddy.id, kind: "INPUT", quantity: RICE_MILL_TEMPLATE.input.quantity, lineNo: 0 },
            ...outputs.map((o, i) => ({ productId: o.product.id, kind: "OUTPUT" as const, quantity: o.quantity, costShare: o.costShare, lineNo: i })),
          ],
        },
      },
    });
    return { recipeId: recipe.id, created: true };
  });
}
