import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { savePaddyPurchase } from "@/server/services/paddy";
import { searchParties } from "@/server/lookup";
import { loadVoucher } from "@/server/voucher-detail";
import {
  saveCompanyVehicle,
  getCompanyVehicles,
  getDriverTrips,
  getDriverTripsSummary,
  getUniqueDrivers,
  payDriverFare,
} from "@/server/services/logistics";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run("smart destination auto-fill & driver trip tracking (স্মার্ট ডেসটিনেশন ও ড্রাইভার ট্র্যাকিং)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let customer: { id: string; accountId: string };
  let supplier: { id: string; accountId: string };
  let productId: string;
  let companyVehicleId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Logistics Admin", email: `logistics_${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "বিজয় এগ্রো লজিস্টিকস", ownerUserId: user.id })
    );
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId } })).id;

    const unit = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "কেজি" } })).id;

    productId = await saveProduct(ctx, {
      name: "মিনিকেট চাল ৫০ কেজি",
      code: "MINIKET-50",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: unit,
      purchasePrice: 3000,
      salePrice: 3400,
      wholesalePrice: 3300,
      minStock: 10,
      openingStock: 500,
      openingRate: 3000,
      trackBatch: false,
    });

    customer = await saveParty(ctx, "CUSTOMER", {
      name: "মেসার্স রফিক ব্রাদার্স",
      mobile: "01711223344",
      email: null,
      address: "বীরগঞ্জ মোকাম, দিনাজপুর",
      notes: null,
      openingBalance: 0,
      creditLimit: 500000,
      creditDays: 30,
    });

    supplier = await saveParty(ctx, "SUPPLIER", {
      name: "মেসার্স সততা অটো মিল",
      mobile: "01811223344",
      email: null,
      address: "নওগাঁ মোকাম",
      notes: null,
      openingBalance: 0,
      creditLimit: 0,
      creditDays: 15,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. searchParties includes party address for destination auto-fill", async () => {
    const custResults = await searchParties(ctx.businessId, "CUSTOMER", "রফিক");
    expect(custResults.length).toBeGreaterThan(0);
    const hit = custResults.find((p) => p.partyId === customer.id);
    expect(hit).toBeDefined();
    expect(hit?.address).toBe("বীরগঞ্জ মোকাম, দিনাজপুর");

    const suppResults = await searchParties(ctx.businessId, "SUPPLIER", "সততা");
    expect(suppResults.length).toBeGreaterThan(0);
    const suppHit = suppResults.find((p) => p.partyId === supplier.id);
    expect(suppHit).toBeDefined();
    expect(suppHit?.address).toBe("নওগাঁ মোকাম");
  });

  it("2. can create and fetch company vehicles", async () => {
    const veh = await saveCompanyVehicle(ctx.businessId, {
      vehicleNo: "ঢাকা মেট্রো-ট ১১-৯৯৮৮",
      model: "আইশার ৫ টন",
      driverName: "আব্দুল করিম",
      driverMobile: "01722334455",
      isActive: true,
    });

    expect(veh.id).toBeDefined();
    expect(veh.vehicleNo).toBe("ঢাকা মেট্রো-ট ১১-৯৯৮৮");
    companyVehicleId = veh.id;

    const list = await getCompanyVehicles(ctx.businessId);
    expect(list.some((v) => v.vehicleNo === "ঢাকা মেট্রো-ট ১১-৯৯৮৮")).toBe(true);
  });

  it("3. creating sales voucher with logistics auto-creates DriverTrip", async () => {
    const voucher = await saveTradeVoucher(ctx, "SALES", {
      date: new Date(),
      reference: "CH-1001",
      narration: "চাল ডেলিভারি",
      partyAccountId: customer.accountId,
      warehouseId,
      returnOfId: null,
      dueDate: null,
      discount: 0,
      vatPercent: 0,
      destination: "বীরগঞ্জ মোকাম, দিনাজপুর",
      vehicleNo: "ঢাকা মেট্রো-ট ১১-৯৯৮৮",
      driverName: "আব্দুল করিম",
      driverMobile: "01722334455",
      transportFare: 3500,
      payments: [],
      items: [
        {
          productId,
          quantity: 20,
          rate: 3400,
          discount: 0,
          unitId: null,
          batchNo: null,
          expiryDate: null,
          mfgDate: null,
        },
      ],
    });

    expect(voucher.id).toBeDefined();
    expect(voucher.destination).toBe("বীরগঞ্জ মোকাম, দিনাজপুর");
    expect(voucher.vehicleNo).toBe("ঢাকা মেট্রো-ট ১১-৯৯৮৮");
    expect(voucher.driverName).toBe("আব্দুল করিম");
    expect(Number(voucher.transportFare)).toBe(3500);

    // Verify linked DriverTrip
    const trip = await prisma.driverTrip.findUnique({
      where: { voucherId: voucher.id },
    });
    expect(trip).toBeDefined();
    expect(trip?.driverName).toBe("আব্দুল করিম");
    expect(trip?.destination).toBe("বীরগঞ্জ মোকাম, দিনাজপুর");
    expect(Number(trip?.tripFare)).toBe(3500);
    expect(Number(trip?.paidAmount)).toBe(0);
    expect(trip?.paymentStatus).toBe("PENDING");
    expect(trip?.vehicleId).toBe(companyVehicleId);
  });

  it("4. summary reflects total trips, earned fare, and outstanding dues", async () => {
    // Add second trip for same driver
    await saveTradeVoucher(ctx, "SALES", {
      date: new Date(),
      reference: "CH-1002",
      narration: "দ্বিতীয় চালান",
      partyAccountId: customer.accountId,
      warehouseId,
      returnOfId: null,
      dueDate: null,
      discount: 0,
      vatPercent: 0,
      destination: "চিরিরবন্দর মোকাম",
      vehicleNo: "ঢাকা মেট্রো-ট ১১-৯৯৮৮",
      driverName: "আব্দুল করিম",
      driverMobile: "01722334455",
      transportFare: 2500,
      payments: [],
      items: [
        {
          productId,
          quantity: 15,
          rate: 3400,
          discount: 0,
          unitId: null,
          batchNo: null,
          expiryDate: null,
          mfgDate: null,
        },
      ],
    });

    const summary = await getDriverTripsSummary(ctx.businessId, "আব্দুল করিম");
    expect(summary.totalTrips).toBe(2);
    expect(summary.totalEarned).toBe(6000); // 3500 + 2500
    expect(summary.totalPaid).toBe(0);
    expect(summary.due).toBe(6000);

    const drivers = await getUniqueDrivers(ctx.businessId);
    expect(drivers.some((d) => d.driverName === "আব্দুল করিম")).toBe(true);
  });

  it("5. pays driver fare with FIFO trip adjustment and PAYMENT voucher", async () => {
    // Pay 4500 Tk (should fully pay Trip 1 of 3500 Tk and partially pay Trip 2 with 1000 Tk)
    const { voucher, payment } = await payDriverFare(ctx.businessId, ctx.userId, {
      driverName: "আব্দুল করিম",
      driverMobile: "01722334455",
      amount: 4500,
      cashAccountId: acc.CASH,
      date: new Date(),
      reference: "PAY-DRV-01",
      notes: "ড্রাইভার করিমকে ট্রিপ ভাড়া পরিশোধ",
    });

    expect(voucher.id).toBeDefined();
    expect(voucher.type).toBe("PAYMENT");
    expect(Number(voucher.amount)).toBe(4500);

    expect(payment.id).toBeDefined();
    expect(Number(payment.amount)).toBe(4500);

    // Verify FIFO adjustment on trips
    const { trips } = await getDriverTrips(ctx.businessId, { driverName: "আব্দুল করিম" });
    expect(trips.length).toBe(2);

    const oldestTrip = trips[1]; // ordered date desc, so index 1 is first trip
    const newerTrip = trips[0]; // index 0 is second trip

    expect(Number(oldestTrip.paidAmount)).toBe(3500);
    expect(oldestTrip.paymentStatus).toBe("PAID");

    expect(Number(newerTrip.paidAmount)).toBe(1000);
    expect(newerTrip.paymentStatus).toBe("PARTIAL");

    // Summary verification
    const summary = await getDriverTripsSummary(ctx.businessId, "আব্দুল করিম");
    expect(summary.totalEarned).toBe(6000);
    expect(summary.totalPaid).toBe(4500);
    expect(summary.due).toBe(1500);
  });

  it("6. loadVoucher returns logistics details for printing and display", async () => {
    const { trips } = await getDriverTrips(ctx.businessId, { driverName: "আব্দুল করিম" });
    const voucherId = trips[0].voucherId!;

    const loaded = await loadVoucher(ctx.businessId, voucherId);
    expect(loaded).toBeDefined();
    expect(loaded?.destination).toBe("চিরিরবন্দর মোকাম");
    expect(loaded?.vehicleNo).toBe("ঢাকা মেট্রো-ট ১১-৯৯৮৮");
    expect(loaded?.driverName).toBe("আব্দুল করিম");
    expect(Number(loaded?.transportFare)).toBe(2500);
  });

  it("7. paddy purchase creates driver trip, links company vehicle, and tracks fare", async () => {
    const unit = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "কেজি" } })).id;
    const paddyProd = await saveProduct(ctx, {
      name: "ধান - ব্রি ২৮",
      code: "PADDY-BR28",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: unit,
      purchasePrice: 1200,
      salePrice: 1400,
      wholesalePrice: 1300,
      minStock: 0,
      openingStock: 0,
      openingRate: 0,
      trackBatch: false,
    });

    const paddyVoucher = await savePaddyPurchase(ctx, {
      date: new Date(),
      reference: null,
      narration: null,
      partyAccountId: supplier.accountId,
      productId: paddyProd,
      warehouseId: null,
      batchNo: null,
      grossKg: 4000,
      dhaltaKg: 0,
      ratePerMon: 1200,
      paidAmount: 0,
      cashAccountId: null,
      notes: null,
      variety: "ব্রি ২৮",
      moisturePct: null,
      vehicleGrossKg: null,
      vehicleTareKg: null,
      juteBagQty: 50,
      plasticBagQty: 0,
      totalBags: 50,
      bagCount: 50,
      labourCost: 0,
      destination: "নওগাঁ মোকাম",
      vehicleNo: "ঢাকা মেট্রো-ট ১১-৯৯৮৮",
      driverName: "আব্দুল করিম",
      driverMobile: "01722334455",
      transportFare: 4000,
    });

    expect(paddyVoucher.id).toBeDefined();
    expect(paddyVoucher.destination).toBe("নওগাঁ মোকাম");
    expect(paddyVoucher.vehicleNo).toBe("ঢাকা মেট্রো-ট ১১-৯৯৮৮");
    expect(paddyVoucher.driverName).toBe("আব্দুল করিম");
    expect(Number(paddyVoucher.transportFare)).toBe(4000);

    const trip = await prisma.driverTrip.findFirst({
      where: { businessId: ctx.businessId, voucherId: paddyVoucher.id },
    });
    expect(trip).toBeDefined();
    expect(trip?.vehicleNo).toBe("ঢাকা মেট্রো-ট ১১-৯৯৮৮");
    expect(trip?.driverName).toBe("আব্দুল করিম");
    expect(trip?.destination).toBe("নওগাঁ মোকাম");
    expect(Number(trip?.tripFare)).toBe(4000);
    expect(trip?.vehicleId).toBe(companyVehicleId);
  });
});
