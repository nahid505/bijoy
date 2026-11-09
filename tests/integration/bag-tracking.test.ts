import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { paddyPurchaseSchema, bagReturnSchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { createRiceMillTemplate } from "@/server/services/production";
import { savePaddyPurchase } from "@/server/services/paddy";
import {
  deleteBagReturnVoucher,
  getBagReturnVoucher,
  getSupplierBagBalance,
  listBagReturnVouchers,
  saveBagReturnVoucher,
} from "@/server/services/bag-tracking";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run("empty bag ledger & return management (খালি বস্তা ট্র্যাকিং ও ফেরত)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let paddyId: string;
  let supplier: { id: string; accountId: string };
  let returnVoucherId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Mill Owner", email: `mill_bags_${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "বিজয় অটো রাইস মিল", ownerUserId: user.id })
    );
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;
    await createRiceMillTemplate(ctx);
    paddyId = (
      await prisma.product.findFirstOrThrow({
        where: { businessId: ctx.businessId, name: { startsWith: "ধান" } },
      })
    ).id;
    supplier = await saveParty(ctx, "SUPPLIER", {
      name: "কৃষক জমির আলী",
      mobile: "01711000111",
      email: null,
      address: "দিনাজপুর",
      notes: null,
      openingBalance: 0,
      creditLimit: 0,
      creditDays: 0,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts with 0 bags received and 0 bags due", async () => {
    const bal = await getSupplierBagBalance(ctx.businessId, supplier.id);
    expect(bal.receivedJuteBags).toBe(0);
    expect(bal.receivedPlasticBags).toBe(0);
    expect(bal.receivedTotalBags).toBe(0);
    expect(bal.dueJuteBags).toBe(0);
    expect(bal.duePlasticBags).toBe(0);
    expect(bal.dueTotalBags).toBe(0);
  });

  it("tracks jute and plastic bags when recording paddy purchase", async () => {
    const input = paddyPurchaseSchema.parse({
      date: "2026-11-01",
      productId: paddyId,
      warehouseId,
      partyAccountId: supplier.accountId,
      juteBagQty: 50,
      plasticBagQty: 30,
      grossKg: 3200,
      dhaltaKg: 20,
      ratePerMon: 1300,
      paidAmount: 20000,
      cashAccountId: acc.CASH,
      notes: "ট্রাক ঢাকা মেট্রো-ট ১১-২২৩৩",
    });

    const voucher = await savePaddyPurchase(ctx, input);
    const pp = await prisma.paddyPurchase.findUniqueOrThrow({ where: { voucherId: voucher.id } });

    expect(pp.juteBagQty).toBe(50);
    expect(pp.plasticBagQty).toBe(30);
    expect(pp.totalBags).toBe(80);
    expect(pp.bagCount).toBe(80);

    const bal = await getSupplierBagBalance(ctx.businessId, supplier.id);
    expect(bal.receivedJuteBags).toBe(50);
    expect(bal.receivedPlasticBags).toBe(30);
    expect(bal.receivedTotalBags).toBe(80);
    expect(bal.returnedTotalBags).toBe(0);
    expect(bal.dueJuteBags).toBe(50);
    expect(bal.duePlasticBags).toBe(30);
    expect(bal.dueTotalBags).toBe(80);
  });

  it("accumulates multiple paddy purchases into bag balance", async () => {
    const input2 = paddyPurchaseSchema.parse({
      date: "2026-11-02",
      productId: paddyId,
      warehouseId,
      partyAccountId: supplier.accountId,
      juteBagQty: 25,
      plasticBagQty: 15,
      grossKg: 1600,
      dhaltaKg: 10,
      ratePerMon: 1300,
      paidAmount: 10000,
      cashAccountId: acc.CASH,
    });

    await savePaddyPurchase(ctx, input2);

    const bal = await getSupplierBagBalance(ctx.businessId, supplier.id);
    expect(bal.receivedJuteBags).toBe(75); // 50 + 25
    expect(bal.receivedPlasticBags).toBe(45); // 30 + 15
    expect(bal.receivedTotalBags).toBe(120);
    expect(bal.dueJuteBags).toBe(75);
    expect(bal.duePlasticBags).toBe(45);
    expect(bal.dueTotalBags).toBe(120);
  });

  it("records an empty bag return voucher (BagReturnVoucher) and reduces pending bag balance", async () => {
    const returnInput = bagReturnSchema.parse({
      date: "2026-11-03",
      supplierId: supplier.id,
      returnedJuteBags: 40,
      returnedPlasticBags: 20,
      driverName: "আনোয়ার",
      vehicleNo: "পিকআপ বগুড়া-ন ১২৩৪",
      note: "আংশিক বস্তা ফেরত প্রদান",
    });

    const voucher = await saveBagReturnVoucher(ctx, returnInput);
    returnVoucherId = voucher.id;

    expect(voucher.voucherNo).toMatch(/^BRV-\d{6}$/);
    expect(voucher.returnedJuteBags).toBe(40);
    expect(voucher.returnedPlasticBags).toBe(20);
    expect(voucher.driverName).toBe("আনোয়ার");

    // Balance after return:
    // Jute: 75 received - 40 returned = 35 due
    // Plastic: 45 received - 20 returned = 25 due
    // Total due = 60
    const bal = await getSupplierBagBalance(ctx.businessId, supplier.id);
    expect(bal.returnedJuteBags).toBe(40);
    expect(bal.returnedPlasticBags).toBe(20);
    expect(bal.returnedTotalBags).toBe(60);
    expect(bal.dueJuteBags).toBe(35);
    expect(bal.duePlasticBags).toBe(25);
    expect(bal.dueTotalBags).toBe(60);
  });

  it("lists bag return vouchers and provides correct sums", async () => {
    const list = await listBagReturnVouchers(ctx.businessId, { supplierId: supplier.id });
    expect(list.total).toBe(1);
    expect(list.sums.jute).toBe(40);
    expect(list.sums.plastic).toBe(20);
    expect(list.sums.total).toBe(60);
    expect(list.rows[0].supplier.name).toBe("কৃষক জমির আলী");
  });

  it("loads a bag return voucher with relations for print / detail", async () => {
    const v = await getBagReturnVoucher(ctx.businessId, returnVoucherId);
    expect(v).not.toBeNull();
    expect(v?.supplier.name).toBe("কৃষক জমির আলী");
    expect(v?.business.name).toBe("বিজয় অটো রাইস মিল");
    expect(v?.createdBy.name).toBe("Mill Owner");
  });

  it("deleting a return voucher restores the pending bag balance", async () => {
    await deleteBagReturnVoucher(ctx, returnVoucherId);

    const bal = await getSupplierBagBalance(ctx.businessId, supplier.id);
    expect(bal.returnedTotalBags).toBe(0);
    expect(bal.dueJuteBags).toBe(75);
    expect(bal.duePlasticBags).toBe(45);
    expect(bal.dueTotalBags).toBe(120);
  });

  it("bag return permissions are included in RICE_MILL_PERMISSIONS and respect hasPermission", async () => {
    const { RICE_MILL_PERMISSIONS, hasPermission } = await import("@/lib/permissions");
    expect(RICE_MILL_PERMISSIONS).toContain("auto_rice_mill:bag_return:view");
    expect(RICE_MILL_PERMISSIONS).toContain("auto_rice_mill:bag_return:create");

    // Role with only bag_return:view
    expect(hasPermission(["auto_rice_mill:bag_return:view"], "auto_rice_mill:bag_return:view")).toBe(true);
    expect(hasPermission(["auto_rice_mill:bag_return:view"], "auto_rice_mill:bag_return:create")).toBe(false);

    // Role with only bag_return:create (create implies view)
    expect(hasPermission(["auto_rice_mill:bag_return:create"], "auto_rice_mill:bag_return:create")).toBe(true);
    expect(hasPermission(["auto_rice_mill:bag_return:create"], "auto_rice_mill:bag_return:view")).toBe(true);

    // Role with no bag return permission
    expect(hasPermission(["purchases:view"], "auto_rice_mill:bag_return:view")).toBe(false);
    expect(hasPermission(["purchases:view"], "auto_rice_mill:bag_return:create")).toBe(false);

    // Super admin wildcard
    expect(hasPermission(["*"], "auto_rice_mill:bag_return:view")).toBe(true);
    expect(hasPermission(["*"], "auto_rice_mill:bag_return:create")).toBe(true);
  });
});

