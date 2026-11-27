import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveProduct } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { systemAccounts } from "@/server/services/accounting";
import { warehouseStock } from "@/server/services/inventory";
import { createStockTransfer } from "@/server/services/stock-transfer";
import { stockTransferSchema } from "@/lib/validation";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;

run("Negative Stock & Auto Reconciliation Integration Tests", () => {
  let ctx: Ctx;
  let unitId: string;
  let wh1Id: string;
  let wh2Id: string;
  let productId: string;
  let acc: { CASH: string; SALES: string; PURCHASE: string; INVENTORY: string; COGS: string };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "NegStockUser", email: `negstock${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "নেগেটিভ স্টক অটো রাইস মিল", ownerUserId: user.id, businessType: "RICE_MILL" }),
    );
    ctx = { businessId: business.id, userId: user.id };

    acc = (await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId))) as typeof acc;

    const unit = await prisma.unit.findFirstOrThrow({
      where: { businessId: ctx.businessId },
    });
    unitId = unit.id;

    wh1Id = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    const wh2 = await prisma.warehouse.create({
      data: { businessId: ctx.businessId, name: "শুভংকর গুদাম", address: "নওগাঁ" },
    });
    wh2Id = wh2.id;

    // Create a product with 0 stock
    productId = await saveProduct(ctx, {
      name: "মিনিকেট চাল ৫০ কেজি",
      unitId,
      purchasePrice: 60,
      salePrice: 70,
      trackBatch: false,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. Selling with 0 initial stock succeeds and sets negative stock (-500 kg)", async () => {
    // Current stock is 0
    const initialPr = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(initialPr.stock)).toBe(0);

    // Save a sales voucher for 500 kg
    const saleVoucher = await saveTradeVoucher(ctx, "SALES", {
      date: new Date("2026-11-01"),
      reference: "INV-NEG-001",
      narration: "নেগেটিভ স্টকে বিক্রয়",
      partyAccountId: null,
      warehouseId: wh1Id,
      returnOfId: null,
      dueDate: null,
      discount: 0,
      vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 35000, reference: "নগদ বিক্রয়" }],
      items: [
        {
          productId,
          quantity: 500,
          rate: 70,
          unitId: null,
          discount: 0,
          batchNo: null,
          expiryDate: null,
          mfgDate: null,
        },
      ],
    });

    expect(saleVoucher.id).toBeDefined();

    // Check product stock and warehouse stock
    const updatedPr = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(updatedPr.stock)).toBe(-500);

    const wh1Stock = await warehouseStock(prisma as never, productId, wh1Id);
    expect(wh1Stock).toBe(-500);

    // Ensure avgCost is finite and positive
    expect(Number.isFinite(Number(updatedPr.avgCost))).toBe(true);
    expect(Number(updatedPr.avgCost)).toBeGreaterThanOrEqual(0);
  });

  it("2. Subsequent purchase of 1200 kg automatically reconciles negative stock to +700 kg", async () => {
    // Purchase 1200 kg @ 62 Tk
    const purchaseVoucher = await saveTradeVoucher(ctx, "PURCHASE", {
      date: new Date("2026-11-05"),
      reference: "PUR-REC-001",
      narration: "পরবর্তী ক্রয় ও স্টক সমন্বয়",
      partyAccountId: null,
      warehouseId: wh1Id,
      returnOfId: null,
      dueDate: null,
      discount: 0,
      vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 74400, reference: "পরিশোধ" }],
      items: [
        {
          productId,
          quantity: 1200,
          rate: 62,
          unitId: null,
          discount: 0,
          batchNo: null,
          expiryDate: null,
          mfgDate: null,
        },
      ],
    });

    expect(purchaseVoucher.id).toBeDefined();

    // Reconciled stock: -500 + 1200 = 700 kg
    const reconciledPr = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(reconciledPr.stock)).toBe(700);

    const wh1Stock = await warehouseStock(prisma as never, productId, wh1Id);
    expect(wh1Stock).toBe(700);

    // Moving average cost is safely calculated
    expect(Number.isFinite(Number(reconciledPr.avgCost))).toBe(true);
    expect(Number(reconciledPr.avgCost)).toBe(62);
  });

  it("3. Stock transfer from sender warehouse with insufficient stock allows negative balance", async () => {
    // Transfer 1000 kg from wh1 (which currently has 700 kg) to wh2
    // wh1 will become -300 kg, wh2 will become +1000 kg, total company stock remains 700 kg
    const transferInput = stockTransferSchema.parse({
      date: new Date("2026-11-06").toISOString().slice(0, 10),
      fromWarehouseId: wh1Id,
      toWarehouseId: wh2Id,
      notes: "নেগেটিভ স্টকে গুদাম মাল হস্তান্তর",
      items: [{ productId, quantity: 1000 }],
    });

    const transfer = await createStockTransfer(ctx, transferInput);
    expect(transfer.transferNo).toMatch(/^TRF-\d{5}$/);

    const wh1Stock = await warehouseStock(prisma as never, productId, wh1Id);
    const wh2Stock = await warehouseStock(prisma as never, productId, wh2Id);
    expect(wh1Stock).toBe(-300);
    expect(wh2Stock).toBe(1000);

    const pr = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(pr.stock)).toBe(700); // Company total intact: -300 + 1000 = 700
  });

  it("4. Subsequent purchase into sender warehouse reconciles negative warehouse stock", async () => {
    // Buy 500 kg into wh1 (currently at -300 kg)
    await saveTradeVoucher(ctx, "PURCHASE", {
      date: new Date("2026-11-08"),
      reference: "PUR-REC-002",
      narration: "প্রেরক গুদামের স্টক সমন্বয়",
      partyAccountId: null,
      warehouseId: wh1Id,
      returnOfId: null,
      dueDate: null,
      discount: 0,
      vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 31000, reference: "পরিশোধ" }],
      items: [
        {
          productId,
          quantity: 500,
          rate: 62,
          unitId: null,
          discount: 0,
          batchNo: null,
          expiryDate: null,
          mfgDate: null,
        },
      ],
    });

    // wh1: -300 + 500 = +200 kg
    const wh1Stock = await warehouseStock(prisma as never, productId, wh1Id);
    expect(wh1Stock).toBe(200);

    // wh2 is still 1000 kg
    const wh2Stock = await warehouseStock(prisma as never, productId, wh2Id);
    expect(wh2Stock).toBe(1000);

    // Company total: 200 + 1000 = 1200 kg
    const pr = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(pr.stock)).toBe(1200);
  });
});
