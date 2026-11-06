import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma } from "@/lib/db";
import { registerAction } from "@/server/actions/auth";
import { acceptIntercompanyPurchaseAction } from "@/server/actions/intercompany";
import { getContext } from "@/server/auth";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import {
  getConsolidatedFinancials,
  exportConsolidatedFinancialsToXlsx,
  assertConsolidatedAccess,
} from "@/server/services/consolidatedFinancials";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";

let n = 0;
const freshMobile = () => `017${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;

async function call<T>(fn: () => Promise<T>) {
  try {
    return { value: await fn(), redirect: null as string | null };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { value: null, redirect: (e as { url: string }).url };
    throw e;
  }
}

const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) {
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  }
  return fd;
};

const useSession = (cookies: Map<string, string>) => {
  req.cookies = new Map(cookies);
};

const tradeItem = (productId: string, quantity: number, rate: number, discount = 0) => ({
  productId,
  quantity,
  rate,
  discount,
  unitId: null,
  batchNo: null,
  expiryDate: null,
  mfgDate: null,
});

const tradeVoucherInput = (data: Partial<any> & { partyAccountId: string; items: any[] }): any => ({
  date: new Date(),
  reference: null,
  narration: null,
  warehouseId: null,
  discount: 0,
  vatPercent: 0,
  dueDate: null,
  returnOfId: null,
  payments: [],
  ...data,
});

async function newBusiness(name: string) {
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  const mobile = freshMobile();
  const r = await call(() =>
    registerAction(
      null,
      form({
        businessName: name,
        ownerName: "মালিক",
        mobile,
        email: "",
        password: PASSWORD,
        confirmPassword: PASSWORD,
      })
    )
  );
  if (prev === undefined) delete process.env.REGISTRATION_OTP;
  else process.env.REGISTRATION_OTP = prev;
  expect(r.redirect).toBe("/dashboard");
  const ctx = (await getContext())!;
  return { ctx, ownerMobile: mobile, cookies: new Map(req.cookies) };
}

run("Consolidated Financials Engine & Automated Intercompany Elimination", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    if (process.env.TEST_DATABASE_URL) {
      await prisma.authThrottle.deleteMany({ where: { key: { startsWith: "register" } } });
    }
  });

  beforeEach(() => {
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
  });

  it("aggregates sister concerns, eliminates internal sales/purchases and contra balances accurately", async () => {
    // 1. Create Parent (Entity A) and Subsidiary (Entity B)
    const entityA = await newBusiness("কনসোলিডেটেড প্যারেন্ট কর্পোরেশন");
    const entityB = await newBusiness("কনসোলিডেটেড সিস্টার এন্টারপ্রাইজ");

    // 2. Create CompanyGroup and assign both businesses
    const group = await prisma.companyGroup.create({
      data: {
        name: "প্রিমিয়ার হোল্ডিংস গ্রুপ",
        code: `PHG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      },
    });

    await prisma.business.update({
      where: { id: entityA.ctx.business.id },
      data: { groupId: group.id, isParent: true, intercompanyCode: `PRNT-${Date.now()}` },
    });

    await prisma.business.update({
      where: { id: entityB.ctx.business.id },
      data: { groupId: group.id, isParent: false, intercompanyCode: `SIST-${Date.now()}` },
    });

    // 3. Setup Third-Party Transactions
    // 3.1 Entity A sells to external customer for 50,000 Tk (Cash)
    useSession(entityA.cookies);
    const defaultUnitA = await prisma.unit.findFirstOrThrow({ where: { businessId: entityA.ctx.business.id } });
    const productA = await saveProduct(entityA.ctx.svc, {
      name: "স্ট্যান্ডার্ড পণ্য এ",
      code: "PROD-A",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: defaultUnitA.id,
      purchasePrice: 400,
      salePrice: 500,
      wholesalePrice: 0,
      minStock: 0,
      packSize: 1,
      depotCommissionRate: 0,
      trackBatch: false,
      openingStock: 500,
      openingRate: 400,
    });

    const cashAccountA = await prisma.account.findFirstOrThrow({
      where: { businessId: entityA.ctx.business.id, kind: "CASH" },
    });

    const extCustomerA = await saveParty(entityA.ctx.svc, "CUSTOMER", {
      name: "বাহ্যিক ক্রেতা ১",
      mobile: freshMobile(),
      email: null,
      address: null,
      notes: null,
      openingBalance: 0,
      creditLimit: 0,
      creditDays: 0,
    });

    // External sale in Entity A: 100 qty * 500 = 50,000 Tk
    await saveTradeVoucher(
      entityA.ctx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: extCustomerA.accountId,
        items: [tradeItem(productA, 100, 500)],
        payments: [{ accountId: cashAccountA.id, reference: null, amount: 50000 }],
      })
    );

    // 3.2 Entity B buys from external supplier for 20,000 Tk (Credit)
    useSession(entityB.cookies);
    const defaultUnitB = await prisma.unit.findFirstOrThrow({ where: { businessId: entityB.ctx.business.id } });
    const productB = await saveProduct(entityB.ctx.svc, {
      name: "কাঁচামাল বি",
      code: "RAW-B",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: defaultUnitB.id,
      purchasePrice: 200,
      salePrice: 300,
      wholesalePrice: 0,
      minStock: 0,
      packSize: 1,
      depotCommissionRate: 0,
      trackBatch: false,
      openingStock: 0,
      openingRate: 200,
    });

    const extSupplierB = await saveParty(entityB.ctx.svc, "SUPPLIER", {
      name: "বাহ্যিক ভেন্ডর ১",
      mobile: freshMobile(),
      email: null,
      address: null,
      notes: null,
      openingBalance: 0,
      creditLimit: 0,
      creditDays: 0,
    });

    // External purchase in Entity B: 100 qty * 200 = 20,000 Tk (Credit)
    await saveTradeVoucher(
      entityB.ctx.svc,
      "PURCHASE",
      tradeVoucherInput({
        partyAccountId: extSupplierB.accountId,
        items: [tradeItem(productB, 100, 200)],
      })
    );

    // 4. Setup Intercompany Transaction: Entity A sells to Entity B for 30,000 Tk on credit
    useSession(entityA.cookies);
    const sisterCustomerA = await saveParty(entityA.ctx.svc, "CUSTOMER", {
      name: "সিস্টার এন্টারপ্রাইজ (অভ্যন্তরীণ গ্রাহক)",
      mobile: freshMobile(),
      email: null,
      address: null,
      notes: null,
      openingBalance: 0,
      creditLimit: 0,
      creditDays: 0,
    });

    await prisma.customer.update({
      where: { id: sisterCustomerA.id },
      data: { isSisterConcern: true, linkedBusinessId: entityB.ctx.business.id },
    });

    const intercompanySales = await saveTradeVoucher(
      entityA.ctx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: sisterCustomerA.accountId,
        items: [tradeItem(productA, 60, 500)],
      })
    );

    expect(intercompanySales.id).toBeTruthy();

    // 5. Accept the Intercompany Purchase in Entity B
    useSession(entityB.cookies);
    const buyerProposal = await prisma.voucher.findFirstOrThrow({
      where: {
        businessId: entityB.ctx.business.id,
        intercompanyRefId: intercompanySales.id,
        type: "PURCHASE",
      },
    });

    const defaultWarehouseB = await prisma.warehouse.findFirstOrThrow({
      where: { businessId: entityB.ctx.business.id },
    });

    const acceptRes = await acceptIntercompanyPurchaseAction(
      null,
      form({
        voucherId: buyerProposal.id,
        warehouseId: defaultWarehouseB.id,
      })
    );
    expect(acceptRes?.ok).toBe(true);

    // 6. Execute Consolidated Financials Engine
    const report = await getConsolidatedFinancials(entityA.ctx.business.id);

    // Verify Group & Entities
    expect(report.group?.name).toBe("প্রিমিয়ার হোল্ডিংস গ্রুপ");
    expect(report.entities.length).toBe(2);
    const entityIds = report.entities.map((e) => e.id);
    expect(entityIds).toContain(entityA.ctx.business.id);
    expect(entityIds).toContain(entityB.ctx.business.id);

    // 7. Verify Intercompany Sales & Purchase Elimination (P&L)
    // Entity A had 50,000 external + 30,000 intercompany = 80,000 raw sales
    expect(report.profitAndLoss.netSales.rawTotal).toBe(80000);
    // Elimination must be 30,000
    expect(report.profitAndLoss.netSales.elimination).toBe(30000);
    // Consolidated Sales must be 50,000 (only genuine external turnover)
    expect(report.profitAndLoss.netSales.consolidated).toBe(50000);

    // Entity A had 40,000 external COGS + 24,000 intercompany COGS = 64,000 raw COGS
    expect(report.profitAndLoss.costOfSales.rawTotal).toBe(64000);
    // Net elimination is -24,000 (-30,000 Cr purchase elimination + 6,000 Dr unrealized inventory profit per IFRS 10)
    expect(report.profitAndLoss.costOfSales.elimination).toBe(-24000);
    // Consolidated COGS must be 40,000 (true external cost of goods sold)
    expect(report.profitAndLoss.costOfSales.consolidated).toBe(40000);

    // Consolidated Gross Profit = 50,000 - 40,000 = 10,000 (genuine realized external profit)
    expect(report.profitAndLoss.grossProfit.consolidated).toBe(10000);

    // 8. Verify Intercompany Due-To / Due-From Contra Elimination (Balance Sheet)
    const dueFromLine = report.balanceSheet.assets.find((l) => l.category === "INTERCOMPANY_DUE_FROM");
    expect(dueFromLine).toBeDefined();
    expect(dueFromLine!.rawTotal).toBe(30000);
    expect(dueFromLine!.eliminationCr).toBe(30000);
    expect(dueFromLine!.consolidatedTotal).toBe(0); // Intercompany receivables eliminated to 0!

    const dueToLine = report.balanceSheet.liabilities.find((l) => l.category === "INTERCOMPANY_DUE_TO");
    expect(dueToLine).toBeDefined();
    expect(dueToLine!.rawTotal).toBe(30000);
    expect(dueToLine!.eliminationDr).toBe(30000);
    expect(dueToLine!.consolidatedTotal).toBe(0); // Intercompany payables eliminated to 0!

    // Verify Unrealized Inventory Profit eliminated from ending inventory (IFRS 10)
    const inventoryLine = report.balanceSheet.assets.find((l) => l.category === "INVENTORY");
    expect(inventoryLine).toBeDefined();
    expect(inventoryLine!.eliminationCr).toBe(6000);

    // 9. Verify Balance Sheet Equality
    expect(report.balanceSheet.isBalanced).toBe(true);
    expect(
      Math.abs(report.balanceSheet.totalAssets.consolidated - report.balanceSheet.totalLiabilitiesAndEquity.consolidated)
    ).toBeLessThan(0.05);

    // 10. Verify Elimination Audit Trail
    expect(report.eliminations.length).toBeGreaterThanOrEqual(3);
    const salesElim = report.eliminations.find((e) => e.type === "SALES_PURCHASE");
    expect(salesElim).toBeDefined();
    expect(salesElim!.amount).toBe(30000);

    const contraElim = report.eliminations.find((e) => e.type === "RECEIVABLE_PAYABLE");
    expect(contraElim).toBeDefined();
    expect(contraElim!.amount).toBe(30000);

    const unrealizedElim = report.eliminations.find((e) => e.type === "UNREALIZED_INVENTORY_PROFIT");
    expect(unrealizedElim).toBeDefined();
    expect(unrealizedElim!.amount).toBe(6000);

    // 11. Verify Consolidated Cash Flow Statement & NCI Breakdown
    expect(report.cashFlow).toBeDefined();
    expect(report.cashFlow!.operatingLines.length).toBeGreaterThan(0);
    expect(report.nciBreakdown).toBeDefined();
    expect(report.nciBreakdown!.subsidiaries.length).toBeGreaterThan(0);

    // 12. Verify Multi-Sheet Excel Export Generation
    const xlsxBuffer = await exportConsolidatedFinancialsToXlsx(report, "৳");
    expect(xlsxBuffer).toBeDefined();
    expect(xlsxBuffer.length).toBeGreaterThan(1000);
  });

  it("enforces permission guard correctly for Super Admin, Parent Owner, GROUP_AUDITOR, and non-auditor roles", () => {
    // 1. Super Admin is always allowed
    expect(() =>
      assertConsolidatedAccess({
        user: { isSuperAdmin: true },
        isOwner: false,
        roleName: "STAFF",
        group: null,
      })
    ).not.toThrow();

    // 2. Parent Company Owner is allowed
    expect(() =>
      assertConsolidatedAccess({
        user: { isSuperAdmin: false },
        isOwner: true,
        roleName: "Owner",
        group: { isParent: true, canConsolidate: true },
      })
    ).not.toThrow();

    // 3. User with GROUP_AUDITOR role is allowed
    expect(() =>
      assertConsolidatedAccess({
        user: { isSuperAdmin: false },
        isOwner: false,
        roleName: "GROUP_AUDITOR",
        group: { isParent: false, canConsolidate: true },
      })
    ).not.toThrow();

    // 4. Subsidiary Non-Owner or regular staff is refused
    expect(() =>
      assertConsolidatedAccess({
        user: { isSuperAdmin: false },
        isOwner: false,
        roleName: "ACCOUNTANT",
        group: { isParent: false, canConsolidate: false },
      })
    ).toThrow("কনসোলিডেটেড গ্রুপ রিপোর্ট দেখার অনুমতি শুধুমাত্র সুপার এডমিন");
  });
});
