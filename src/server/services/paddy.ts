// Paddy purchase (rice mill weighbridge slip). One transaction creates / edits a normal PURCHASE voucher
// — supplier dues, cash, stock, ledger, returns and reports work as for every purchase — plus the
// slip details (PaddyPurchase).
//
//   voucher line: unit মণ (40 kg), quantity = mon (2 dp), rate = rate per mon → amount = mon × rate exactly
//   stock:        the exact net kg (gross − dhalta)
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { KG_PER_MON, paddyFigures } from "@/lib/paddy";
import type { PaddyPurchaseInput } from "@/lib/validation";
import { type Ctx, type Tx } from "./accounting";
import { tradeVoucherTx, TX_OPTIONS } from "./voucher";

const MON_UNIT = "মণ (৪০ কেজি)";

/** The business's মণ unit (40 × কেজি), created on first use. */
async function monUnit(tx: Tx, businessId: string, kgUnitId: string) {
  const found = await tx.unit.findFirst({ where: { businessId, baseUnitId: kgUnitId, factor: KG_PER_MON } });
  if (found) return found;
  return tx.unit.create({ data: { businessId, name: MON_UNIT, baseUnitId: kgUnitId, factor: KG_PER_MON } });
}

export async function savePaddyPurchase(ctx: Ctx, input: PaddyPurchaseInput, editId?: string) {
  const f = paddyFigures(input);
  if (!(f.mon > 0)) throw new UserError("নিট ওজন খুব কম — কমপক্ষে ০.০১ মণ হতে হবে");
  return prisma.$transaction(async (tx) => {
    if (editId && !(await tx.paddyPurchase.findFirst({ where: { voucherId: editId, businessId: ctx.businessId } }))) throw new UserError("ধান ক্রয়ের চালান পাওয়া যায়নি");
    const product = await tx.product.findFirst({ where: { id: input.productId, businessId: ctx.businessId }, include: { unit: true } });
    if (!product) throw new UserError("পণ্য পাওয়া যায়নি");
    // weights are in kg: the product's base unit must be কেজি (a root unit), so 1 মণ = 40 of it
    if (product.unit.baseUnitId || !/কেজি|kg/i.test(product.unit.name)) throw new UserError(`"${product.name}" এর মূল একক কেজি হতে হবে (এখন "${product.unit.name}")`);
    const unit = await monUnit(tx, ctx.businessId, product.unitId);

    const voucher = await tradeVoucherTx(tx, ctx, "PURCHASE", {
      date: input.date,
      reference: input.reference,
      narration: input.narration ?? input.notes,
      partyAccountId: input.partyAccountId,
      warehouseId: input.warehouseId,
      returnOfId: null,
      dueDate: null,
      discount: 0,
      vatPercent: 0,
      // with a supplier: what was paid now (the rest is owed to the supplier); cash purchase: paid in full
      payments: !input.cashAccountId ? []
        : input.partyAccountId ? (input.paidAmount > 0 ? [{ accountId: input.cashAccountId, amount: input.paidAmount, reference: null }] : [])
        : [{ accountId: input.cashAccountId, amount: f.totalPrice, reference: null }],
      items: [{ productId: product.id, unitId: unit.id, quantity: f.mon, rate: input.ratePerMon, discount: 0, batchNo: input.batchNo, expiryDate: null, mfgDate: null, baseQuantity: f.netKg }],
    }, editId);

    const data = { bagCount: input.bagCount, grossKg: input.grossKg, dhaltaKg: input.dhaltaKg, netKg: f.netKg, mon: f.mon, ratePerMon: input.ratePerMon, totalPrice: f.totalPrice, notes: input.notes };
    await tx.paddyPurchase.upsert({ where: { voucherId: voucher.id }, create: { ...data, voucherId: voucher.id, businessId: ctx.businessId }, update: data });
    return voucher;
  }, TX_OPTIONS);
}

export async function loadPaddyPurchase(businessId: string, voucherId: string) {
  return prisma.paddyPurchase.findFirst({
    where: { voucherId, businessId },
    include: {
      voucher: {
        include: {
          partyAccount: { select: { id: true, name: true } },
          payments: { include: { account: { select: { id: true, name: true } } } },
          items: { include: { product: { select: { id: true, name: true, code: true, barcode: true, unitId: true, salePrice: true, wholesalePrice: true, purchasePrice: true, avgCost: true, stock: true, trackBatch: true } } } },
        },
      },
    },
  });
}

export async function listPaddyPurchases(businessId: string, opts: { from?: Date; to?: Date; skip: number; take: number }) {
  const where = {
    businessId,
    ...(opts.from || opts.to ? { voucher: { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } } : {}),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.paddyPurchase.findMany({ where, orderBy: [{ voucher: { date: "desc" } }, { createdAt: "desc" }], skip: opts.skip, take: opts.take, include: { voucher: { select: { id: true, voucherNo: true, date: true, paidAmount: true, partyAccount: { select: { name: true } } } } } }),
    prisma.paddyPurchase.count({ where }),
    prisma.paddyPurchase.aggregate({ where, _sum: { bagCount: true, netKg: true, mon: true, totalPrice: true } }),
  ]);
  return { rows, total, sums: { bags: sums._sum.bagCount ?? 0, netKg: num(sums._sum.netKg), mon: num(sums._sum.mon), total: num(sums._sum.totalPrice) } };
}

/** Default paddy product (named "ধান") for the form, if the business has one. */
export async function defaultPaddyProduct(businessId: string) {
  return prisma.product.findFirst({
    where: { businessId, isActive: true, name: { startsWith: "ধান" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, code: true, barcode: true, unitId: true, salePrice: true, wholesalePrice: true, purchasePrice: true, avgCost: true, stock: true, trackBatch: true },
  });
}
