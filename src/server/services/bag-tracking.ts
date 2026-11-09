import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { Ctx, Tx } from "./accounting";
import type { BagReturnInput } from "@/lib/validation";

export const BAG_RETURN_COUNTER_KEY = "BAG_RETURN";
export const BAG_RETURN_PREFIX = "BRV";

/** Next atomic voucher number for empty bag returns: "BRV-000001". */
export async function nextBagReturnVoucherNo(tx: Tx, businessId: string): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { businessId_key: { businessId, key: BAG_RETURN_COUNTER_KEY } },
    create: { businessId, key: BAG_RETURN_COUNTER_KEY, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${BAG_RETURN_PREFIX}-${String(counter.value).padStart(6, "0")}`;
}

export interface SupplierBagBalance {
  supplier: { id: string; name: string; mobile: string | null; accountId: string } | null;
  receivedJuteBags: number;
  receivedPlasticBags: number;
  receivedTotalBags: number;
  returnedJuteBags: number;
  returnedPlasticBags: number;
  returnedTotalBags: number;
  dueJuteBags: number;
  duePlasticBags: number;
  dueTotalBags: number;
}

/**
 * Calculates empty bag ledger balance for a supplier:
 * - Total bags received via paddy purchases (চটের ও প্লাস্টিক বস্তা)
 * - Total bags returned via BagReturnVoucher
 * - Net pending bag balance (পাওনা বস্তা = গৃহীত - ফেরত)
 */
export async function getSupplierBagBalance(
  businessId: string,
  supplierIdOrAccountId: string
): Promise<SupplierBagBalance> {
  const supplier = await prisma.supplier.findFirst({
    where: {
      businessId,
      OR: [{ id: supplierIdOrAccountId }, { accountId: supplierIdOrAccountId }],
    },
    select: { id: true, name: true, mobile: true, accountId: true },
  });

  if (!supplier) {
    return {
      supplier: null,
      receivedJuteBags: 0,
      receivedPlasticBags: 0,
      receivedTotalBags: 0,
      returnedJuteBags: 0,
      returnedPlasticBags: 0,
      returnedTotalBags: 0,
      dueJuteBags: 0,
      duePlasticBags: 0,
      dueTotalBags: 0,
    };
  }

  // 1. All paddy purchases from this supplier
  const paddyPurchases = await prisma.paddyPurchase.findMany({
    where: {
      businessId,
      voucher: { partyAccountId: supplier.accountId },
    },
    select: {
      juteBagQty: true,
      plasticBagQty: true,
      totalBags: true,
      bagCount: true,
    },
  });

  let receivedJuteBags = 0;
  let receivedPlasticBags = 0;
  let receivedTotalBags = 0;

  for (const p of paddyPurchases) {
    const jute = p.juteBagQty ?? 0;
    const plastic = p.plasticBagQty ?? 0;
    const total = p.totalBags || (jute + plastic) || p.bagCount || 0;
    receivedJuteBags += jute;
    receivedPlasticBags += plastic;
    receivedTotalBags += total;
  }

  // 2. All bag returns to this supplier
  const returnSums = await prisma.bagReturnVoucher.aggregate({
    where: {
      businessId,
      supplierId: supplier.id,
    },
    _sum: {
      returnedJuteBags: true,
      returnedPlasticBags: true,
    },
  });

  const returnedJuteBags = returnSums._sum.returnedJuteBags ?? 0;
  const returnedPlasticBags = returnSums._sum.returnedPlasticBags ?? 0;
  const returnedTotalBags = returnedJuteBags + returnedPlasticBags;

  const dueJuteBags = receivedJuteBags - returnedJuteBags;
  const duePlasticBags = receivedPlasticBags - returnedPlasticBags;
  const dueTotalBags = receivedTotalBags - returnedTotalBags;

  return {
    supplier,
    receivedJuteBags,
    receivedPlasticBags,
    receivedTotalBags,
    returnedJuteBags,
    returnedPlasticBags,
    returnedTotalBags,
    dueJuteBags,
    duePlasticBags,
    dueTotalBags,
  };
}

/** Creates or updates a BagReturnVoucher (খালি বস্তা ফেরত চালান). */
export async function saveBagReturnVoucher(ctx: Ctx, input: BagReturnInput, editId?: string) {
  const supplier = await prisma.supplier.findFirst({
    where: {
      businessId: ctx.businessId,
      OR: [{ id: input.supplierId }, { accountId: input.supplierId }],
    },
  });
  if (!supplier) throw new UserError("সরবরাহকারী পাওয়া যায়নি");

  const totalReturn = input.returnedJuteBags + input.returnedPlasticBags;
  if (!(totalReturn > 0)) {
    throw new UserError("কমপক্ষে ১টি চটের বা প্লাস্টিক বস্তা ফেরত সংখ্যা দিন");
  }

  const date = new Date(input.date);
  if (isNaN(date.getTime())) throw new UserError("সঠিক তারিখ দিন");

  return prisma.$transaction(async (tx) => {
    if (editId) {
      const existing = await tx.bagReturnVoucher.findFirst({
        where: { id: editId, businessId: ctx.businessId },
      });
      if (!existing) throw new UserError("বস্তা ফেরত ভাউচার পাওয়া যায়নি");

      return tx.bagReturnVoucher.update({
        where: { id: editId },
        data: {
          date,
          supplierId: supplier.id,
          returnedJuteBags: input.returnedJuteBags,
          returnedPlasticBags: input.returnedPlasticBags,
          driverName: input.driverName || null,
          vehicleNo: input.vehicleNo || null,
          note: input.note || null,
        },
      });
    }

    const voucherNo = await nextBagReturnVoucherNo(tx, ctx.businessId);
    return tx.bagReturnVoucher.create({
      data: {
        businessId: ctx.businessId,
        voucherNo,
        date,
        supplierId: supplier.id,
        returnedJuteBags: input.returnedJuteBags,
        returnedPlasticBags: input.returnedPlasticBags,
        driverName: input.driverName || null,
        vehicleNo: input.vehicleNo || null,
        note: input.note || null,
        createdById: ctx.userId,
      },
    });
  });
}

/** Load a single bag return voucher by id. */
export async function getBagReturnVoucher(businessId: string, id: string) {
  return prisma.bagReturnVoucher.findFirst({
    where: { id, businessId },
    include: {
      supplier: {
        include: {
          account: { select: { id: true, name: true, code: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
      business: { select: { id: true, name: true, address: true, mobile: true } },
    },
  });
}

/** Lists bag return vouchers with optional date and supplier filter. */
export async function listBagReturnVouchers(
  businessId: string,
  opts: {
    from?: Date;
    to?: Date;
    supplierId?: string;
    skip?: number;
    take?: number;
  }
) {
  const where = {
    businessId,
    ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
    ...(opts.from || opts.to
      ? {
          date: {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total, sums] = await Promise.all([
    prisma.bagReturnVoucher.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: opts.skip ?? 0,
      take: opts.take ?? 50,
      include: {
        supplier: {
          select: { id: true, name: true, mobile: true },
        },
        createdBy: {
          select: { id: true, name: true },
        },
      },
    }),
    prisma.bagReturnVoucher.count({ where }),
    prisma.bagReturnVoucher.aggregate({
      where,
      _sum: {
        returnedJuteBags: true,
        returnedPlasticBags: true,
      },
    }),
  ]);

  const totalJute = sums._sum.returnedJuteBags ?? 0;
  const totalPlastic = sums._sum.returnedPlasticBags ?? 0;

  return {
    rows,
    total,
    sums: {
      jute: totalJute,
      plastic: totalPlastic,
      total: totalJute + totalPlastic,
    },
  };
}

/** Deletes a bag return voucher. */
export async function deleteBagReturnVoucher(ctx: Ctx, id: string) {
  const existing = await prisma.bagReturnVoucher.findFirst({
    where: { id, businessId: ctx.businessId },
  });
  if (!existing) throw new UserError("ভাউচার পাওয়া যায়নি");

  return prisma.bagReturnVoucher.delete({ where: { id: existing.id } });
}
