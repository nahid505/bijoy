import { PackagingBagType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { round2, round3, round4 } from "@/lib/calc";
import type { PackagingBagItemInput, PackagingBagWastageInput, StockJournalInput } from "@/lib/validation";
import type { Ctx, Tx } from "./accounting";
import { defaultWarehouseId, setOpeningStock, warehouseStock } from "./inventory";
import { saveStockJournal, TX_OPTIONS } from "./voucher";

/**
 * Ensures "Packaging Material" category exists for empty packaging bags.
 */
export async function ensurePackagingBagCategory(tx: Tx, businessId: string) {
  let cat = await tx.category.findFirst({ where: { businessId, name: "Packaging Material" } });
  if (!cat) {
    cat = await tx.category.create({
      data: { businessId, name: "Packaging Material" },
    });
  }
  return cat;
}

/**
 * Ensures "পিস" unit exists.
 */
export async function ensurePackagingBagUnit(tx: Tx, businessId: string) {
  let unit = await tx.unit.findFirst({
    where: { businessId, name: { in: ["পিস", "টি", "Pcs", "pcs"] } },
  });
  if (!unit) {
    unit = await tx.unit.create({
      data: { businessId, name: "পিস", factor: 1 },
    });
  }
  return unit;
}

/**
 * Pre-populates default packaging bags for auto rice mill (50kg bag and 25kg bag)
 * if no packaging bags exist yet.
 */
export async function ensureDefaultPackagingBags(businessId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.packagingBagItem.count({ where: { businessId } });
    if (existing > 0) return;

    const cat = await ensurePackagingBagCategory(tx, businessId);
    const unit = await ensurePackagingBagUnit(tx, businessId);

    const defaults = [
      {
        name: "৫০ কেজি চালের বস্তা",
        code: "BAG-50KG",
        bagType: PackagingBagType.BAG_50KG,
        capacityKg: 50,
        material: "প্লাস্টিক / ওভেন ব্যাগ",
        brandName: "৫০ কেজি স্ট্যান্ডার্ড",
        purchasePrice: 45,
      },
      {
        name: "২৫ কেজি চালের বস্তা",
        code: "BAG-25KG",
        bagType: PackagingBagType.BAG_25KG,
        capacityKg: 25,
        material: "নন-ওভেন ব্যাগ",
        brandName: "২৫ কেজি স্ট্যান্ডার্ড",
        purchasePrice: 30,
      },
    ];

    for (const d of defaults) {
      let prod = await tx.product.findFirst({ where: { businessId, name: d.name } });
      if (!prod) {
        prod = await tx.product.create({
          data: {
            businessId,
            name: d.name,
            code: d.code,
            categoryId: cat.id,
            unitId: unit.id,
            purchasePrice: d.purchasePrice,
            salePrice: 0,
            stock: 0,
            avgCost: d.purchasePrice,
            bagCapacityKg: d.capacityKg,
          },
        });
      }
      await tx.packagingBagItem.create({
        data: {
          businessId,
          productId: prod.id,
          bagType: d.bagType,
          capacityKg: d.capacityKg,
          material: d.material,
          brandName: d.brandName,
        },
      });
    }
  });
}

/**
 * Lists all packaging bag items configured for the business.
 */
export async function listPackagingBagItems(businessId: string) {
  return prisma.packagingBagItem.findMany({
    where: { businessId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          code: true,
          stock: true,
          avgCost: true,
          purchasePrice: true,
          unit: { select: { id: true, name: true } },
        },
      },
      wastages: {
        select: { quantity: true, costAmount: true },
      },
    },
    orderBy: { capacityKg: "desc" },
  });
}

export interface PackagingBagSummary {
  totalPurchased: number;
  totalConsumed: number;
  totalWastage: number;
  currentBalance: number;
  totalStockValue: number;
  items: Array<{
    id: string;
    productId: string;
    name: string;
    code: string | null;
    bagType: PackagingBagType;
    capacityKg: number;
    material: string | null;
    brandName: string | null;
    unit: string;
    stock: number;
    avgCost: number;
    totalValue: number;
    totalPurchased: number;
    totalConsumed: number;
    totalWasted: number;
  }>;
  recentWastages: Array<{
    id: string;
    date: Date;
    bagName: string;
    warehouseName: string;
    quantity: number;
    costRate: number;
    costAmount: number;
    reason: string | null;
    notes: string | null;
    createdByName: string;
  }>;
}

/**
 * Summarizes packaging bag inventory, purchases, auto-consumption, and damage/wastage.
 */
export async function getPackagingBagSummary(
  businessId: string,
  opts?: { from?: Date; to?: Date; warehouseId?: string },
): Promise<PackagingBagSummary> {
  const bagItems = await prisma.packagingBagItem.findMany({
    where: { businessId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          code: true,
          stock: true,
          avgCost: true,
          purchasePrice: true,
          openingStock: true,
          unit: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { capacityKg: "desc" },
  });

  if (bagItems.length === 0) {
    return {
      totalPurchased: 0,
      totalConsumed: 0,
      totalWastage: 0,
      currentBalance: 0,
      totalStockValue: 0,
      items: [],
      recentWastages: [],
    };
  }

  const productIds = bagItems.map((b) => b.productId);
  const bagItemMap = new Map(bagItems.map((b) => [b.id, b]));

  const movesWhere: Record<string, unknown> = {
    businessId,
    productId: { in: productIds },
    OR: [{ voucherId: null }, { voucher: { verificationStatus: { not: "REJECTED" } } }],
  };
  if (opts?.warehouseId) movesWhere.warehouseId = opts.warehouseId;
  if (opts?.from || opts?.to) {
    movesWhere.date = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    };
  }

  const [moves, wastages] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["productId", "type"],
      where: movesWhere,
      _sum: { quantityIn: true, quantityOut: true, value: true },
    }),
    prisma.packagingBagWastage.findMany({
      where: {
        businessId,
        ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}),
        ...(opts?.from || opts?.to
          ? {
              date: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      include: {
        bagItem: { include: { product: { select: { name: true } } } },
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
  ]);

  // Wastage grouped by bagItemId
  const wastageByBag = new Map<string, number>();
  for (const w of wastages) {
    wastageByBag.set(w.bagItemId, (wastageByBag.get(w.bagItemId) ?? 0) + w.quantity);
  }

  let totalPurchased = 0;
  let totalConsumed = 0;
  let totalWastage = 0;
  let currentBalance = 0;
  let totalStockValue = 0;

  const items = bagItems.map((item) => {
    const p = item.product;
    const pMoves = moves.filter((m) => m.productId === p.id);

    const purchasedMove = pMoves
      .filter((m) => m.type === "PURCHASE")
      .reduce((s, m) => s + Number(m._sum.quantityIn ?? 0), 0);
    const itemPurchased = round3(purchasedMove + Number(p.openingStock ?? 0));

    const itemConsumed = round3(
      pMoves
        .filter((m) => m.type === "PRODUCTION_OUT")
        .reduce((s, m) => s + Number(m._sum.quantityOut ?? 0), 0),
    );

    const itemWasted = wastageByBag.get(item.id) ?? 0;
    const stock = round3(Number(p.stock));
    const avgCost = round4(Number(p.avgCost));
    const value = round2(stock * (avgCost || Number(p.purchasePrice)));

    totalPurchased += itemPurchased;
    totalConsumed += itemConsumed;
    totalWastage += itemWasted;
    currentBalance += stock;
    totalStockValue += value;

    return {
      id: item.id,
      productId: item.productId,
      name: p.name,
      code: p.code,
      bagType: item.bagType,
      capacityKg: Number(item.capacityKg),
      material: item.material,
      brandName: item.brandName,
      unit: p.unit.name,
      stock,
      avgCost,
      totalValue: value,
      totalPurchased: itemPurchased,
      totalConsumed: itemConsumed,
      totalWasted: itemWasted,
    };
  });

  const recentWastages = wastages.map((w) => ({
    id: w.id,
    date: w.date,
    bagName: w.bagItem.product.name,
    warehouseName: w.warehouse.name,
    quantity: w.quantity,
    costRate: round2(Number(w.costRate)),
    costAmount: round2(Number(w.costAmount)),
    reason: w.reason,
    notes: w.notes,
    createdByName: w.createdBy.name,
  }));

  return {
    totalPurchased: round3(totalPurchased),
    totalConsumed: round3(totalConsumed),
    totalWastage,
    currentBalance: round3(currentBalance),
    totalStockValue: round2(totalStockValue),
    items,
    recentWastages,
  };
}

/**
 * Creates or updates a PackagingBagItem and its associated Product.
 */
export async function savePackagingBagItem(ctx: Ctx, input: PackagingBagItemInput, id?: string) {
  return prisma.$transaction(async (tx) => {
    const cat = await ensurePackagingBagCategory(tx, ctx.businessId);
    const unit = await ensurePackagingBagUnit(tx, ctx.businessId);

    let bagItem = id ? await tx.packagingBagItem.findFirst({ where: { id, businessId: ctx.businessId } }) : null;
    let productId = bagItem?.productId;

    if (bagItem && productId) {
      await tx.product.update({
        where: { id: productId },
        data: {
          name: input.name,
          code: input.code || null,
          purchasePrice: input.purchasePrice,
          bagCapacityKg: input.capacityKg,
        },
      });

      bagItem = await tx.packagingBagItem.update({
        where: { id: bagItem.id },
        data: {
          bagType: input.bagType,
          capacityKg: input.capacityKg,
          material: input.material || null,
          brandName: input.brandName || null,
        },
      });
    } else {
      const product = await tx.product.create({
        data: {
          businessId: ctx.businessId,
          name: input.name,
          code: input.code || null,
          categoryId: cat.id,
          unitId: unit.id,
          purchasePrice: input.purchasePrice,
          avgCost: input.purchasePrice,
          openingStock: input.openingStock,
          openingRate: input.purchasePrice,
          stock: input.openingStock,
          bagCapacityKg: input.capacityKg,
        },
      });
      productId = product.id;

      if (input.openingStock > 0) {
        await setOpeningStock(tx, ctx, productId, input.openingStock, input.purchasePrice, "GENERAL");
      }

      bagItem = await tx.packagingBagItem.create({
        data: {
          businessId: ctx.businessId,
          productId,
          bagType: input.bagType,
          capacityKg: input.capacityKg,
          material: input.material || null,
          brandName: input.brandName || null,
        },
      });
    }

    return bagItem;
  }, TX_OPTIONS);
}

/**
 * Records wastage / damage of empty packaging bags.
 * 1. Validates warehouse stock.
 * 2. Writes a STOCK_JOURNAL voucher to deduct inventory & record Dr Loss / Cr Inventory.
 * 3. Creates a PackagingBagWastage audit record.
 */
export async function recordPackagingBagWastage(ctx: Ctx, input: PackagingBagWastageInput) {
  const bagItem = await prisma.packagingBagItem.findFirst({
    where: { id: input.bagItemId, businessId: ctx.businessId },
    include: { product: true },
  });
  if (!bagItem) throw new UserError("খালি বস্তা আইটেম পাওয়া যায়নি");

  const available = await warehouseStock(prisma as never, bagItem.productId, input.warehouseId);
  if (available < input.quantity) {
    throw new UserError(`গুদামে পর্যাপ্ত খালি বস্তা নেই (বর্তমান স্টক: ${available} টি)`);
  }

  const unitCost = Number(bagItem.product.avgCost) || Number(bagItem.product.purchasePrice) || 0;
  const costAmount = round2(unitCost * input.quantity);

  const journalInput: StockJournalInput = {
    date: input.date,
    reference: input.reason || "বস্তা ড্যামেজ / নষ্ট",
    narration: input.notes || `খালি চালের বস্তা নষ্ট: ${bagItem.product.name} (${input.quantity} পিস)`,
    lines: [
      {
        productId: bagItem.productId,
        warehouseId: input.warehouseId,
        direction: -1,
        quantity: input.quantity,
        batchNo: null,
        expiryDate: null,
        mfgDate: null,
      },
    ],
  };

  await saveStockJournal(ctx, journalInput);

  const wastage = await prisma.packagingBagWastage.create({
    data: {
      businessId: ctx.businessId,
      bagItemId: bagItem.id,
      warehouseId: input.warehouseId,
      date: input.date,
      quantity: input.quantity,
      reason: input.reason || "ছেঁড়া / নষ্ট বস্তা",
      costRate: unitCost,
      costAmount,
      notes: input.notes,
      createdById: ctx.userId,
    },
  });

  return wastage;
}

/**
 * Deletes a packaging bag item if no transactions exist.
 */
export async function deletePackagingBagItem(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const bagItem = await tx.packagingBagItem.findFirst({
      where: { id, businessId: ctx.businessId },
      include: { product: true },
    });
    if (!bagItem) throw new UserError("খালি বস্তা পাওয়া যায়নি");

    const usedInVouchers = await tx.voucherItem.count({ where: { productId: bagItem.productId } });
    if (usedInVouchers > 0) {
      throw new UserError("এই বস্তার লেনদেন রয়েছে, তাই সরাসরি মুছা যাবে না।");
    }

    await tx.packagingBagWastage.deleteMany({ where: { bagItemId: id } });
    await tx.packagingBagItem.delete({ where: { id } });
    await setOpeningStock(tx, ctx, bagItem.productId, 0, 0);
    await tx.stockMovement.deleteMany({ where: { productId: bagItem.productId } });
    await tx.product.delete({ where: { id: bagItem.productId } });
    return bagItem;
  }, TX_OPTIONS);
}
