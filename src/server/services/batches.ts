// Batch / lot service. A ProductBatch row describes a lot (number, mfg & expiry, supplier, prices);
// quantities always come from StockMovement and are cached on the batch by syncBatchQuantities.
import type { ProductBatch } from "@prisma/client";
import { round3 } from "@/lib/calc";
import { daysBetween, EXPIRED_SALE_MESSAGE, fefoAllocate, isExpired } from "@/lib/expiry";
import { formatDate, formatQty } from "@/lib/format";
import { UserError } from "@/lib/errors";
import type { Tx } from "./accounting";

const sameDay = (a: Date | null, b: Date | null) => (!a && !b) || (!!a && !!b && daysBetween(a, b) === 0);

export interface InboundBatchInput {
  productId: string;
  productName: string;
  batchNo: string;
  expiryDate?: Date | null;
  mfgDate?: Date | null;
  supplierId?: string | null;
  date: Date;
  unitCost?: number;
  salePrice?: number;
}

/**
 * Finds or creates the batch for goods coming IN (purchase, sales return, stock-in).
 * A batch number identifies one lot of a product, so a second receipt must not contradict the
 * stored expiry date. A batch with no remaining stock history (e.g. while its only purchase is
 * being edited) is simply updated.
 */
export async function ensureInboundBatch(tx: Tx, businessId: string, input: InboundBatchInput): Promise<ProductBatch> {
  const batchNo = input.batchNo.trim();
  if (!batchNo) throw new UserError(`"${input.productName}" ব্যাচভিত্তিক পণ্য — ব্যাচ নম্বর দিন`);
  if (input.mfgDate && input.expiryDate && input.mfgDate.getTime() > input.expiryDate.getTime()) {
    throw new UserError(`"${input.productName}" ব্যাচ ${batchNo}: উৎপাদনের তারিখ মেয়াদ শেষের তারিখের পরে হতে পারে না`);
  }
  const existing = await tx.productBatch.findUnique({ where: { productId_batchNo: { productId: input.productId, batchNo } } });
  if (!existing) {
    return tx.productBatch.create({
      data: {
        businessId,
        productId: input.productId,
        batchNo,
        expiryDate: input.expiryDate ?? null,
        mfgDate: input.mfgDate ?? null,
        supplierId: input.supplierId ?? null,
        purchaseDate: input.date,
        purchasePrice: input.unitCost ?? 0,
        salePrice: input.salePrice ?? 0,
      },
    });
  }
  const history = await tx.stockMovement.count({ where: { batchId: existing.id } });
  if (history === 0) {
    return tx.productBatch.update({
      where: { id: existing.id },
      data: {
        expiryDate: input.expiryDate ?? existing.expiryDate,
        mfgDate: input.mfgDate ?? existing.mfgDate,
        supplierId: input.supplierId ?? existing.supplierId,
        purchaseDate: input.date,
        ...(input.unitCost !== undefined ? { purchasePrice: input.unitCost } : {}),
        ...(input.salePrice !== undefined ? { salePrice: input.salePrice } : {}),
      },
    });
  }
  if (input.expiryDate && existing.expiryDate && !sameDay(input.expiryDate, existing.expiryDate)) {
    throw new UserError(
      `"${input.productName}" ব্যাচ ${batchNo} এর মেয়াদ ${formatDate(existing.expiryDate)} হিসেবে সংরক্ষিত — একই ব্যাচ নম্বরে ভিন্ন মেয়াদ দেওয়া যাবে না (প্রয়োজনে ব্যাচ তালিকা থেকে সংশোধন করুন)`,
    );
  }
  if ((input.expiryDate && !existing.expiryDate) || (input.mfgDate && !existing.mfgDate)) {
    return tx.productBatch.update({
      where: { id: existing.id },
      data: { expiryDate: existing.expiryDate ?? input.expiryDate, mfgDate: existing.mfgDate ?? input.mfgDate },
    });
  }
  return existing;
}

export async function requireBatch(tx: Tx, productId: string, productName: string, batchNo: string) {
  const b = await tx.productBatch.findUnique({ where: { productId_batchNo: { productId, batchNo: batchNo.trim() } } });
  if (!b) throw new UserError(`"${productName}" এর ব্যাচ "${batchNo}" পাওয়া যায়নি`);
  return b;
}

/** On-hand quantity per batch of the given products in one warehouse (current totals). */
export async function warehouseBatchStock(tx: Tx, productIds: string[], warehouseId: string) {
  const rows = await tx.stockMovement.groupBy({
    by: ["batchId"],
    where: { productId: { in: productIds }, warehouseId, batchId: { not: null } },
    _sum: { quantityIn: true, quantityOut: true },
  });
  return new Map(rows.map((r) => [r.batchId!, round3(Number(r._sum.quantityIn ?? 0) - Number(r._sum.quantityOut ?? 0))]));
}

export interface BatchAllocation {
  batchId: string;
  batchNo: string;
  expiryDate: Date | null;
  baseQuantity: number;
}

/**
 * Chooses batches for an outgoing SALE line.
 * • explicit batch → must exist; expired batches are refused unless the business allows it;
 * • no batch → FEFO over unexpired stock in the warehouse (expired batches are never auto-picked).
 * `used` tracks quantities already taken by earlier lines of the same voucher.
 */
export async function allocateSaleBatches(
  tx: Tx,
  opts: {
    product: { id: string; name: string };
    batchNo: string | null;
    baseQuantity: number;
    warehouseId: string;
    saleDate: Date;
    allowExpiredSale: boolean;
    used: Map<string, number>;
  },
): Promise<BatchAllocation[]> {
  const { product } = opts;
  if (opts.batchNo) {
    const b = await requireBatch(tx, product.id, product.name, opts.batchNo);
    if (!opts.allowExpiredSale && isExpired(b.expiryDate, opts.saleDate)) {
      throw new UserError(`${EXPIRED_SALE_MESSAGE} ("${product.name}" — ব্যাচ ${b.batchNo}, মেয়াদ ${formatDate(b.expiryDate)})`);
    }
    opts.used.set(b.id, round3((opts.used.get(b.id) ?? 0) + opts.baseQuantity));
    return [{ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, baseQuantity: opts.baseQuantity }];
  }

  const batches = await tx.productBatch.findMany({ where: { productId: product.id } });
  const stock = await warehouseBatchStock(tx, [product.id], opts.warehouseId);
  const pool = batches.map((b) => ({ batch: b, quantity: round3((stock.get(b.id) ?? 0) - (opts.used.get(b.id) ?? 0)) }));
  const { allocations, shortfall } = fefoAllocate(
    pool.map((p) => ({ batchNo: p.batch.batchNo, expiryDate: p.batch.expiryDate, quantity: p.quantity })),
    opts.baseQuantity,
    opts.saleDate,
  );
  if (shortfall > 0) {
    const usable = round3(opts.baseQuantity - shortfall);
    const expiredQty = round3(pool.filter((p) => p.quantity > 0 && isExpired(p.batch.expiryDate, opts.saleDate)).reduce((s, p) => s + p.quantity, 0));
    if (expiredQty > 0) {
      throw new UserError(
        `"${product.name}" — মেয়াদ আছে এমন স্টক মাত্র ${formatQty(usable)}; বাকি ${formatQty(expiredQty)} মেয়াদোত্তীর্ণ। ${EXPIRED_SALE_MESSAGE}`,
      );
    }
    throw new UserError(`"${product.name}" এর পর্যাপ্ত স্টক নেই — এই গুদামে আছে ${formatQty(usable)}`);
  }
  const byNo = new Map(batches.map((b) => [b.batchNo, b]));
  return allocations.map((a) => {
    const b = byNo.get(a.batchNo)!;
    opts.used.set(b.id, round3((opts.used.get(b.id) ?? 0) + a.quantity));
    return { batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, baseQuantity: a.quantity };
  });
}

/** Re-derives the cached on-hand quantity of every batch of a product from its movements. */
export async function syncBatchQuantities(tx: Tx, productId: string) {
  await tx.$executeRaw`
    UPDATE "ProductBatch" b
    SET "quantity" = s.qty, "updatedAt" = CURRENT_TIMESTAMP
    FROM (
      SELECT pb."id", COALESCE(SUM(m."quantityIn" - m."quantityOut"), 0) AS qty
      FROM "ProductBatch" pb LEFT JOIN "StockMovement" m ON m."batchId" = pb."id"
      WHERE pb."productId" = ${productId}
      GROUP BY pb."id"
    ) s
    WHERE b."id" = s."id" AND b."quantity" IS DISTINCT FROM s.qty`;
}

/** The expiry-loss ledger (created on demand for businesses that predate it). */
export async function expiryLossAccount(tx: Tx, businessId: string): Promise<string> {
  const found = await tx.account.findFirst({ where: { businessId, systemKey: "EXPIRY_LOSS" }, select: { id: true } });
  if (found) return found.id;
  const group = await tx.accountGroup.findFirst({ where: { businessId, systemKey: "INDIRECT_EXPENSES" } });
  if (!group) throw new Error(`INDIRECT_EXPENSES group missing for business ${businessId}`);
  const codeTaken = await tx.account.findFirst({ where: { businessId, code: "5103" }, select: { id: true } });
  const acc = await tx.account.create({
    data: { businessId, groupId: group.id, nature: "EXPENSE", name: "মেয়াদোত্তীর্ণ পণ্যের ক্ষতি", code: codeTaken ? null : "5103", systemKey: "EXPIRY_LOSS", isSystem: true },
  });
  return acc.id;
}
