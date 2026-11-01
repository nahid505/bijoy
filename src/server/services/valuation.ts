import "server-only";
import { prisma, num } from "@/lib/db";
import { round2, round3, round4 } from "@/lib/calc";

export interface ProductValuationItem {
  productId: string;
  name: string;
  code: string | null;
  category: string;
  unit: string;
  stock: number;
  rate: number;
  value: number;
  kind: "PURCHASED" | "PRODUCED";
  method: "FIFO_LOTS" | "LAST_SALES_AVG" | "FALLBACK_PRICE";
  salesCount: number;
  coveredLotsCount: number;
  salePrice: number;
  retailValue: number;
}

export interface InventoryValuationSummary {
  totalValue: number;
  purchasedValue: number;
  producedValue: number;
  totalProducts: number;
  purchasedCount: number;
  producedCount: number;
  items: ProductValuationItem[];
  byCategory: Map<string, { category: string; value: number; qty: number; items: ProductValuationItem[] }>;
}

export interface ValuationOptions {
  includeDepot?: boolean;
  productIds?: string[];
  asOfDate?: Date;
}

/**
 * Enterprise Inventory Valuation Service:
 * 1. Purchased Raw Materials & Trading Goods: FIFO Weighted Average of Remaining Lots.
 * 2. Produced Finished Goods (Rice, Bran, Husk, Khud, etc.): Weighted Average of Last 3 Sales Invoices (or fallback sale price/avg cost).
 */
export async function calculateInventoryValuation(
  businessId: string,
  opts?: ValuationOptions,
): Promise<InventoryValuationSummary> {
  // 1. Identify produced products (recipe outputs or production entries)
  const [recipeOutputs, prodInMoves, prodItems] = await Promise.all([
    prisma.recipeLine.findMany({
      where: { recipe: { businessId }, kind: "OUTPUT" },
      select: { productId: true },
      distinct: ["productId"],
    }),
    prisma.stockMovement.findMany({
      where: { businessId, type: "PRODUCTION_IN" },
      select: { productId: true },
      distinct: ["productId"],
    }),
    prisma.voucherItem.findMany({
      where: { voucher: { businessId, type: "PRODUCTION" }, direction: { gt: 0 } },
      select: { productId: true },
      distinct: ["productId"],
    }),
  ]);

  const producedIds = new Set([
    ...recipeOutputs.map((r) => r.productId),
    ...prodInMoves.map((m) => m.productId),
    ...prodItems.map((i) => i.productId),
  ]);

  // 2. Fetch active products
  const products = await prisma.product.findMany({
    where: {
      businessId,
      isActive: true,
      ...(opts?.includeDepot ? {} : { isDepotProduct: false }),
      ...(opts?.productIds ? { id: { in: opts.productIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      stock: true,
      purchasePrice: true,
      salePrice: true,
      wholesalePrice: true,
      avgCost: true,
      openingStock: true,
      openingRate: true,
      unit: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });

  // Separate products with positive stock
  const withStock = products.filter((p) => num(p.stock) > 0.0001);
  const producedIdsWithStock = withStock.filter((p) => producedIds.has(p.id)).map((p) => p.id);
  const purchasedIdsWithStock = withStock.filter((p) => !producedIds.has(p.id)).map((p) => p.id);

  // 3. For produced goods: fetch latest sales invoice lines (up to last 3 sales per product)
  const salesItems = producedIdsWithStock.length > 0
    ? await prisma.voucherItem.findMany({
        where: {
          productId: { in: producedIdsWithStock },
          voucher: {
            businessId,
            type: { in: ["SALES", "DEPOT_DELIVERY"] },
            verificationStatus: { not: "REJECTED" },
            ...(opts?.asOfDate ? { date: { lte: opts.asOfDate } } : {}),
          },
        },
        orderBy: [
          { voucher: { date: "desc" } },
          { voucher: { createdAt: "desc" } },
          { id: "desc" },
        ],
        select: {
          productId: true,
          quantity: true,
          baseQuantity: true,
          rate: true,
          amount: true,
          voucher: { select: { id: true, voucherNo: true, date: true } },
        },
      })
    : [];

  const salesByProduct = new Map<string, typeof salesItems>();
  for (const s of salesItems) {
    const list = salesByProduct.get(s.productId) ?? [];
    if (list.length < 3) {
      list.push(s);
      salesByProduct.set(s.productId, list);
    }
  }

  // 4. For purchased goods: fetch purchase inflows in reverse chronological order
  const purchaseMoves = purchasedIdsWithStock.length > 0
    ? await prisma.stockMovement.findMany({
        where: {
          businessId,
          productId: { in: purchasedIdsWithStock },
          type: { in: ["PURCHASE", "OPENING"] },
          quantityIn: { gt: 0 },
          OR: [{ voucherId: null }, { voucher: { verificationStatus: { not: "REJECTED" } } }],
          ...(opts?.asOfDate ? { date: { lte: opts.asOfDate } } : {}),
        },
        orderBy: [
          { date: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        select: {
          productId: true,
          quantityIn: true,
          unitCost: true,
          date: true,
        },
      })
    : [];

  const purchasesByProduct = new Map<string, typeof purchaseMoves>();
  for (const m of purchaseMoves) {
    const list = purchasesByProduct.get(m.productId) ?? [];
    list.push(m);
    purchasesByProduct.set(m.productId, list);
  }

  // 5. Compute valuation for each product
  const items: ProductValuationItem[] = [];
  const byCategory = new Map<string, { category: string; value: number; qty: number; items: ProductValuationItem[] }>();
  let purchasedValue = 0;
  let producedValue = 0;
  let purchasedCount = 0;
  let producedCount = 0;

  for (const p of withStock) {
    const stock = round3(num(p.stock));
    const isProduced = producedIds.has(p.id);
    let valuationRate = 0;
    let valuationMethod: "FIFO_LOTS" | "LAST_SALES_AVG" | "FALLBACK_PRICE" = "FALLBACK_PRICE";
    let salesCount = 0;
    let coveredLotsCount = 0;

    if (isProduced) {
      // ── Rule 2: Produced Finished Good ──
      const lastSales = salesByProduct.get(p.id) ?? [];
      salesCount = lastSales.length;

      if (salesCount > 0) {
        const totalAmount = lastSales.reduce((sum, s) => sum + num(s.amount), 0);
        const totalQty = lastSales.reduce((sum, s) => sum + num(s.baseQuantity || s.quantity), 0);
        valuationRate = totalQty > 0 ? round4(totalAmount / totalQty) : num(lastSales[0].rate);
        valuationMethod = "LAST_SALES_AVG";
      } else {
        // Fallback: available sale price, wholesale price, or avg cost
        const sPrice = num(p.salePrice);
        const wPrice = num(p.wholesalePrice);
        const aCost = num(p.avgCost);
        const pPrice = num(p.purchasePrice);
        valuationRate = sPrice > 0 ? sPrice : wPrice > 0 ? wPrice : aCost > 0 ? aCost : pPrice;
        valuationMethod = "FALLBACK_PRICE";
      }

      const value = round2(stock * valuationRate);
      producedValue += value;
      producedCount++;

      const categoryName = p.category?.name ?? "ক্যাটাগরিহীন";
      const sPrice = num(p.salePrice);
      const retailVal = round2(stock * (sPrice > 0 ? sPrice : valuationRate));

      const item: ProductValuationItem = {
        productId: p.id,
        name: p.name,
        code: p.code,
        category: categoryName,
        unit: p.unit.name,
        stock,
        rate: valuationRate,
        value,
        kind: "PRODUCED",
        method: valuationMethod,
        salesCount,
        coveredLotsCount: 0,
        salePrice: sPrice,
        retailValue: retailVal,
      };
      items.push(item);

      const catGroup = byCategory.get(categoryName) ?? { category: categoryName, value: 0, qty: 0, items: [] };
      catGroup.value = round2(catGroup.value + value);
      catGroup.qty = round3(catGroup.qty + stock);
      catGroup.items.push(item);
      byCategory.set(categoryName, catGroup);
    } else {
      // ── Rule 1: Purchased Raw Material / Goods (FIFO Remaining Lots) ──
      const pMoves = purchasesByProduct.get(p.id) ?? [];
      let rem = stock;
      let costSum = 0;
      let covered = 0;

      for (const m of pMoves) {
        const qIn = num(m.quantityIn);
        const uCost = num(m.unitCost);
        if (qIn <= 0) continue;

        const take = Math.min(qIn, rem);
        costSum += take * uCost;
        covered += take;
        coveredLotsCount++;
        rem -= take;

        if (rem <= 0.0001) break;
      }

      if (rem > 0.0001) {
        const fallback = num(p.purchasePrice) > 0 ? num(p.purchasePrice) : num(p.avgCost) > 0 ? num(p.avgCost) : num(p.openingRate);
        costSum += rem * fallback;
        covered += rem;
      }

      valuationRate = covered > 0 ? round4(costSum / covered) : num(p.purchasePrice);
      valuationMethod = "FIFO_LOTS";

      const value = round2(stock * valuationRate);
      purchasedValue += value;
      purchasedCount++;

      const categoryName = p.category?.name ?? "ক্যাটাগরিহীন";
      const sPrice = num(p.salePrice);
      const retailVal = round2(stock * (sPrice > 0 ? sPrice : valuationRate));

      const item: ProductValuationItem = {
        productId: p.id,
        name: p.name,
        code: p.code,
        category: categoryName,
        unit: p.unit.name,
        stock,
        rate: valuationRate,
        value,
        kind: "PURCHASED",
        method: valuationMethod,
        salesCount: 0,
        coveredLotsCount,
        salePrice: sPrice,
        retailValue: retailVal,
      };
      items.push(item);

      const catGroup = byCategory.get(categoryName) ?? { category: categoryName, value: 0, qty: 0, items: [] };
      catGroup.value = round2(catGroup.value + value);
      catGroup.qty = round3(catGroup.qty + stock);
      catGroup.items.push(item);
      byCategory.set(categoryName, catGroup);
    }
  }

  purchasedValue = round2(purchasedValue);
  producedValue = round2(producedValue);
  const totalValue = round2(purchasedValue + producedValue);

  return {
    totalValue,
    purchasedValue,
    producedValue,
    totalProducts: items.length,
    purchasedCount,
    producedCount,
    items,
    byCategory,
  };
}
