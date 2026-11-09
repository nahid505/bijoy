import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { saveProduction } from "@/server/services/production";
import {
  ensureDefaultPackagingBags,
  getPackagingBagSummary,
  listPackagingBagItems,
  recordPackagingBagWastage,
  savePackagingBagItem,
} from "@/server/services/packaging-bag";
import type { ProductionInput } from "@/lib/validation";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({
  name,
  mobile: null,
  email: null,
  address: null,
  notes: null,
  openingBalance: 0,
  creditLimit: 0,
  creditDays: 0,
});

run("rice mill packaging bag inventory & consumption tracking", () => {
  let ctx: Ctx;
  let acc: Record<string, string>;
  let warehouseId: string;
  let bagSupplier: { accountId: string };
  const p: Record<string, string> = {};

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Bag Admin", email: `bagadmin${Date.now()}@test.local`, passwordHash: "x" },
    });
    const b = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "সোনালী অটো রাইস মিল", ownerUserId: user.id, businessTypes: ["AUTO_RICE_MILL"] }),
    );
    ctx = { businessId: b.id, userId: user.id };
    acc = { ...(await systemAccounts(prisma as never, b.id)) };
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: b.id } })).id;

    const kg = await prisma.unit.findFirstOrThrow({ where: { businessId: b.id, name: "কেজি" } });
    for (const [k, name] of [
      ["paddy", "ধান"],
      ["rice", "মিনিকেট চাল ৫০ কেজি"],
      ["broken", "খুদ"],
      ["bran", "কুঁড়া"],
      ["husk", "তুষ"],
    ]) {
      p[k] = (await prisma.product.create({ data: { businessId: b.id, name, unitId: kg.id, avgCost: k === "paddy" ? 30 : 0 } })).id;
    }

    bagSupplier = await saveParty(ctx, "SUPPLIER", party("মেঘনা প্যাকেজিং লিঃ"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. ensureDefaultPackagingBags creates default 50KG and 25KG bag items", async () => {
    await ensureDefaultPackagingBags(ctx.businessId);

    const items = await listPackagingBagItems(ctx.businessId);
    expect(items.length).toBeGreaterThanOrEqual(2);

    const bag50 = items.find((i) => i.bagType === "BAG_50KG");
    expect(bag50).toBeDefined();
    expect(bag50?.product.name).toContain("৫০ কেজি");
    expect(Number(bag50?.capacityKg)).toBe(50);
    p.bag50 = bag50!.productId;
    p.bagItem50Id = bag50!.id;

    const bag25 = items.find((i) => i.bagType === "BAG_25KG");
    expect(bag25).toBeDefined();
    expect(Number(bag25?.capacityKg)).toBe(25);
  });

  it("2. Purchasing empty packaging bags via standard purchase voucher increases bag inventory", async () => {
    // Buy 1,000 bags of 50kg bag at 45 Tk each from bagSupplier
    const purchaseVoucher = await saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-05"),
      partyAccountId: bagSupplier.accountId,
      warehouseId,
      reference: "PO-BAGS-001",
      narration: "১০০০ পিস ৫০ কেজি চালের বস্তা ক্রয়",
      discount: 0,
      vatPercent: 0,
      payments: [],
      returnOfId: null,
      dueDate: null,
      items: [
        {
          productId: p.bag50,
          quantity: 1000,
          freeQuantity: 0,
          rate: 45,
          discount: 0,
          unitId: null,
          batchNo: null,
          expiryDate: null,
          mfgDate: null,
        },
      ],
    });

    expect(purchaseVoucher.id).toBeDefined();

    const bagProd = await prisma.product.findUniqueOrThrow({ where: { id: p.bag50 } });
    expect(Number(bagProd.stock)).toBe(1000);
    expect(Number(bagProd.avgCost)).toBe(45);

    const summary = await getPackagingBagSummary(ctx.businessId);
    expect(summary.totalPurchased).toBe(1000);
    expect(summary.currentBalance).toBe(1000);
    expect(summary.totalStockValue).toBe(45000);
    expect(summary.totalConsumed).toBe(0);
    expect(summary.totalWastage).toBe(0);
  });

  it("3. Milling & processing automatically consumes required packaging bags and adds bag cost to rice Cost of Production", async () => {
    // Give paddy initial stock of 10,000 kg @ 30 Tk
    await saveTradeVoucher(ctx, "PURCHASE", {
      date: D("2026-10-06"),
      partyAccountId: bagSupplier.accountId,
      warehouseId,
      reference: "PADDY-IN",
      narration: "ধান প্রাথমিক স্টক",
      discount: 0,
      vatPercent: 0,
      payments: [],
      returnOfId: null,
      dueDate: null,
      items: [{ productId: p.paddy, quantity: 10000, freeQuantity: 0, rate: 30, discount: 0, unitId: null, batchNo: null, expiryDate: null, mfgDate: null }],
    });

    // Production: 5,000 kg paddy produces 3,300 kg "মিনিকেট চাল ৫০ কেজি"
    // 3,300 kg / 50 kg = 66 packaging bags needed!
    const productionInput: ProductionInput = {
      date: D("2026-10-08"),
      reference: "MILL-BATCH-01",
      narration: "মিনিকেট চাল মিলিং ব্যাচ",
      recipeId: null,
      batches: 1,
      warehouseId,
      inputs: [{ productId: p.paddy, quantity: 5000, batchNo: null }],
      outputs: [
        { productId: p.rice, quantity: 3300, costShare: 90, batchNo: null, expiryDate: null },
        { productId: p.broken, quantity: 250, costShare: 4, batchNo: null, expiryDate: null },
        { productId: p.bran, quantity: 400, costShare: 4, batchNo: null, expiryDate: null },
        { productId: p.husk, quantity: 1000, costShare: 2, batchNo: null, expiryDate: null },
      ],
      extraCost: 2000,
      costAccountId: acc.CASH,
    };

    const runVoucher = await saveProduction(ctx, productionInput);
    expect(runVoucher.id).toBeDefined();

    // Verify 66 empty packaging bags were consumed!
    const bagProd = await prisma.product.findUniqueOrThrow({ where: { id: p.bag50 } });
    expect(Number(bagProd.stock)).toBe(1000 - 66); // 934 bags remaining

    // Verify bag consumption movement
    const bagMove = await prisma.stockMovement.findFirst({
      where: {
        voucherId: runVoucher.id,
        productId: p.bag50,
        type: "PRODUCTION_OUT",
      },
    });
    expect(bagMove).not.toBeNull();
    expect(Number(bagMove!.quantityOut)).toBe(66);
    expect(Number(bagMove!.unitCost)).toBe(45);

    // Verify bag cost (66 * 45 = 2,970 Tk) is included in materials cost of production
    // Total raw materials = 5,000 kg paddy @ 30 Tk (150,000 Tk) + 66 bags @ 45 Tk (2,970 Tk) = 152,970 Tk
    // Extra cost = 2,000 Tk -> Total Production Cost = 154,970 Tk
    // Rice cost share (90%): 154,970 * 0.90 = 139,473 Tk
    const riceMove = await prisma.stockMovement.findFirst({
      where: {
        voucherId: runVoucher.id,
        productId: p.rice,
        type: "PRODUCTION_IN",
      },
    });
    expect(riceMove).not.toBeNull();
    expect(Number(riceMove!.value)).toBeCloseTo(139473, 0);

    // Check bag summary
    const summary = await getPackagingBagSummary(ctx.businessId);
    expect(summary.totalPurchased).toBe(1000);
    expect(summary.totalConsumed).toBe(66);
    expect(summary.currentBalance).toBe(934);
    expect(summary.totalStockValue).toBe(934 * 45);
  });

  it("4. Recording wastage/damage reduces bag inventory and logs damage record", async () => {
    // Record 14 damaged bags
    const wastage = await recordPackagingBagWastage(ctx, {
      bagItemId: p.bagItem50Id,
      warehouseId,
      date: D("2026-10-09"),
      quantity: 14,
      reason: "ইঁদুরে কাটা ও ছেঁড়া বস্তা",
      notes: "গুদামের পেছনের লট থেকে পাওয়া গেছে",
    });

    expect(wastage.id).toBeDefined();
    expect(wastage.quantity).toBe(14);
    expect(Number(wastage.costAmount)).toBe(14 * 45);

    // Stock should now be 934 - 14 = 920
    const bagProd = await prisma.product.findUniqueOrThrow({ where: { id: p.bag50 } });
    expect(Number(bagProd.stock)).toBe(920);

    const summary = await getPackagingBagSummary(ctx.businessId);
    expect(summary.totalPurchased).toBe(1000);
    expect(summary.totalConsumed).toBe(66);
    expect(summary.totalWastage).toBe(14);
    expect(summary.currentBalance).toBe(920);
    expect(summary.totalStockValue).toBe(920 * 45);
    expect(summary.recentWastages.length).toBeGreaterThanOrEqual(1);
    expect(summary.recentWastages[0].quantity).toBe(14);
    expect(summary.recentWastages[0].reason).toBe("ইঁদুরে কাটা ও ছেঁড়া বস্তা");
  });

  it("5. Wastage validation prevents entering more bags than available in stock", async () => {
    await expect(
      recordPackagingBagWastage(ctx, {
        bagItemId: p.bagItem50Id,
        warehouseId,
        date: D("2026-10-10"),
        quantity: 5000, // exceeds available 920
        reason: "অতিরিক্ত সংখ্যা",
        notes: null,
      }),
    ).rejects.toThrow(/পর্যাপ্ত খালি বস্তা নেই/);
  });
});
