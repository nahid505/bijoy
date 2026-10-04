// InventoryService — stock movements are the source of truth for quantities;
// Product.stock / Product.avgCost are caches rebuilt by the replay in posting.ts.
import type { StockMovementType } from "@prisma/client";
import { round2, round3, round4 } from "@/lib/calc";
import { openingEntries } from "@/lib/accounting";
import { UserError } from "@/lib/errors";
import { assertNotLocked, nextVoucherNo, systemAccounts, writeEntries, type Ctx, type Tx } from "./accounting";
import { revalueProducts } from "./posting";

/** Locks product rows (consistent order → no deadlocks) for the rest of the transaction. */
export async function lockProducts(tx: Tx, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  for (const id of ids) await tx.$queryRaw`SELECT 1 FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
}

/** Quantity on hand (base unit) of a product in one warehouse (optionally one batch). */
export async function warehouseStock(tx: Tx, productId: string, warehouseId: string, batchNo?: string | null): Promise<number> {
  const agg = await tx.stockMovement.aggregate({
    where: { productId, warehouseId, ...(batchNo !== undefined ? { batchNo } : {}) },
    _sum: { quantityIn: true, quantityOut: true },
  });
  return round3(Number(agg._sum.quantityIn ?? 0) - Number(agg._sum.quantityOut ?? 0));
}

/** Available batches per warehouse (quantity > 0), earliest expiry first (FEFO order). */
export async function availableBatches(tx: Tx, businessId: string, productIds?: string[]) {
  const rows = await tx.stockMovement.groupBy({
    by: ["productId", "warehouseId", "batchId"],
    where: { businessId, batchId: { not: null }, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { quantityIn: true, quantityOut: true },
  });
  const batches = new Map(
    (await tx.productBatch.findMany({ where: { id: { in: rows.map((r) => r.batchId!) } }, select: { id: true, batchNo: true, expiryDate: true, mfgDate: true } })).map((b) => [b.id, b]),
  );
  return rows
    .map((r) => {
      const b = batches.get(r.batchId!)!;
      return {
        productId: r.productId,
        warehouseId: r.warehouseId,
        batchId: b.id,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        mfgDate: b.mfgDate,
        quantity: round3(Number(r._sum.quantityIn ?? 0) - Number(r._sum.quantityOut ?? 0)),
      };
    })
    .filter((r) => r.quantity > 0)
    .sort((a, b) => (a.expiryDate?.getTime() ?? Infinity) - (b.expiryDate?.getTime() ?? Infinity) || a.batchNo.localeCompare(b.batchNo));
}

export async function defaultWarehouseId(tx: Tx, businessId: string): Promise<string> {
  const w = await tx.warehouse.findFirst({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  if (!w) throw new UserError("কোনো গুদাম নেই");
  return w.id;
}

export interface MovementInput {
  productId: string;
  warehouseId: string;
  voucherItemId?: string | null;
  type: StockMovementType;
  quantityIn?: number;
  quantityOut?: number;
  unitCost: number;
  batchId?: string | null;
  batchNo?: string | null;
  expiryDate?: Date | null;
}

export async function writeMovements(tx: Tx, ctx: Ctx, voucher: { id: string; date: Date }, moves: MovementInput[]) {
  if (moves.length === 0) return;
  await tx.stockMovement.createMany({
    data: moves.map((m) => {
      const qty = (m.quantityIn ?? 0) || (m.quantityOut ?? 0);
      return {
        businessId: ctx.businessId,
        productId: m.productId,
        warehouseId: m.warehouseId,
        voucherId: voucher.id,
        voucherItemId: m.voucherItemId ?? null,
        type: m.type,
        date: voucher.date,
        quantityIn: round3(m.quantityIn ?? 0),
        quantityOut: round3(m.quantityOut ?? 0),
        unitCost: round4(m.unitCost),
        value: round2(qty * m.unitCost),
        batchId: m.batchId ?? null,
        batchNo: m.batchNo ?? null,
        expiryDate: m.expiryDate ?? null,
      };
    }),
  });
}

/** Opening stock: one OPENING voucher per product (Dr Inventory / Cr Opening balance equity). */
export async function setOpeningStock(tx: Tx, ctx: Ctx, productId: string, qty: number, rate: number) {
  const business = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  const sourceKey = `opening:product:${productId}`;
  const existing = await tx.voucher.findUnique({ where: { businessId_sourceKey: { businessId: ctx.businessId, sourceKey } } });
  const value = round2(qty * rate);
  const unchanged =
    existing &&
    qty > 0 &&
    Number(existing.amount) === value &&
    (await tx.stockMovement.count({ where: { voucherId: existing.id, quantityIn: qty, unitCost: round4(rate) } })) === 1;
  if (unchanged || (!existing && qty <= 0)) return;
  await assertNotLocked(tx, ctx.businessId, business.booksStartDate);

  if (qty <= 0) {
    await tx.voucher.delete({ where: { id: existing!.id } });
  } else {
    const acc = await systemAccounts(tx, ctx.businessId);
    const warehouseId = await defaultWarehouseId(tx, ctx.businessId);
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { amount: value, date: business.booksStartDate, updatedById: ctx.userId } })
      : await tx.voucher.create({
          data: {
            businessId: ctx.businessId,
            type: "OPENING",
            voucherNo: await nextVoucherNo(tx, ctx.businessId, "OPENING"),
            date: business.booksStartDate,
            narration: "প্রারম্ভিক মজুদ",
            amount: value,
            warehouseId,
            sourceKey,
            createdById: ctx.userId,
          },
        });
    await tx.stockMovement.deleteMany({ where: { voucherId: voucher.id } });
    await writeMovements(tx, ctx, voucher, [{ productId, warehouseId, type: "OPENING", quantityIn: qty, unitCost: rate }]);
    await writeEntries(tx, voucher, openingEntries(acc.INVENTORY, value, acc), { allowEmpty: true });
  }
  await revalueProducts(tx, ctx.businessId, [productId]); // later sales' COGS follow the new opening cost
}
