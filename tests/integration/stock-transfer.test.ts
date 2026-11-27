import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveProduct } from "@/server/services/master";
import { warehouseStock } from "@/server/services/inventory";
import { productSchema, stockTransferSchema } from "@/lib/validation";
import {
  createStockTransfer,
  deleteStockTransfer,
  listStockTransfers,
  getStockTransferForPrint,
} from "@/server/services/stock-transfer";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;

run("Warehouse Stock Transfer Integration Tests", () => {
  let ctx: Ctx;
  let unitId: string;
  let wh1Id: string;
  let wh2Id: string;
  let productId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "TransferTester", email: `trf${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "হস্তান্তর টেস্ট রাইস মিল", ownerUserId: user.id, businessType: "RICE_MILL" }),
    );
    ctx = { businessId: business.id, userId: user.id };
    unitId = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "কেজি" } })).id;
    wh1Id = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId, isDefault: true } })).id;

    const wh2 = await prisma.warehouse.create({
      data: {
        businessId: ctx.businessId,
        name: `গুদাম ২ (শুভংকর)`,
        isDefault: false,
      },
    });
    wh2Id = wh2.id;

    // Create a product with 100 kg initial stock in wh1
    productId = await saveProduct(
      ctx,
      productSchema.parse({
        name: `মিনিকেট চাল-${Date.now()}`,
        unitId,
        purchasePrice: 60,
        salePrice: 70,
        openingStock: 100,
        openingRate: 60,
        warehouseId: wh1Id,
        trackBatch: false,
      }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("verifies initial stock in both warehouses", async () => {
    const stockWh1 = await warehouseStock(prisma as never, productId, wh1Id);
    const stockWh2 = await warehouseStock(prisma as never, productId, wh2Id);

    expect(stockWh1).toBe(100);
    expect(stockWh2).toBe(0);
  });

  it("rejects transfer when fromWarehouse and toWarehouse are the same", async () => {
    expect(() =>
      stockTransferSchema.parse({
        date: new Date().toISOString().slice(0, 10),
        fromWarehouseId: wh1Id,
        toWarehouseId: wh1Id,
        items: [{ productId, quantity: 20 }],
      }),
    ).toThrow();
  });

  it("successfully allows transfer when quantity exceeds sender warehouse stock (allows negative stock)", async () => {
    const input = stockTransferSchema.parse({
      date: new Date().toISOString().slice(0, 10),
      fromWarehouseId: wh1Id,
      toWarehouseId: wh2Id,
      items: [{ productId, quantity: 150 }], // Available is 100
    });

    const res = await createStockTransfer(ctx, input);
    expect(res.transferNo).toMatch(/^TRF-\d{5}$/);

    const stockWh1 = await warehouseStock(prisma as never, productId, wh1Id);
    const stockWh2 = await warehouseStock(prisma as never, productId, wh2Id);
    expect(stockWh1).toBe(-50);
    expect(stockWh2).toBe(150);

    // Delete this transfer to restore clean state for following tests
    await deleteStockTransfer(ctx, res.id);
  });

  it("successfully transfers stock from wh1 to wh2 and generates TRF-XXXXX", async () => {
    const input = stockTransferSchema.parse({
      date: new Date().toISOString().slice(0, 10),
      fromWarehouseId: wh1Id,
      toWarehouseId: wh2Id,
      vehicleNo: "ঢাকা মেট্রো-ট-১১৮৯",
      driverName: "রফিক",
      notes: "ছাটাইয়ের জন্য প্রেরণ",
      items: [{ productId, quantity: 40 }],
    });

    const res = await createStockTransfer(ctx, input);
    expect(res.transferNo).toMatch(/^TRF-\d{5}$/);

    // Verify warehouse stocks
    const stockWh1 = await warehouseStock(prisma as never, productId, wh1Id);
    const stockWh2 = await warehouseStock(prisma as never, productId, wh2Id);

    expect(stockWh1).toBe(60);
    expect(stockWh2).toBe(40);

    // Verify company total product stock is still 100
    const pr = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(pr.stock)).toBe(100);

    // Check listStockTransfers and getStockTransferForPrint
    const list = await listStockTransfers(ctx.businessId, 10);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].transferNo).toBe(res.transferNo);
    expect(Number(list[0].items[0].quantity)).toBe(40);

    const forPrint = await getStockTransferForPrint(ctx.businessId, res.id);
    expect(forPrint).not.toBeNull();
    expect(forPrint?.transferNo).toBe(res.transferNo);
    expect(forPrint?.fromWarehouse.name).toBeDefined();
    expect(forPrint?.toWarehouse.name).toBe("গুদাম ২ (শুভংকর)");

    // Test deleting / reversing the transfer
    await deleteStockTransfer(ctx, res.id);

    // Stocks should be restored
    const stockWh1Restored = await warehouseStock(prisma as never, productId, wh1Id);
    const stockWh2Restored = await warehouseStock(prisma as never, productId, wh2Id);

    expect(stockWh1Restored).toBe(100);
    expect(stockWh2Restored).toBe(0);
  });
});
