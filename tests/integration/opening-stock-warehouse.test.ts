import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveProduct } from "@/server/services/master";
import { warehouseStock } from "@/server/services/inventory";
import { productSchema } from "@/lib/validation";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;

run("Product Opening Stock Warehouse Assignment", () => {
  let ctx: Ctx;
  let unitId: string;
  let defaultWhId: string;
  let secondWhId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "WhTest", email: `whtest${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "গুদাম টেস্ট মিল", ownerUserId: user.id, businessType: "RICE_MILL" }),
    );
    ctx = { businessId: business.id, userId: user.id };
    unitId = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "কেজি" } })).id;
    defaultWhId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId, isDefault: true } })).id;

    const secondWh = await prisma.warehouse.create({
      data: {
        businessId: ctx.businessId,
        name: `গুদাম-২-${Date.now()}`,
        isDefault: false,
      },
    });
    secondWhId = secondWh.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records opening stock in the user-selected warehouse and updates properly on change", async () => {
    // 1. Create product with opening stock in secondWh
    const productId = await saveProduct(
      ctx,
      productSchema.parse({
        name: `টেস্ট চাল-${Date.now()}`,
        unitId,
        purchasePrice: 60,
        salePrice: 70,
        openingStock: 25,
        openingRate: 60,
        warehouseId: secondWhId,
        trackBatch: false,
      }),
    );

    // Verify stock in secondWh is 25, and in defaultWh is 0
    const stockWh2 = await warehouseStock(prisma as never, productId, secondWhId);
    const stockWhDefault = await warehouseStock(prisma as never, productId, defaultWhId);

    expect(stockWh2).toBe(25);
    expect(stockWhDefault).toBe(0);

    // Verify Voucher and StockMovement
    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { businessId_sourceKey: { businessId: ctx.businessId, sourceKey: `opening:product:${productId}` } },
      include: { stockMovements: true },
    });

    expect(voucher.warehouseId).toBe(secondWhId);
    expect(voucher.stockMovements.length).toBe(1);
    expect(voucher.stockMovements[0].warehouseId).toBe(secondWhId);
    expect(Number(voucher.stockMovements[0].quantityIn)).toBe(25);

    // 2. Update product opening stock to defaultWh
    await saveProduct(
      ctx,
      productSchema.parse({
        name: `টেস্ট চাল-${Date.now()}`,
        unitId,
        purchasePrice: 60,
        salePrice: 70,
        openingStock: 30,
        openingRate: 62,
        warehouseId: defaultWhId,
        trackBatch: false,
      }),
      productId,
    );

    const stockWh2After = await warehouseStock(prisma as never, productId, secondWhId);
    const stockWhDefaultAfter = await warehouseStock(prisma as never, productId, defaultWhId);

    expect(stockWh2After).toBe(0);
    expect(stockWhDefaultAfter).toBe(30);

    const updatedVoucher = await prisma.voucher.findUniqueOrThrow({
      where: { businessId_sourceKey: { businessId: ctx.businessId, sourceKey: `opening:product:${productId}` } },
      include: { stockMovements: true },
    });

    expect(updatedVoucher.warehouseId).toBe(defaultWhId);
    expect(updatedVoucher.stockMovements.length).toBe(1);
    expect(updatedVoucher.stockMovements[0].warehouseId).toBe(defaultWhId);
    expect(Number(updatedVoucher.stockMovements[0].quantityIn)).toBe(30);
  });
});
