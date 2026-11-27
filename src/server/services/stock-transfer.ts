import "server-only";
import { prisma } from "@/lib/db";
import { round2, round3, round4 } from "@/lib/calc";
import { formatQty } from "@/lib/format";
import { UserError } from "@/lib/errors";
import type { StockTransferInput } from "@/lib/validation";
import { assertNotLocked, type Ctx } from "./accounting";
import { lockProducts, warehouseStock } from "./inventory";
import { revalueProducts } from "./posting";
import { audit } from "../audit";

export const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export async function createStockTransfer(ctx: Ctx, input: StockTransferInput) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new UserError("প্রেরক ও প্রাপক গুদাম একই হতে পারবে না");
  }

  return prisma.$transaction(async (tx) => {
    await assertNotLocked(tx, ctx.businessId, input.date);

    // Verify warehouses belong to business
    const fromWh = await tx.warehouse.findFirst({
      where: { id: input.fromWarehouseId, businessId: ctx.businessId },
    });
    if (!fromWh) throw new UserError("প্রেরক গুদামটি পাওয়া যায়নি");

    const toWh = await tx.warehouse.findFirst({
      where: { id: input.toWarehouseId, businessId: ctx.businessId },
    });
    if (!toWh) throw new UserError("প্রাপক গুদামটি পাওয়া যায়নি");

    // Lock products for concurrent safety
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    await lockProducts(tx, productIds);

    // Fetch product details
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, businessId: ctx.businessId },
      include: { unit: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Check available stock in fromWarehouse for each product
    // Sum requested quantity per product in case same product added on multiple lines
    const qtyByProduct = new Map<string, number>();
    for (const item of input.items) {
      qtyByProduct.set(item.productId, round3((qtyByProduct.get(item.productId) ?? 0) + item.quantity));
    }

    for (const pId of qtyByProduct.keys()) {
      const p = productMap.get(pId);
      if (!p) throw new UserError("নির্বাচিত পণ্য পাওয়া যায়নি");
    }

    // Generate sequence number TRF-00001
    const counter = await tx.counter.upsert({
      where: { businessId_key: { businessId: ctx.businessId, key: "STOCK_TRANSFER" } },
      create: { businessId: ctx.businessId, key: "STOCK_TRANSFER", value: 1 },
      update: { value: { increment: 1 } },
    });
    const transferNo = `TRF-${String(counter.value).padStart(5, "0")}`;

    // Create StockTransfer
    const transfer = await tx.stockTransfer.create({
      data: {
        businessId: ctx.businessId,
        transferNo,
        date: input.date,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        vehicleNo: input.vehicleNo?.trim() || null,
        driverName: input.driverName?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: ctx.userId,
      },
    });

    // Create items and stock movements
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      const p = productMap.get(item.productId)!;
      const unitCost = Number(p.avgCost) > 0 ? Number(p.avgCost) : Number(p.purchasePrice);
      const qty = round3(item.quantity);

      const transferItem = await tx.stockTransferItem.create({
        data: {
          transferId: transfer.id,
          productId: item.productId,
          quantity: qty,
          unitCost: round4(unitCost),
          batchNo: item.batchNo?.trim() || null,
          lineNo: i + 1,
        },
      });

      // Stock out from sender warehouse
      await tx.stockMovement.create({
        data: {
          businessId: ctx.businessId,
          productId: item.productId,
          warehouseId: input.fromWarehouseId,
          transferId: transfer.id,
          transferItemId: transferItem.id,
          type: "TRANSFER_OUT",
          date: input.date,
          quantityIn: 0,
          quantityOut: qty,
          unitCost: round4(unitCost),
          value: round2(qty * unitCost),
          batchNo: item.batchNo?.trim() || null,
        },
      });

      // Stock in to destination warehouse
      await tx.stockMovement.create({
        data: {
          businessId: ctx.businessId,
          productId: item.productId,
          warehouseId: input.toWarehouseId,
          transferId: transfer.id,
          transferItemId: transferItem.id,
          type: "TRANSFER_IN",
          date: input.date,
          quantityIn: qty,
          quantityOut: 0,
          unitCost: round4(unitCost),
          value: round2(qty * unitCost),
          batchNo: item.batchNo?.trim() || null,
        },
      });
    }

    // Recalculate stock and ensure no negative stock across the whole timeline
    await revalueProducts(tx, ctx.businessId, productIds);

    await audit({
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: "CREATE",
      entity: "StockTransfer",
      entityId: transfer.id,
      details: {
        transferNo,
        fromWarehouse: fromWh.name,
        toWarehouse: toWh.name,
        itemsCount: input.items.length,
      },
    });

    return { id: transfer.id, transferNo };
  }, TX_OPTIONS);
}

export async function deleteStockTransfer(ctx: Ctx, transferId: string) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: transferId, businessId: ctx.businessId },
      include: { items: true, fromWarehouse: true, toWarehouse: true },
    });
    if (!transfer) throw new UserError("মাল হস্তান্তরের রেকর্ড পাওয়া যায়নি");

    await assertNotLocked(tx, ctx.businessId, transfer.date);

    const productIds = [...new Set(transfer.items.map((i) => i.productId))];
    await lockProducts(tx, productIds);

    await tx.stockTransfer.delete({
      where: { id: transfer.id },
    });

    // Replay products timeline after removing the movements
    await revalueProducts(tx, ctx.businessId, productIds);

    await audit({
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: "DELETE",
      entity: "StockTransfer",
      entityId: transfer.id,
      details: {
        transferNo: transfer.transferNo,
        fromWarehouse: transfer.fromWarehouse.name,
        toWarehouse: transfer.toWarehouse.name,
      },
    });

    return { success: true };
  }, TX_OPTIONS);
}

export async function listStockTransfers(businessId: string, limit = 50) {
  return prisma.stockTransfer.findMany({
    where: { businessId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      fromWarehouse: { select: { id: true, name: true } },
      toWarehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: { id: true, name: true, code: true, unit: { select: { name: true } } },
          },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });
}

export async function getStockTransferForPrint(businessId: string, transferId: string) {
  return prisma.stockTransfer.findFirst({
    where: { id: transferId, businessId },
    include: {
      business: true,
      fromWarehouse: true,
      toWarehouse: true,
      createdBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: { id: true, name: true, code: true, unit: { select: { name: true } } },
          },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });
}
