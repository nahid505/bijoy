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
import {
  acceptIntercompanyPurchaseAction,
  disputeIntercompanyPurchaseAction,
} from "@/server/actions/intercompany";
import { getContext, BUSINESS_COOKIE } from "@/server/auth";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { setOpeningStock } from "@/server/services/inventory";
import {
  getBilateralContraLedger,
  getIntercompanyReconciliationData,
} from "@/server/services/intercompany";

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

run("Inter-Company Mirror Engine & Reconciliation Dashboard", () => {
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

  it("automatically creates a draft purchase proposal in buyer entity when sales voucher is submitted", async () => {
    // 1. Create Seller (A) and Buyer (B) businesses
    const { ctx: sellerCtx, cookies: sellerCookies } = await newBusiness("রহিম ফিড মিলস (বিক্রেতা)");
    const { ctx: buyerCtx } = await newBusiness("রহিম পোল্ট্রি ফার্ম (ক্রেতা)");

    // 2. In Seller (A), create a customer representing Buyer (B) with sister concern link
    useSession(sellerCookies);
    req.cookies.set(BUSINESS_COOKIE, sellerCtx.business.id);

    const sisterCustomer = await saveParty(
      sellerCtx.svc,
      "CUSTOMER",
      {
        name: "রহিম পোল্ট্রি ফার্ম (অভ্যন্তরীণ)",
        mobile: freshMobile(),
        email: null,
        address: null,
        notes: null,
        openingBalance: 0,
        creditLimit: 0,
        creditDays: 0,
      }
    );

    // Link customer to buyer business
    await prisma.customer.update({
      where: { id: sisterCustomer.id },
      data: { isSisterConcern: true, linkedBusinessId: buyerCtx.business.id },
    });

    // 3. Create a product in Seller (A) and add initial stock
    const defaultUnitA = await prisma.unit.findFirstOrThrow({ where: { businessId: sellerCtx.business.id } });
    const productA = await saveProduct(sellerCtx.svc, {
      name: "ব্রয়লার ফিড ৫০ কেজি",
      code: "FEED-50KG",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: defaultUnitA.id,
      purchasePrice: 2400,
      salePrice: 2800,
      wholesalePrice: 0,
      minStock: 0,
      packSize: 1,
      depotCommissionRate: 0,
      trackBatch: false,
      openingStock: 100,
      openingRate: 2400,
    });

    // 4. Create a SALES voucher in Seller (A) to the sister concern customer
    const salesVoucher = await saveTradeVoucher(
      sellerCtx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: sisterCustomer.accountId,
        items: [tradeItem(productA, 10, 2800)],
      })
    );

    expect(salesVoucher.id).toBeTruthy();

    // 5. Verify Seller (A) sales voucher status
    const refreshedSale = await prisma.voucher.findUniqueOrThrow({ where: { id: salesVoucher.id } });
    expect(refreshedSale.isIntercompany).toBe(true);
    expect(refreshedSale.bilateralStatus).toBe("PENDING");
    expect(refreshedSale.intercompanyRefId).toBeTruthy();

    // 6. Verify Buyer (B) received the Draft Purchase Proposal
    const buyerProposal = await prisma.voucher.findFirst({
      where: {
        businessId: buyerCtx.business.id,
        intercompanyRefId: salesVoucher.id,
        type: "PURCHASE",
      },
      include: {
        items: { include: { product: true } },
      },
    });

    expect(buyerProposal).not.toBeNull();
    expect(buyerProposal!.isIntercompany).toBe(true);
    expect(buyerProposal!.bilateralStatus).toBe("PENDING");
    expect(buyerProposal!.verificationStatus).toBe("UNVERIFIED");
    expect(Number(buyerProposal!.amount)).toBe(28000);
    expect(buyerProposal!.items.length).toBe(1);
    expect(Number(buyerProposal!.items[0].quantity)).toBe(10);
    expect(Number(buyerProposal!.items[0].rate)).toBe(2800);
    expect(buyerProposal!.items[0].product.name).toBe("ব্রয়লার ফিড ৫০ কেজি");

    // CRITICAL: Verify that prior to acceptance, Buyer (B) has 0 stock movements and 0 journal entries!
    const buyerMovesCount = await prisma.stockMovement.count({ where: { voucherId: buyerProposal!.id } });
    const buyerJournalCount = await prisma.journalEntry.count({ where: { voucherId: buyerProposal!.id } });
    expect(buyerMovesCount).toBe(0);
    expect(buyerJournalCount).toBe(0);
  });

  it("buyer entity accepts purchase proposal: moves stock in and posts accounts payable ledger", async () => {
    const { ctx: sellerCtx, cookies: sellerCookies } = await newBusiness("আকিজ সিমেন্ট কারখানা");
    const { ctx: buyerCtx, cookies: buyerCookies } = await newBusiness("আকিজ ট্রেডিং কর্পোরেশন");

    // 1. Link customer in Seller to Buyer
    useSession(sellerCookies);
    req.cookies.set(BUSINESS_COOKIE, sellerCtx.business.id);

    const sisterCustomer = await saveParty(
      sellerCtx.svc,
      "CUSTOMER",
      {
        name: "আকিজ ট্রেডিং (আন্তঃপ্রতিষ্ঠান)",
        mobile: freshMobile(),
        email: null,
        address: null,
        notes: null,
        openingBalance: 0,
        creditLimit: 0,
        creditDays: 0,
      }
    );
    await prisma.customer.update({
      where: { id: sisterCustomer.id },
      data: { isSisterConcern: true, linkedBusinessId: buyerCtx.business.id },
    });

    // 2. Product and stock in Seller
    const defaultUnitA = await prisma.unit.findFirstOrThrow({ where: { businessId: sellerCtx.business.id } });
    const productA = await saveProduct(sellerCtx.svc, {
      name: "পোর্টল্যান্ড সিমেন্ট ৫০ কেজি",
      code: "CEMENT-50",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: defaultUnitA.id,
      purchasePrice: 460,
      salePrice: 520,
      wholesalePrice: 0,
      minStock: 0,
      packSize: 1,
      depotCommissionRate: 0,
      trackBatch: false,
      openingStock: 500,
      openingRate: 460,
    });

    // 3. Seller creates SALES voucher
    const salesVoucher = await saveTradeVoucher(
      sellerCtx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: sisterCustomer.accountId,
        items: [tradeItem(productA, 50, 520)],
      })
    );

    const buyerProposal = await prisma.voucher.findFirstOrThrow({
      where: {
        businessId: buyerCtx.business.id,
        intercompanyRefId: salesVoucher.id,
        type: "PURCHASE",
      },
    });

    // 4. Buyer accepts the purchase proposal
    useSession(buyerCookies);
    req.cookies.set(BUSINESS_COOKIE, buyerCtx.business.id);

    const acceptRes = await acceptIntercompanyPurchaseAction(
      null,
      form({ voucherId: buyerProposal.id })
    );

    expect(acceptRes?.ok).toBe(true);

    // 5. Verify Buyer voucher is now ACCEPTED and VERIFIED
    const refreshedBuyer = await prisma.voucher.findUniqueOrThrow({ where: { id: buyerProposal.id } });
    expect(refreshedBuyer.bilateralStatus).toBe("ACCEPTED");
    expect(refreshedBuyer.verificationStatus).toBe("VERIFIED");

    // 6. Verify Seller voucher is also marked ACCEPTED
    const refreshedSeller = await prisma.voucher.findUniqueOrThrow({ where: { id: salesVoucher.id } });
    expect(refreshedSeller.bilateralStatus).toBe("ACCEPTED");

    // 7. Verify Buyer now has Stock In movements and Journal Entries!
    const buyerMoves = await prisma.stockMovement.findMany({ where: { voucherId: buyerProposal.id } });
    expect(buyerMoves.length).toBeGreaterThan(0);
    expect(Number(buyerMoves[0].quantityIn)).toBe(50);

    const buyerEntries = await prisma.journalEntry.findMany({ where: { voucherId: buyerProposal.id } });
    expect(buyerEntries.length).toBeGreaterThan(0);
    const totalDebit = buyerEntries.reduce((s, e) => s + Number(e.debit), 0);
    const totalCredit = buyerEntries.reduce((s, e) => s + Number(e.credit), 0);
    expect(totalDebit).toBe(26000);
    expect(totalCredit).toBe(26000);
  });

  it("buyer entity disputes proposal: marks DISPUTED and prevents stock movements", async () => {
    const { ctx: sellerCtx, cookies: sellerCookies } = await newBusiness("মেঘনা ডেইরি মিলস");
    const { ctx: buyerCtx, cookies: buyerCookies } = await newBusiness("মেঘনা রিটেইল শপ");

    // Link customer in Seller to Buyer
    useSession(sellerCookies);
    req.cookies.set(BUSINESS_COOKIE, sellerCtx.business.id);

    const sisterCustomer = await saveParty(
      sellerCtx.svc,
      "CUSTOMER",
      {
        name: "মেঘনা রিটেইল শপ",
        mobile: freshMobile(),
        email: null,
        address: null,
        notes: null,
        openingBalance: 0,
        creditLimit: 0,
        creditDays: 0,
      }
    );
    await prisma.customer.update({
      where: { id: sisterCustomer.id },
      data: { isSisterConcern: true, linkedBusinessId: buyerCtx.business.id },
    });

    const defaultUnitA = await prisma.unit.findFirstOrThrow({ where: { businessId: sellerCtx.business.id } });
    const productA = await saveProduct(sellerCtx.svc, {
      name: "ফুল ক্রিম মিল্ক ১ লিটার",
      code: "MILK-1L",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: defaultUnitA.id,
      purchasePrice: 75,
      salePrice: 90,
      wholesalePrice: 0,
      minStock: 0,
      packSize: 1,
      depotCommissionRate: 0,
      trackBatch: false,
      openingStock: 200,
      openingRate: 75,
    });

    const salesVoucher = await saveTradeVoucher(
      sellerCtx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: sisterCustomer.accountId,
        items: [tradeItem(productA, 20, 90)],
      })
    );

    const buyerProposal = await prisma.voucher.findFirstOrThrow({
      where: {
        businessId: buyerCtx.business.id,
        intercompanyRefId: salesVoucher.id,
        type: "PURCHASE",
      },
    });

    // Buyer disputes proposal
    useSession(buyerCookies);
    req.cookies.set(BUSINESS_COOKIE, buyerCtx.business.id);

    const disputeRes = await disputeIntercompanyPurchaseAction(
      null,
      form({
        voucherId: buyerProposal.id,
        reason: "প্যাকেজিং ক্ষতিগ্রস্ত এবং ৫ বোতল লিক হয়েছে",
      })
    );

    expect(disputeRes?.ok).toBe(true);

    // Verify Buyer voucher status
    const refreshedBuyer = await prisma.voucher.findUniqueOrThrow({ where: { id: buyerProposal.id } });
    expect(refreshedBuyer.bilateralStatus).toBe("DISPUTED");
    expect(refreshedBuyer.verificationStatus).toBe("REJECTED");
    expect(refreshedBuyer.disputeReason).toBe("প্যাকেজিং ক্ষতিগ্রস্ত এবং ৫ বোতল লিক হয়েছে");

    // Verify Seller voucher status
    const refreshedSeller = await prisma.voucher.findUniqueOrThrow({ where: { id: salesVoucher.id } });
    expect(refreshedSeller.bilateralStatus).toBe("DISPUTED");
    expect(refreshedSeller.disputeReason).toBe("প্যাকেজিং ক্ষতিগ্রস্ত এবং ৫ বোতল লিক হয়েছে");

    // Verify 0 stock movements and 0 journal entries
    const buyerMovesCount = await prisma.stockMovement.count({ where: { voucherId: buyerProposal.id } });
    const buyerJournalCount = await prisma.journalEntry.count({ where: { voucherId: buyerProposal.id } });
    expect(buyerMovesCount).toBe(0);
    expect(buyerJournalCount).toBe(0);
  });

  it("reconciliation data and bilateral contra ledger calculate balances and variance", async () => {
    const { ctx: sellerCtx, cookies: sellerCookies } = await newBusiness("বেক্সিমকো টেক্সটাইল");
    const { ctx: buyerCtx, cookies: buyerCookies } = await newBusiness("বেক্সিমকো অ্যাপারেলস");

    useSession(sellerCookies);
    req.cookies.set(BUSINESS_COOKIE, sellerCtx.business.id);

    const sisterCustomer = await saveParty(
      sellerCtx.svc,
      "CUSTOMER",
      {
        name: "বেক্সিমকো অ্যাপারেলস",
        mobile: freshMobile(),
        email: null,
        address: null,
        notes: null,
        openingBalance: 0,
        creditLimit: 0,
        creditDays: 0,
      }
    );
    await prisma.customer.update({
      where: { id: sisterCustomer.id },
      data: { isSisterConcern: true, linkedBusinessId: buyerCtx.business.id },
    });

    const defaultUnitA = await prisma.unit.findFirstOrThrow({ where: { businessId: sellerCtx.business.id } });
    const productA = await saveProduct(sellerCtx.svc, {
      name: "কটন ফেব্রিক (রোল)",
      code: "FAB-001",
      barcode: null,
      categoryId: null,
      brandId: null,
      unitId: defaultUnitA.id,
      purchasePrice: 1200,
      salePrice: 1500,
      wholesalePrice: 0,
      minStock: 0,
      packSize: 1,
      depotCommissionRate: 0,
      trackBatch: false,
      openingStock: 100,
      openingRate: 1200,
    });

    // 1. First sale: 10 units = 15,000 BDT
    const sale1 = await saveTradeVoucher(
      sellerCtx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: sisterCustomer.accountId,
        items: [tradeItem(productA, 10, 1500)],
      })
    );

    // 2. Buyer accepts Sale 1
    const prop1 = await prisma.voucher.findFirstOrThrow({
      where: { businessId: buyerCtx.business.id, intercompanyRefId: sale1.id },
    });

    useSession(buyerCookies);
    req.cookies.set(BUSINESS_COOKIE, buyerCtx.business.id);
    await acceptIntercompanyPurchaseAction(null, form({ voucherId: prop1.id }));

    // 3. Second sale: 5 units = 7,500 BDT (Remains PENDING in Buyer)
    useSession(sellerCookies);
    req.cookies.set(BUSINESS_COOKIE, sellerCtx.business.id);
    await saveTradeVoucher(
      sellerCtx.svc,
      "SALES",
      tradeVoucherInput({
        partyAccountId: sisterCustomer.accountId,
        items: [tradeItem(productA, 5, 1500)],
      })
    );

    // 4. Verify reconciliation summary in Seller
    const reconData = await getIntercompanyReconciliationData(sellerCtx.business.id);
    expect(reconData.summary.total).toBe(2);
    expect(reconData.summary.accepted).toBe(1);
    expect(reconData.summary.pending).toBe(1);

    // 5. Bilateral Contra Ledger:
    // Seller has debited Buyer 15,000 + 7,500 = 22,500 (Receivable)
    // Buyer has accepted only 15,000 (Payable)
    // Variance = 7,500 (exact amount of unaccepted sale 2!)
    const contra = await getBilateralContraLedger(sellerCtx.business.id, buyerCtx.business.id);
    expect(contra.entityA.netBalance).toBe(22500);
    expect(contra.entityB.netBalance).toBe(15000);
    expect(contra.variance).toBe(7500);
    expect(contra.isReconciled).toBe(false);
  });
});
