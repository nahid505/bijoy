import "server-only";

import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { round2, round3, round4 } from "@/lib/calc";
import { ciEquals } from "@/lib/dialect";
import { nextVoucherNo, systemAccounts, writeEntries, type Ctx, type Tx } from "./accounting";
import { lockProducts, writeMovements, type MovementInput } from "./inventory";
import { repostVoucher, revalueProducts } from "./posting";
import { audit } from "../audit";
import { withBypassTenantCheck } from "@/lib/tenant-isolation";
import type { BilateralStatus, Prisma } from "@prisma/client";

/**
 * Ensures that a Supplier record representing the Seller entity exists in the Buyer's business.
 * If not, creates an account in SUNDRY_CREDITORS and a linked Supplier.
 */
export async function ensureIntercompanySupplier(
  tx: Tx,
  buyerBusinessId: string,
  sellerBusinessId: string,
  sellerName: string
) {
  // 1. Look for existing linked supplier
  let supplier = await tx.supplier.findFirst({
    where: {
      businessId: buyerBusinessId,
      linkedBusinessId: sellerBusinessId,
      isActive: true,
    },
    include: { account: true },
  });

  if (supplier) return supplier;

  // 2. Check if a supplier exists with matching name
  supplier = await tx.supplier.findFirst({
    where: {
      businessId: buyerBusinessId,
      name: sellerName,
      isActive: true,
    },
    include: { account: true },
  });

  if (supplier) {
    // Upgrade existing supplier with sister concern link
    supplier = await tx.supplier.update({
      where: { id: supplier.id },
      data: { isSisterConcern: true, linkedBusinessId: sellerBusinessId },
      include: { account: true },
    });
    return supplier;
  }

  // 3. Create account under SUNDRY_CREDITORS
  const group = await tx.accountGroup.findFirst({
    where: { businessId: buyerBusinessId, systemKey: "SUNDRY_CREDITORS" },
  });
  if (!group) {
    throw new UserError("পাওনাদার হিসাব গ্রুপ (SUNDRY_CREDITORS) পাওয়া যায়নি");
  }

  const account = await tx.account.create({
    data: {
      businessId: buyerBusinessId,
      groupId: group.id,
      nature: group.nature,
      name: `${sellerName} (আন্তঃপ্রতিষ্ঠান)`,
      kind: "SUPPLIER",
      isSystem: false,
      isActive: true,
    },
  });

  // 4. Create supplier record
  supplier = await tx.supplier.create({
    data: {
      businessId: buyerBusinessId,
      name: sellerName,
      accountId: account.id,
      isSisterConcern: true,
      linkedBusinessId: sellerBusinessId,
      isActive: true,
    },
    include: { account: true },
  });

  return supplier;
}

/**
 * Ensures that a Customer record representing the Buyer entity exists in the Seller's business.
 * If not, creates an account in SUNDRY_DEBTORS and a linked Customer.
 */
export async function ensureIntercompanyCustomer(
  tx: Tx,
  sellerBusinessId: string,
  buyerBusinessId: string,
  buyerName: string
) {
  // 1. Look for existing linked customer
  let customer = await tx.customer.findFirst({
    where: {
      businessId: sellerBusinessId,
      linkedBusinessId: buyerBusinessId,
      isActive: true,
    },
    include: { account: true },
  });

  if (customer) return customer;

  // 2. Check if a customer exists with matching name
  customer = await tx.customer.findFirst({
    where: {
      businessId: sellerBusinessId,
      name: buyerName,
      isActive: true,
    },
    include: { account: true },
  });

  if (customer) {
    customer = await tx.customer.update({
      where: { id: customer.id },
      data: { isSisterConcern: true, linkedBusinessId: buyerBusinessId },
      include: { account: true },
    });
    return customer;
  }

  // 3. Create account under SUNDRY_DEBTORS
  const group = await tx.accountGroup.findFirst({
    where: { businessId: sellerBusinessId, systemKey: "SUNDRY_DEBTORS" },
  });
  if (!group) {
    throw new UserError("দেনাদার হিসাব গ্রুপ (SUNDRY_DEBTORS) পাওয়া যায়নি");
  }

  const account = await tx.account.create({
    data: {
      businessId: sellerBusinessId,
      groupId: group.id,
      nature: group.nature,
      name: `${buyerName} (আন্তঃপ্রতিষ্ঠান)`,
      kind: "CUSTOMER",
      isSystem: false,
      isActive: true,
    },
  });

  // 4. Create customer record
  customer = await tx.customer.create({
    data: {
      businessId: sellerBusinessId,
      name: buyerName,
      accountId: account.id,
      isSisterConcern: true,
      linkedBusinessId: buyerBusinessId,
      isActive: true,
    },
    include: { account: true },
  });

  return customer;
}

/**
 * Maps or creates a matching Product in the Buyer's business catalog.
 */
export async function mapOrCreateBuyerProduct(
  tx: Tx,
  buyerBusinessId: string,
  sourceProduct: { id: string; name: string; code: string | null; salePrice: Prisma.Decimal; unit?: { name: string } | null }
) {
  // 1. Search by code if available
  if (sourceProduct.code) {
    const existingByCode = await tx.product.findFirst({
      where: {
        businessId: buyerBusinessId,
        code: sourceProduct.code,
        isActive: true,
      },
      include: { unit: true },
    });
    if (existingByCode) return existingByCode;
  }

  // 2. Search by name (case-insensitive)
  const existingByName = await tx.product.findFirst({
    where: {
      businessId: buyerBusinessId,
      name: ciEquals(sourceProduct.name),
      isActive: true,
    },
    include: { unit: true },
  });
  if (existingByName) return existingByName;

  // 3. Find matching unit by name in buyer's business, or fallback to default
  let buyerUnit = sourceProduct.unit?.name
    ? await tx.unit.findFirst({
        where: { businessId: buyerBusinessId, name: ciEquals(sourceProduct.unit.name) },
      })
    : null;

  if (!buyerUnit) {
    buyerUnit = await tx.unit.findFirst({ where: { businessId: buyerBusinessId } });
  }

  if (!buyerUnit) {
    buyerUnit = await tx.unit.create({
      data: {
        businessId: buyerBusinessId,
        name: sourceProduct.unit?.name || "পিস",
        factor: 1,
      },
    });
  }

  // 4. Create product in buyer business
  return tx.product.create({
    data: {
      businessId: buyerBusinessId,
      name: sourceProduct.name,
      code: sourceProduct.code,
      unitId: buyerUnit.id,
      purchasePrice: sourceProduct.salePrice,
      salePrice: sourceProduct.salePrice,
      isActive: true,
    },
    include: { unit: true },
  });
}

/**
 * Inter-Company Mirror Engine:
 * When a SALES voucher is submitted to a sister concern customer,
 * this engine automatically creates a Draft Purchase Voucher (proposal) in the Buyer entity with PENDING_APPROVAL.
 */
export async function mirrorSalesToPurchaseProposal(
  tx: Tx,
  ctx: Ctx,
  salesVoucherId: string,
  buyerBusinessId: string
) {
  return withBypassTenantCheck(async () => {
    const salesVoucher = await tx.voucher.findUniqueOrThrow({
    where: { id: salesVoucherId },
    include: {
      business: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              code: true,
              salePrice: true,
              unit: { select: { name: true } },
            },
          },
          unit: true,
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });

  const sellerName = salesVoucher.business.name;
  const supplier = await ensureIntercompanySupplier(tx, buyerBusinessId, ctx.businessId, sellerName);

  // Default warehouse in buyer business
  const warehouse =
    (await tx.warehouse.findFirst({ where: { businessId: buyerBusinessId, isDefault: true } })) ||
    (await tx.warehouse.findFirst({ where: { businessId: buyerBusinessId } }));

  if (!warehouse) {
    throw new UserError("ক্রেতা প্রতিষ্ঠানে কোনো সক্রিয় গুদাম (Warehouse) পাওয়া যায়নি");
  }

  // Map each product to buyer business
  const mappedItems: Array<{
    buyerProduct: Awaited<ReturnType<typeof mapOrCreateBuyerProduct>>;
    sourceItem: (typeof salesVoucher.items)[number];
  }> = [];

  for (const item of salesVoucher.items) {
    const buyerProduct = await mapOrCreateBuyerProduct(tx, buyerBusinessId, item.product);
    mappedItems.push({ buyerProduct, sourceItem: item });
  }

  // Check if a proposal already exists for this sales voucher
  const existingProposal = await tx.voucher.findFirst({
    where: {
      businessId: buyerBusinessId,
      intercompanyRefId: salesVoucher.id,
      type: "PURCHASE",
    },
  });

  let purchaseVoucherId: string;

  if (existingProposal) {
    if (existingProposal.bilateralStatus === "ACCEPTED") {
      throw new UserError("এই আন্তঃপ্রতিষ্ঠান চালানের ক্রয় প্রস্তাবনা ইতোমধ্যে অনুমোদিত হয়েছে, আর সংশোধন করা যাবে না।");
    }

    // Update existing proposal
    await tx.voucherItem.deleteMany({ where: { voucherId: existingProposal.id } });

    await tx.voucher.update({
      where: { id: existingProposal.id },
      data: {
        date: salesVoucher.date,
        subtotal: salesVoucher.subtotal,
        discount: salesVoucher.discount,
        vatPercent: salesVoucher.vatPercent,
        vatAmount: salesVoucher.vatAmount,
        amount: salesVoucher.amount,
        reference: salesVoucher.voucherNo,
        narration: `আন্তঃপ্রতিষ্ঠান বিক্রয় প্রস্তাবনা (বিক্রেতা: ${sellerName}, চালান নং: ${salesVoucher.voucherNo})`,
        bilateralStatus: "PENDING",
        verificationStatus: "UNVERIFIED",
        disputeReason: null,
      },
    });

    purchaseVoucherId = existingProposal.id;
  } else {
    // Create new Draft Purchase Voucher
    const voucherNo = await nextVoucherNo(tx, buyerBusinessId, "PURCHASE");

    const newPurchase = await tx.voucher.create({
      data: {
        businessId: buyerBusinessId,
        type: "PURCHASE",
        voucherNo,
        date: salesVoucher.date,
        partyAccountId: supplier.accountId,
        warehouseId: warehouse.id,
        subtotal: salesVoucher.subtotal,
        discount: salesVoucher.discount,
        vatPercent: salesVoucher.vatPercent,
        vatAmount: salesVoucher.vatAmount,
        amount: salesVoucher.amount,
        paidAmount: 0,
        reference: salesVoucher.voucherNo,
        narration: `আন্তঃপ্রতিষ্ঠান বিক্রয় প্রস্তাবনা (বিক্রেতা: ${sellerName}, চালান নং: ${salesVoucher.voucherNo})`,
        createdById: ctx.userId,
        verificationStatus: "UNVERIFIED",
        isIntercompany: true,
        bilateralStatus: "PENDING",
        intercompanyRefId: salesVoucher.id,
      },
    });

    purchaseVoucherId = newPurchase.id;
  }

  // Create VoucherItems (Draft without stock movements or GL entries)
  await tx.voucherItem.createMany({
    data: mappedItems.map(({ buyerProduct, sourceItem }, index) => ({
      voucherId: purchaseVoucherId,
      productId: buyerProduct.id,
      warehouseId: warehouse.id,
      unitId: buyerProduct.unitId,
      unitFactor: 1,
      quantity: sourceItem.quantity,
      baseQuantity: sourceItem.baseQuantity,
      freeQuantity: sourceItem.freeQuantity,
      rate: sourceItem.rate,
      discount: sourceItem.discount,
      amount: sourceItem.amount,
      costRate: sourceItem.rate,
      costAmount: sourceItem.amount,
      batchNo: sourceItem.batchNo,
      expiryDate: sourceItem.expiryDate,
      lineNo: index,
    })),
  });

  // Link sales voucher with purchase proposal
  await tx.voucher.update({
    where: { id: salesVoucher.id },
    data: {
      isIntercompany: true,
      bilateralStatus: "PENDING",
      intercompanyRefId: purchaseVoucherId,
    },
  });

  await audit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    entity: "IntercompanyMirror",
    entityId: purchaseVoucherId,
    details: {
      salesVoucherId,
      salesVoucherNo: salesVoucher.voucherNo,
      buyerBusinessId,
      amount: Number(salesVoucher.amount),
    },
  });

    return { purchaseVoucherId };
  });
}

/**
 * Inter-Company Return Mirror Engine (Purchase Return -> Sales Return):
 * When a buyer returns goods to a sister concern supplier,
 * this engine automatically creates a Draft Sales Return Voucher (proposal) in the Seller entity with PENDING bilateral status.
 */
export async function mirrorPurchaseReturnToSalesReturnProposal(
  tx: Tx,
  ctx: Ctx,
  purchaseReturnVoucherId: string,
  sellerBusinessId: string
) {
  return withBypassTenantCheck(async () => {
    const returnVoucher = await tx.voucher.findUniqueOrThrow({
    where: { id: purchaseReturnVoucherId },
    include: {
      business: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: { id: true, name: true, code: true, salePrice: true, unit: { select: { name: true } } },
          },
          unit: true,
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });

  const buyerName = returnVoucher.business.name;
  const customer = await ensureIntercompanyCustomer(tx, sellerBusinessId, ctx.businessId, buyerName);

  const warehouse =
    (await tx.warehouse.findFirst({ where: { businessId: sellerBusinessId, isDefault: true } })) ||
    (await tx.warehouse.findFirst({ where: { businessId: sellerBusinessId } }));

  if (!warehouse) {
    throw new UserError("বিক্রেতা প্রতিষ্ঠানে কোনো সক্রিয় গুদাম (Warehouse) পাওয়া যায়নি");
  }

  const mappedItems: Array<{
    sellerProduct: Awaited<ReturnType<typeof mapOrCreateBuyerProduct>>;
    sourceItem: (typeof returnVoucher.items)[number];
  }> = [];

  for (const item of returnVoucher.items) {
    const sellerProduct = await mapOrCreateBuyerProduct(tx, sellerBusinessId, item.product);
    mappedItems.push({ sellerProduct, sourceItem: item });
  }

  const existingProposal = await tx.voucher.findFirst({
    where: {
      businessId: sellerBusinessId,
      intercompanyRefId: returnVoucher.id,
      type: "SALES_RETURN",
    },
  });

  let salesReturnVoucherId: string;

  if (existingProposal) {
    if (existingProposal.bilateralStatus === "ACCEPTED") {
      throw new UserError("এই আন্তঃপ্রতিষ্ঠান চালানের ফেরত প্রস্তাবনা ইতোমধ্যে অনুমোদিত হয়েছে।");
    }

    await tx.voucherItem.deleteMany({ where: { voucherId: existingProposal.id } });

    await tx.voucher.update({
      where: { id: existingProposal.id },
      data: {
        date: returnVoucher.date,
        subtotal: returnVoucher.subtotal,
        discount: returnVoucher.discount,
        vatPercent: returnVoucher.vatPercent,
        vatAmount: returnVoucher.vatAmount,
        amount: returnVoucher.amount,
        reference: returnVoucher.voucherNo,
        narration: `আন্তঃপ্রতিষ্ঠান বিক্রয় ফেরত প্রস্তাবনা (ক্রেতা: ${buyerName}, ক্রয় ফেরত চালান নং: ${returnVoucher.voucherNo})`,
        bilateralStatus: "PENDING",
        verificationStatus: "UNVERIFIED",
        disputeReason: null,
      },
    });

    salesReturnVoucherId = existingProposal.id;
  } else {
    const voucherNo = await nextVoucherNo(tx, sellerBusinessId, "SALES_RETURN");

    const newSalesReturn = await tx.voucher.create({
      data: {
        businessId: sellerBusinessId,
        type: "SALES_RETURN",
        voucherNo,
        date: returnVoucher.date,
        partyAccountId: customer.accountId,
        warehouseId: warehouse.id,
        subtotal: returnVoucher.subtotal,
        discount: returnVoucher.discount,
        vatPercent: returnVoucher.vatPercent,
        vatAmount: returnVoucher.vatAmount,
        amount: returnVoucher.amount,
        paidAmount: 0,
        reference: returnVoucher.voucherNo,
        narration: `আন্তঃপ্রতিষ্ঠান বিক্রয় ফেরত প্রস্তাবনা (ক্রেতা: ${buyerName}, ক্রয় ফেরত চালান নং: ${returnVoucher.voucherNo})`,
        createdById: ctx.userId,
        verificationStatus: "UNVERIFIED",
        isIntercompany: true,
        bilateralStatus: "PENDING",
        intercompanyRefId: returnVoucher.id,
      },
    });

    salesReturnVoucherId = newSalesReturn.id;
  }

  await tx.voucherItem.createMany({
    data: mappedItems.map(({ sellerProduct, sourceItem }, index) => ({
      voucherId: salesReturnVoucherId,
      productId: sellerProduct.id,
      warehouseId: warehouse.id,
      unitId: sellerProduct.unitId,
      unitFactor: 1,
      quantity: sourceItem.quantity,
      baseQuantity: sourceItem.baseQuantity,
      freeQuantity: sourceItem.freeQuantity,
      rate: sourceItem.rate,
      discount: sourceItem.discount,
      amount: sourceItem.amount,
      costRate: sourceItem.costRate,
      costAmount: sourceItem.costAmount,
      batchNo: sourceItem.batchNo,
      expiryDate: sourceItem.expiryDate,
      lineNo: index,
    })),
  });

  await audit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    entity: "IntercompanyMirror",
    entityId: salesReturnVoucherId,
    details: {
      purchaseReturnVoucherId,
      purchaseReturnVoucherNo: returnVoucher.voucherNo,
      sellerBusinessId,
      amount: Number(returnVoucher.amount),
    },
  });

    return { salesReturnVoucherId };
  });
}

/**
 * Accepts a pending inter-company proposal (Purchase or Return) on the recipient side:
 * - Allocates stock and writes stock movements (Stock IN / OUT based on voucher type).
 * - Posts general ledger entries.
 * - Marks bilateralStatus as ACCEPTED on both vouchers.
 */
export async function acceptIntercompanyProposal(
  tx: Tx,
  recipientCtx: Ctx,
  voucherId: string,
  opts: { warehouseId?: string } = {}
) {
  const voucher = await tx.voucher.findFirst({
    where: {
      id: voucherId,
      businessId: recipientCtx.businessId,
      type: { in: ["PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"] },
      isIntercompany: true,
    },
    include: {
      items: { include: { product: true } },
      business: { select: { id: true, name: true } },
    },
  });

  if (!voucher) {
    throw new UserError("আন্তঃপ্রতিষ্ঠান প্রস্তাবনাটি পাওয়া যায়নি");
  }

  if (voucher.bilateralStatus !== "PENDING") {
    throw new UserError(`এই প্রস্তাবনাটি ইতোমধ্যে '${voucher.bilateralStatus}' অবস্থায় রয়েছে`);
  }

  const warehouseId = opts.warehouseId || voucher.warehouseId;
  if (!warehouseId) {
    throw new UserError("স্টক ইন করার জন্য একটি গুদাম নির্ধারণ করুন");
  }

  const productIds = voucher.items.map((i) => i.productId);
  await lockProducts(tx, productIds);

  const subtotal = Number(voucher.subtotal);
  const totalAmount = Number(voucher.amount);
  const allocation = subtotal > 0 ? totalAmount / subtotal : 1;

  const moves: MovementInput[] = voucher.items.map((item) => {
    const baseQty = Number(item.baseQuantity) + Number(item.freeQuantity || 0);
    const lineAmount = Number(item.amount);
    const purchaseCost = baseQty > 0 ? (lineAmount * allocation) / baseQty : 0;

    return {
      productId: item.productId,
      warehouseId,
      voucherItemId: item.id,
      type: voucher.type as any,
      quantityIn: round3(baseQty),
      unitCost: round4(purchaseCost),
      batchNo: item.batchNo,
      expiryDate: item.expiryDate,
    };
  });

  // 1. Write stock movements
  await writeMovements(tx, recipientCtx, voucher, moves);

  // 2. Update product purchase rates for purchases
  if (voucher.type === "PURCHASE") {
    for (const item of voucher.items) {
      const rate = Number(item.rate);
      const factor = Number(item.unitFactor || 1);
      await tx.product.update({
        where: { id: item.productId },
        data: { purchasePrice: round2(rate / (factor > 0 ? factor : 1)) },
      });
    }
  }

  // 3. Revalue product stock costs
  await revalueProducts(tx, recipientCtx.businessId, productIds, { skipRepost: new Set([voucher.id]) });

  // 4. Post journal entries for this voucher
  await repostVoucher(tx, voucher.id);

  // 5. Update recipient voucher status to ACCEPTED and VERIFIED
  const now = new Date();
  await tx.voucher.update({
    where: { id: voucher.id },
    data: {
      warehouseId,
      bilateralStatus: "ACCEPTED",
      verificationStatus: "VERIFIED",
      verifiedById: recipientCtx.userId,
      verifiedAt: now,
      disputeReason: null,
    },
  });

  // 6. Update paired other-side voucher status to ACCEPTED
  const pairedRefId = voucher.intercompanyRefId;
  if (pairedRefId) {
    await withBypassTenantCheck(async () => {
      await tx.voucher.updateMany({
        where: {
          id: pairedRefId,
          isIntercompany: true,
        },
        data: {
          bilateralStatus: "ACCEPTED",
          disputeReason: null,
        },
      });
    });
  }

  await audit({
    businessId: recipientCtx.businessId,
    userId: recipientCtx.userId,
    action: "UPDATE",
    entity: "Voucher",
    entityId: voucher.id,
    details: {
      action: "INTERCOMPANY_PROPOSAL_ACCEPTED",
      voucherNo: voucher.voucherNo,
      linkedVoucherId: voucher.intercompanyRefId,
      type: voucher.type,
      amount: totalAmount,
    },
  });

  return { ok: true, voucherId: voucher.id };
}

export const acceptIntercompanyPurchase = acceptIntercompanyProposal;

/**
 * Disputes an inter-company proposal (Purchase or Return) on the recipient side:
 * - Marks bilateralStatus as DISPUTED on both vouchers.
 * - Stores disputeReason.
 * - No stock movement or journal entries are created.
 */
export async function disputeIntercompanyProposal(
  tx: Tx,
  ctx: Ctx,
  voucherId: string,
  reason: string
) {
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new UserError("সংশোধন অনুরোধের কারণ বা বিবরণ উল্লেখ করুন");
  }

  const voucher = await tx.voucher.findFirst({
    where: {
      id: voucherId,
      businessId: ctx.businessId,
      type: { in: ["PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"] },
      isIntercompany: true,
    },
  });

  if (!voucher) {
    throw new UserError("আন্তঃপ্রতিষ্ঠান প্রস্তাবনাটি পাওয়া যায়নি");
  }

  if (voucher.bilateralStatus === "ACCEPTED") {
    throw new UserError("ইতোমধ্যে অনুমোদিত চালান সরাসরি ডিসপিউট করা যাবে না");
  }

  const now = new Date();
  await tx.voucher.update({
    where: { id: voucher.id },
    data: {
      bilateralStatus: "DISPUTED",
      disputeReason: cleanReason,
      verificationStatus: "REJECTED",
      verificationNote: cleanReason,
      verifiedById: ctx.userId,
      verifiedAt: now,
    },
  });

  const pairedRefId = voucher.intercompanyRefId;
  if (pairedRefId) {
    await withBypassTenantCheck(async () => {
      await tx.voucher.updateMany({
        where: {
          id: pairedRefId,
          isIntercompany: true,
        },
        data: {
          bilateralStatus: "DISPUTED",
          disputeReason: cleanReason,
        },
      });
    });
  }

  await audit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    entity: "Voucher",
    entityId: voucher.id,
    details: {
      action: "INTERCOMPANY_PROPOSAL_DISPUTED",
      voucherNo: voucher.voucherNo,
      linkedVoucherId: voucher.intercompanyRefId,
      reason: cleanReason,
    },
  });

  return { ok: true, voucherId: voucher.id };
}

export const disputeIntercompanyPurchase = disputeIntercompanyProposal;

/**
 * Returns reconciliation data between sister concerns:
 * Invoices, proposal statuses, dispute notes, and summary statistics.
 */
export async function getIntercompanyReconciliationData(
  activeBusinessId: string,
  opts: {
    partnerBusinessId?: string;
    status?: BilateralStatus;
    from?: Date;
    to?: Date;
  } = {}
) {
  return withBypassTenantCheck(async () => {
    const whereClause: Prisma.VoucherWhereInput = {
    isIntercompany: true,
    ...(opts.status && opts.status !== "NONE" ? { bilateralStatus: opts.status } : {}),
    ...(opts.from || opts.to
      ? {
          date: {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {}),
          },
        }
      : {}),
  };

  if (opts.partnerBusinessId) {
    whereClause.OR = [
      { businessId: activeBusinessId, partyAccount: { customer: { linkedBusinessId: opts.partnerBusinessId } } },
      { businessId: activeBusinessId, partyAccount: { supplier: { linkedBusinessId: opts.partnerBusinessId } } },
      { businessId: opts.partnerBusinessId, partyAccount: { customer: { linkedBusinessId: activeBusinessId } } },
      { businessId: opts.partnerBusinessId, partyAccount: { supplier: { linkedBusinessId: activeBusinessId } } },
    ];
  } else {
    whereClause.businessId = activeBusinessId;
  }

  const vouchers = await prisma.voucher.findMany({
    where: whereClause,
    include: {
      business: { select: { id: true, name: true, intercompanyCode: true } },
      partyAccount: {
        select: {
          id: true,
          name: true,
          customer: { select: { id: true, isSisterConcern: true, linkedBusiness: { select: { id: true, name: true, intercompanyCode: true } } } },
          supplier: { select: { id: true, isSisterConcern: true, linkedBusiness: { select: { id: true, name: true, intercompanyCode: true } } } },
        },
      },
      items: {
        include: {
          product: { select: { name: true } },
          unit: { select: { name: true } },
        },
      },
    },
    orderBy: { date: "desc" },
    take: 100,
  });

  const summary = {
    total: vouchers.length,
    pending: vouchers.filter((v) => v.bilateralStatus === "PENDING").length,
    accepted: vouchers.filter((v) => v.bilateralStatus === "ACCEPTED").length,
    disputed: vouchers.filter((v) => v.bilateralStatus === "DISPUTED").length,
    totalVolume: vouchers.reduce((s, v) => s + Number(v.amount), 0),
  };

  const records = vouchers.map((v) => {
    const isSales = v.type === "SALES";
    const partner = isSales
      ? v.partyAccount?.customer?.linkedBusiness
      : v.partyAccount?.supplier?.linkedBusiness;

    const sellerName = isSales ? v.business.name : partner?.name || "সিস্টার কনসার্ন";
    const buyerName = isSales ? partner?.name || "সিস্টার কনসার্ন" : v.business.name;

    const canAccept = !isSales && v.businessId === activeBusinessId && v.bilateralStatus === "PENDING";
    const canDispute = !isSales && v.businessId === activeBusinessId && v.bilateralStatus === "PENDING";

    return {
      id: v.id,
      voucherNo: v.voucherNo,
      type: v.type,
      date: v.date,
      amount: Number(v.amount),
      subtotal: Number(v.subtotal),
      isSales,
      sellerName,
      buyerName,
      partnerBusinessId: partner?.id || null,
      bilateralStatus: v.bilateralStatus,
      disputeReason: v.disputeReason,
      intercompanyRefId: v.intercompanyRefId,
      canAccept,
      canDispute,
      items: v.items.map((i) => ({
        productName: i.product.name,
        quantity: Number(i.quantity),
        unitName: i.unit?.name || "",
        rate: Number(i.rate),
        amount: Number(i.amount),
      })),
    };
  });

    return { summary, records };
  });
}

/**
 * Bilateral Contra Ledger:
 * Reconciles the receivable ledger in Entity A with the payable ledger in Entity B,
 * computes variance (অমিল) and matched vs unmatched transactions.
 */
export async function getBilateralContraLedger(
  entityAId: string,
  entityBId: string,
  dateRange?: { from?: Date; to?: Date }
) {
  return withBypassTenantCheck(async () => {
    const [entityA, entityB] = await Promise.all([
    prisma.business.findUnique({ where: { id: entityAId }, select: { id: true, name: true, intercompanyCode: true, intercompanyCreditLimit: true } }),
    prisma.business.findUnique({ where: { id: entityBId }, select: { id: true, name: true, intercompanyCode: true, intercompanyCreditLimit: true } }),
  ]);

  if (!entityA || !entityB) {
    throw new UserError("সংশ্লিষ্ট প্রতিষ্ঠানদ্বয় খুঁজে পাওয়া যায়নি");
  }

  // 1. In Entity A, find partner account representing Entity B
  const [accountAAsCustomer, accountAAsSupplier] = await Promise.all([
    prisma.customer.findFirst({
      where: { businessId: entityAId, linkedBusinessId: entityBId },
      select: { accountId: true },
    }),
    prisma.supplier.findFirst({
      where: { businessId: entityAId, linkedBusinessId: entityBId },
      select: { accountId: true },
    }),
  ]);

  const accountAId = accountAAsCustomer?.accountId || accountAAsSupplier?.accountId;

  // 2. In Entity B, find partner account representing Entity A
  const [accountBAsSupplier, accountBAsCustomer] = await Promise.all([
    prisma.supplier.findFirst({
      where: { businessId: entityBId, linkedBusinessId: entityAId },
      select: { accountId: true },
    }),
    prisma.customer.findFirst({
      where: { businessId: entityBId, linkedBusinessId: entityAId },
      select: { accountId: true },
    }),
  ]);

  const accountBId = accountBAsSupplier?.accountId || accountBAsCustomer?.accountId;

  const dateFilter = dateRange?.from || dateRange?.to
    ? {
        date: {
          ...(dateRange?.from ? { gte: dateRange.from } : {}),
          ...(dateRange?.to ? { lte: dateRange.to } : {}),
        },
      }
    : {};

  // Fetch journal entries for both accounts
  const [entriesA, entriesB] = await Promise.all([
    accountAId
      ? prisma.journalEntry.findMany({
          where: { businessId: entityAId, accountId: accountAId, ...dateFilter },
          include: { voucher: { select: { id: true, voucherNo: true, type: true, bilateralStatus: true, intercompanyRefId: true } } },
          orderBy: { date: "asc" },
        })
      : [],
    accountBId
      ? prisma.journalEntry.findMany({
          where: { businessId: entityBId, accountId: accountBId, ...dateFilter },
          include: { voucher: { select: { id: true, voucherNo: true, type: true, bilateralStatus: true, intercompanyRefId: true } } },
          orderBy: { date: "asc" },
        })
      : [],
  ]);

  const totalDebitA = entriesA.reduce((s, e) => s + Number(e.debit), 0);
  const totalCreditA = entriesA.reduce((s, e) => s + Number(e.credit), 0);
  const netBalanceA = totalDebitA - totalCreditA; // Typically Debit (Receivable from B)

  const totalDebitB = entriesB.reduce((s, e) => s + Number(e.debit), 0);
  const totalCreditB = entriesB.reduce((s, e) => s + Number(e.credit), 0);
  const netBalanceB = totalCreditB - totalDebitB; // Typically Credit (Payable to A)

  const variance = round2(Math.abs(netBalanceA - netBalanceB));

  return {
    entityA: {
      ...entityA,
      totalDebit: round2(totalDebitA),
      totalCredit: round2(totalCreditA),
      netBalance: round2(netBalanceA),
      entriesCount: entriesA.length,
    },
    entityB: {
      ...entityB,
      totalDebit: round2(totalDebitB),
      totalCredit: round2(totalCreditB),
      netBalance: round2(netBalanceB),
      entriesCount: entriesB.length,
    },
    variance,
    isReconciled: variance < 0.01,
    exposure: {
      limit: Number(entityB.intercompanyCreditLimit ?? 0),
      currentDue: Math.max(0, netBalanceA),
      isOverLimit: Number(entityB.intercompanyCreditLimit ?? 0) > 0 && Math.max(0, netBalanceA) > Number(entityB.intercompanyCreditLimit),
      utilizationPct: Number(entityB.intercompanyCreditLimit ?? 0) > 0 ? round2((Math.max(0, netBalanceA) / Number(entityB.intercompanyCreditLimit)) * 100) : 0,
    },
    entriesA: entriesA.map((e) => ({
      id: e.id,
      date: e.date,
      voucherNo: e.voucher.voucherNo,
      type: e.voucher.type,
      debit: Number(e.debit),
      credit: Number(e.credit),
      narration: e.narration,
      bilateralStatus: e.voucher.bilateralStatus,
    })),
    entriesB: entriesB.map((e) => ({
      id: e.id,
      date: e.date,
      voucherNo: e.voucher.voucherNo,
      type: e.voucher.type,
      debit: Number(e.debit),
      credit: Number(e.credit),
      narration: e.narration,
      bilateralStatus: e.voucher.bilateralStatus,
    })),
    };
  });
}

// ───────────────────────────── 1-Click Intercompany Fund Transfer ─────────────────────────────

export interface IntercompanyFundTransferInput {
  senderBusinessId: string;
  receiverBusinessId: string;
  amount: number;
  senderAccountId: string;
  receiverAccountId: string;
  transferType?: "LOAN" | "ADVANCE" | "WORKING_CAPITAL" | "SETTLEMENT";
  reference?: string | null;
  narration?: string | null;
  userId: string;
}

/**
 * Ensures that an intercompany loan/advance ledger account exists for the counterparty.
 */
export async function ensureIntercompanyLoanAccount(
  tx: Tx,
  businessId: string,
  counterpartyBusinessId: string,
  counterpartyName: string,
  type: "ASSET" | "LIABILITY"
) {
  const accountName =
    type === "ASSET"
      ? `${counterpartyName} (আন্তঃপ্রতিষ্ঠান ঋণ/প্রাপ্য)`
      : `${counterpartyName} (আন্তঃপ্রতিষ্ঠান ঋণ/প্রদেয়)`;

  const existing = await tx.account.findFirst({
    where: {
      businessId,
      name: accountName,
      isActive: true,
    },
  });
  if (existing) return existing;

  const targetGroupKey = type === "ASSET" ? "LOANS_AND_ADVANCES" : "CURRENT_LIABILITIES";
  let group = await tx.accountGroup.findFirst({
    where: { businessId, systemKey: targetGroupKey },
  });

  if (!group) {
    const fallbackGroupKey = type === "ASSET" ? "SUNDRY_DEBTORS" : "SUNDRY_CREDITORS";
    group = await tx.accountGroup.findFirst({
      where: { businessId, systemKey: fallbackGroupKey },
    });
  }

  if (!group) {
    group = await tx.accountGroup.findFirst({
      where: { businessId, nature: type === "ASSET" ? "ASSET" : "LIABILITY" },
    });
  }

  if (!group) {
    throw new UserError(`${type === "ASSET" ? "সম্পদ" : "দায়"} হিসাব গ্রুপ পাওয়া যায়নি`);
  }

  return tx.account.create({
    data: {
      businessId,
      groupId: group.id,
      nature: group.nature,
      name: accountName,
      kind: type === "ASSET" ? "CUSTOMER" : "SUPPLIER",
      isSystem: false,
      isActive: true,
    },
  });
}

/**
 * 1-Click Inter-Company Fund Transfer Service:
 * Automatically posts balanced bilateral vouchers:
 * Sender:   Dr Intercompany Loan Asset, Cr Sender Bank/Cash
 * Receiver: Dr Receiver Bank/Cash,      Cr Intercompany Loan Liability
 */
export async function transferIntercompanyFunds(input: IntercompanyFundTransferInput) {
  const amount = round2(input.amount);
  if (amount <= 0) throw new UserError("স্থানান্তরের পরিমাণ ০ থেকে বেশি হতে হবে");
  if (input.senderBusinessId === input.receiverBusinessId) {
    throw new UserError("প্রেরক ও প্রাপক প্রতিষ্ঠান ভিন্ন হতে হবে");
  }

  return withBypassTenantCheck(async () => {
    return prisma.$transaction(async (tx) => {
    // 1. Validate both entities and ensure same group
    const [senderBiz, receiverBiz] = await Promise.all([
      tx.business.findUnique({
        where: { id: input.senderBusinessId },
        select: { id: true, name: true, groupId: true, isActive: true },
      }),
      tx.business.findUnique({
        where: { id: input.receiverBusinessId },
        select: { id: true, name: true, groupId: true, isActive: true },
      }),
    ]);

    if (!senderBiz || !senderBiz.isActive || !receiverBiz || !receiverBiz.isActive) {
      throw new UserError("প্রেরক বা প্রাপক প্রতিষ্ঠান খুঁজে পাওয়া যায়নি বা সক্রিয় নয়");
    }

    if (!senderBiz.groupId || senderBiz.groupId !== receiverBiz.groupId) {
      throw new UserError("উভয় প্রতিষ্ঠান একই কোম্পানি গ্রুপের অন্তর্ভুক্ত হতে হবে");
    }

    // 2. Validate sender bank/cash account
    const senderAcc = await tx.account.findFirst({
      where: { id: input.senderAccountId, businessId: input.senderBusinessId, isActive: true },
    });
    if (!senderAcc || !["CASH", "BANK"].includes(senderAcc.kind)) {
      throw new UserError("প্রেরক প্রতিষ্ঠানের বৈধ নগদ বা ব্যাংক হিসাব নির্বাচন করুন");
    }

    // 3. Validate receiver bank/cash account
    const receiverAcc = await tx.account.findFirst({
      where: { id: input.receiverAccountId, businessId: input.receiverBusinessId, isActive: true },
    });
    if (!receiverAcc || !["CASH", "BANK"].includes(receiverAcc.kind)) {
      throw new UserError("প্রাপক প্রতিষ্ঠানের বৈধ নগদ বা ব্যাংক হিসাব নির্বাচন করুন");
    }

    // 4. Ensure intercompany asset and liability accounts
    const senderIntercompanyAsset = await ensureIntercompanyLoanAccount(
      tx,
      input.senderBusinessId,
      input.receiverBusinessId,
      receiverBiz.name,
      "ASSET"
    );

    const receiverIntercompanyLiability = await ensureIntercompanyLoanAccount(
      tx,
      input.receiverBusinessId,
      input.senderBusinessId,
      senderBiz.name,
      "LIABILITY"
    );

    const typeLabel =
      input.transferType === "LOAN"
        ? "আন্তঃপ্রতিষ্ঠান ঋণ"
        : input.transferType === "ADVANCE"
        ? "আন্তঃপ্রতিষ্ঠান অগ্রিম"
        : input.transferType === "SETTLEMENT"
        ? "দ্বিপাক্ষিক সেটেলমেন্ট"
        : "চলতি মূলধন সহায়তা";

    const senderVoucherNo = await nextVoucherNo(tx, input.senderBusinessId, "PAYMENT");
    const receiverVoucherNo = await nextVoucherNo(tx, input.receiverBusinessId, "RECEIPT");

    const senderNarration = input.narration?.trim()
      ? `${typeLabel}: ${input.narration.trim()} (প্রাপক: ${receiverBiz.name})`
      : `${typeLabel} প্রদান (প্রাপক: ${receiverBiz.name}, রেফারেন্স: ${input.reference || "N/A"})`;

    const receiverNarration = input.narration?.trim()
      ? `${typeLabel}: ${input.narration.trim()} (প্রেরক: ${senderBiz.name})`
      : `${typeLabel} গ্রহণ (প্রেরক: ${senderBiz.name}, রেফারেন্স: ${input.reference || senderVoucherNo})`;

    const now = new Date();

    // 5. Create Sender Voucher (PAYMENT)
    const senderVoucher = await tx.voucher.create({
      data: {
        businessId: input.senderBusinessId,
        type: "PAYMENT",
        voucherNo: senderVoucherNo,
        date: now,
        partyAccountId: senderIntercompanyAsset.id,
        cashAccountId: senderAcc.id,
        amount,
        paidAmount: amount,
        reference: input.reference || receiverVoucherNo,
        narration: senderNarration,
        createdById: input.userId,
        verificationStatus: "VERIFIED",
        isIntercompany: true,
        bilateralStatus: "ACCEPTED",
      },
    });

    // 6. Create Receiver Voucher (RECEIPT)
    const receiverVoucher = await tx.voucher.create({
      data: {
        businessId: input.receiverBusinessId,
        type: "RECEIPT",
        voucherNo: receiverVoucherNo,
        date: now,
        partyAccountId: receiverIntercompanyLiability.id,
        cashAccountId: receiverAcc.id,
        amount,
        paidAmount: amount,
        reference: input.reference || senderVoucherNo,
        intercompanyRefId: senderVoucher.id,
        narration: receiverNarration,
        createdById: input.userId,
        verificationStatus: "VERIFIED",
        isIntercompany: true,
        bilateralStatus: "ACCEPTED",
      },
    });

    // Link sender to receiver
    await tx.voucher.update({
      where: { id: senderVoucher.id },
      data: { intercompanyRefId: receiverVoucher.id },
    });

    // 7. Write balanced journal entries for Sender: Dr Asset, Cr Cash/Bank
    await writeEntries(tx, senderVoucher, [
      { accountId: senderIntercompanyAsset.id, debit: amount, credit: 0, narration: senderNarration },
      { accountId: senderAcc.id, debit: 0, credit: amount, narration: senderNarration },
    ]);

    // 8. Write balanced journal entries for Receiver: Dr Cash/Bank, Cr Liability
    await writeEntries(tx, receiverVoucher, [
      { accountId: receiverAcc.id, debit: amount, credit: 0, narration: receiverNarration },
      { accountId: receiverIntercompanyLiability.id, debit: 0, credit: amount, narration: receiverNarration },
    ]);

    // 9. Audit in both businesses
    await Promise.all([
      audit({
        businessId: input.senderBusinessId,
        userId: input.userId,
        action: "CREATE",
        entity: "IntercompanyFundTransfer",
        entityId: senderVoucher.id,
        details: {
          voucherNo: senderVoucherNo,
          amount,
          transferType: input.transferType,
          receiverBusinessId: input.receiverBusinessId,
          receiverVoucherId: receiverVoucher.id,
        },
      }),
      audit({
        businessId: input.receiverBusinessId,
        userId: input.userId,
        action: "CREATE",
        entity: "IntercompanyFundTransfer",
        entityId: receiverVoucher.id,
        details: {
          voucherNo: receiverVoucherNo,
          amount,
          transferType: input.transferType,
          senderBusinessId: input.senderBusinessId,
          senderVoucherId: senderVoucher.id,
        },
      }),
    ]);

    return {
      success: true,
      senderVoucherId: senderVoucher.id,
      senderVoucherNo,
      receiverVoucherId: receiverVoucher.id,
      receiverVoucherNo,
      amount,
    };
  });
  });
}

/**
 * Lists cash & bank accounts for an entity.
 */
export async function listBusinessBankAccounts(businessId: string) {
  return prisma.account.findMany({
    where: {
      businessId,
      kind: { in: ["CASH", "BANK"] },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      kind: true,
      bankName: true,
      accountNumber: true,
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

