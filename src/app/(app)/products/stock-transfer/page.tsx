import type { Metadata } from "next";
import { requirePermission, can } from "@/server/auth";
import { prisma, num } from "@/lib/db";
import { round3 } from "@/lib/calc";
import { PageHeader } from "@/components/ui";
import { listStockTransfers } from "@/server/services/stock-transfer";
import { businessToday } from "@/server/services/notifications";
import { StockTransferClient } from "./stock-transfer-client";

export const metadata: Metadata = {
  title: "গুদাম মাল হস্তান্তর",
};

export default async function StockTransferPage() {
  const ctx = await requirePermission("inventory:view");
  const businessId = ctx.business.id;
  const canManage = can(ctx, "inventory:manage");

  const [warehouses, products, movements, transfers] = await Promise.all([
    prisma.warehouse.findMany({
      where: { businessId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, isDefault: true },
    }),
    prisma.product.findMany({
      where: { businessId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        trackBatch: true,
        unit: { select: { id: true, name: true } },
      },
    }),
    prisma.stockMovement.groupBy({
      by: ["warehouseId", "productId"],
      where: { businessId },
      _sum: { quantityIn: true, quantityOut: true },
    }),
    listStockTransfers(businessId, 50),
  ]);

  // Build warehouse stock map: key = `${warehouseId}_${productId}`
  const stockMap: Record<string, number> = {};
  for (const m of movements) {
    if (m.warehouseId && m.productId) {
      const key = `${m.warehouseId}_${m.productId}`;
      stockMap[key] = round3(num(m._sum.quantityIn) - num(m._sum.quantityOut));
    }
  }

  // Format transfers for serialization to client component
  const initialTransfers = transfers.map((t) => ({
    id: t.id,
    transferNo: t.transferNo,
    date: t.date.toISOString(),
    fromWarehouse: { id: t.fromWarehouse.id, name: t.fromWarehouse.name },
    toWarehouse: { id: t.toWarehouse.id, name: t.toWarehouse.name },
    vehicleNo: t.vehicleNo,
    driverName: t.driverName,
    notes: t.notes,
    createdBy: t.createdBy ? { id: t.createdBy.id, name: t.createdBy.name } : null,
    items: t.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product.name,
      productCode: i.product.code,
      unitName: i.product.unit.name,
      quantity: num(i.quantity),
      unitCost: num(i.unitCost),
      batchNo: i.batchNo,
      lineNo: i.lineNo,
    })),
  }));

  const initialDate = businessToday().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="গুদাম থেকে গুদামে মাল হস্তান্তর"
        description="এক গুদাম থেকে অন্য গুদামে ধান, চাল, ভুষি ও পণ্য স্থানান্তর ভাউচার ও চালান"
        crumbs={[
          { label: "পণ্য", href: "/products" },
          { label: "স্টক", href: "/products/stock" },
          { label: "গুদাম মাল হস্তান্তর" },
        ]}
      />

      <StockTransferClient
        warehouses={warehouses}
        products={products}
        stockMap={stockMap}
        initialTransfers={initialTransfers}
        canManage={canManage}
        initialDate={initialDate}
      />
    </div>
  );
}
