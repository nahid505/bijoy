// VoucherService — creates, edits (reverse & repost) and deletes every voucher type.
// Each public function runs in ONE database transaction: header, lines, payments, stock
// movements and journal entries are saved together or not at all. After any stock change
// the affected products are revalued over their whole timeline (see posting.ts), so
// backdated documents correctly change later costs of goods sold.
import { randomUUID } from "node:crypto";
import type { StockMovementType, VoucherType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { journalLinesFromInput, paidOf, paymentEntries, receiptEntries, unitConversionFactor } from "@/lib/accounting";
import { computeTotals, lineAmount, round2, round3, round4 } from "@/lib/calc";
import { formatMoney } from "@/lib/format";
import { UserError } from "@/lib/errors";
import type { CashVoucherInput, JournalVoucherInput, StockJournalInput, TradeVoucherInput } from "@/lib/validation";
import { assertAccounts, assertBookAccounts, assertNotLocked, nextVoucherNo, writeEntries, type Ctx, type Tx } from "./accounting";
import { assertBookProducts, defaultWarehouseId, lockProducts, writeMovements, type MovementInput } from "./inventory";
import { repostVoucher, revalueProducts } from "./posting";
import { allocateSaleBatches, ensureInboundBatch, expiryLossAccount, requireBatch, type BatchAllocation } from "./batches";
import type { BookKey } from "@/lib/book";
import { TRANSFER_SOURCE } from "@/lib/depot";

export const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/** Vouchers created by the payroll module (posting, salary payment, advance) are changed only there. */
export const isPayrollVoucher = (sourceKey: string | null | undefined) => !!sourceKey?.startsWith("payroll:");
export const PAYROLL_VOUCHER_MESSAGE = "এই ভাউচার বেতন (Payroll) মডিউল থেকে তৈরি — সেখান থেকে পরিবর্তন বা বাতিল করুন";
/** a paddy slip's labour payment (sourceKey paddy-labour:<purchase voucher id>) — changed / deleted with the slip only */
export const isPaddyLabourVoucher = (sourceKey: string | null | undefined) => !!sourceKey?.startsWith("paddy-labour:");
const PADDY_LABOUR_MESSAGE = "এই ভাউচার ধান ক্রয়ের স্লিপের লেবার খরচ — স্লিপ থেকে পরিবর্তন বা মুছুন";

export type TradeType = "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";

const TRADE_RULES: Record<TradeType, { partyKind: "CUSTOMER" | "SUPPLIER"; stock: "in" | "out"; movement: StockMovementType; returnOf?: VoucherType }> = {
  SALES: { partyKind: "CUSTOMER", stock: "out", movement: "SALE" },
  SALES_RETURN: { partyKind: "CUSTOMER", stock: "in", movement: "SALES_RETURN", returnOf: "SALES" },
  PURCHASE: { partyKind: "SUPPLIER", stock: "in", movement: "PURCHASE" },
  PURCHASE_RETURN: { partyKind: "SUPPLIER", stock: "out", movement: "PURCHASE_RETURN", returnOf: "PURCHASE" },
};

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
};

// ───────────────────────── shared helpers ─────────────────────────

export async function loadEditable(tx: Tx, ctx: Ctx, id: string, type: VoucherType) {
  const v = await tx.voucher.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!v) throw new UserError("ভাউচার পাওয়া যায়নি");
  if (v.type !== type) throw new UserError("ভাউচারের ধরন মিলছে না");
  if (isPayrollVoucher(v.sourceKey)) throw new UserError(PAYROLL_VOUCHER_MESSAGE);
  if (isPaddyLabourVoucher(v.sourceKey)) throw new UserError(PADDY_LABOUR_MESSAGE);
  if (v.sourceKey?.startsWith(TRANSFER_SOURCE)) throw new UserError("ডিপো কমিশন স্থানান্তর সম্পাদনা করা যায় না — মুছে আবার স্থানান্তর করুন");
  return v;
}

/** Removes entries, lines (and their stock movements) and payments; returns products touched. */
export async function clearPostings(tx: Tx, voucherId: string) {
  const moves = await tx.stockMovement.findMany({ where: { voucherId }, select: { productId: true } });
  await tx.journalEntry.deleteMany({ where: { voucherId } });
  await tx.stockMovement.deleteMany({ where: { voucherId } });
  await tx.voucherItem.deleteMany({ where: { voucherId } });
  await tx.voucherPayment.deleteMany({ where: { voucherId } });
  return moves.map((m) => m.productId);
}

export async function assertWarehouse(tx: Tx, businessId: string, warehouseId: string | null | undefined) {
  if (!warehouseId) return defaultWarehouseId(tx, businessId);
  const w = await tx.warehouse.findFirst({ where: { id: warehouseId, businessId } });
  if (!w) throw new UserError("গুদাম পাওয়া যায়নি");
  return w.id;
}

async function ledgerBalance(tx: Tx, businessId: string, accountId: string, book: BookKey) {
  const agg = await tx.journalEntry.aggregate({ where: { businessId, accountId, book }, _sum: { debit: true, credit: true } });
  return round2(Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0));
}

// ───────────────────────── trade vouchers ─────────────────────────

/**
 * A trade line may carry its exact base quantity when the entered quantity is a rounded figure in a
 * larger unit (paddy: 25.93 মণ for 1 037 kg on the scale). Only server code can set it (the public
 * form schema strips it), and only within the rounding of the entered quantity (±0.005 × factor).
 */
export type TradeLineInput = TradeVoucherInput["items"][number] & { baseQuantity?: number };
export type TradeInputWithBase = Omit<TradeVoucherInput, "items"> & { items: TradeLineInput[] };

/** book: the book of a NEW voucher (depot pages: DEPOT); an edit keeps the voucher's own book. */
export async function saveTradeVoucher(ctx: Ctx, type: TradeType, input: TradeInputWithBase, editId?: string, book?: BookKey) {
  return prisma.$transaction((tx) => tradeVoucherTx(tx, ctx, type, input, editId, book), TX_OPTIONS);
}

/** Posts a sale / purchase / return inside the caller's transaction (also used by the paddy purchase). */
export async function tradeVoucherTx(tx: Tx, ctx: Ctx, type: TradeType, input: TradeInputWithBase, editId?: string, book?: BookKey) {
  const rule = TRADE_RULES[type];
  {
    const business = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
    const existing = editId ? await loadEditable(tx, ctx, editId, type) : null;
    await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
    // a return always lives in its invoice's book (a depot stock-in / market-sale return stays in the depot book)
    const originalBook = !existing && input.returnOfId
      ? (await tx.voucher.findFirst({ where: { id: input.returnOfId, businessId: ctx.businessId }, select: { book: true } }))?.book
      : undefined;
    if (originalBook && book && book !== originalBook) throw new UserError("ফেরত মূল ইনভয়েসের হিসাবেই (সাধারণ / ডিপো) হবে");
    const vBook: BookKey = existing ? existing.book : originalBook ?? book ?? "GENERAL";
    await assertBookAccounts(tx, ctx.businessId, vBook, [input.partyAccountId, ...input.payments.map((p) => p.accountId)]);
    const removedProducts = existing ? await clearPostings(tx, existing.id) : [];

    // ── parties & ledgers (tenant + kind checks)
    let partyTerms: { creditLimit: number; creditDays: number } | null = null;
    if (input.partyAccountId) {
      await assertAccounts(tx, ctx.businessId, [input.partyAccountId], { kinds: [rule.partyKind], label: rule.partyKind === "CUSTOMER" ? "কাস্টমার" : "সরবরাহকারী" });
      const party = rule.partyKind === "CUSTOMER"
        ? await tx.customer.findUnique({ where: { accountId: input.partyAccountId }, select: { creditLimit: true, creditDays: true } })
        : await tx.supplier.findUnique({ where: { accountId: input.partyAccountId }, select: { creditDays: true } });
      partyTerms = { creditLimit: Number((party as { creditLimit?: unknown })?.creditLimit ?? 0), creditDays: party?.creditDays ?? 0 };
    }
    if (input.payments.length) await assertAccounts(tx, ctx.businessId, input.payments.map((p) => p.accountId), { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    const warehouseId = await assertWarehouse(tx, ctx.businessId, input.warehouseId);

    // ── products, units, batches
    const productIds = input.items.map((i) => i.productId);
    await assertBookProducts(tx, ctx.businessId, vBook, productIds, removedProducts);
    await lockProducts(tx, [...productIds, ...removedProducts]);
    const products = await tx.product.findMany({ where: { id: { in: [...new Set(productIds)] }, businessId: ctx.businessId }, include: { unit: true } });
    if (products.length !== new Set(productIds).size) throw new UserError("একটি পণ্য পাওয়া যায়নি");
    const productMap = new Map(products.map((p) => [p.id, p]));
    const units = await tx.unit.findMany({ where: { id: { in: input.items.map((i) => i.unitId).filter((u): u is string => !!u) }, businessId: ctx.businessId } });
    const unitMap = new Map(units.map((u) => [u.id, u]));

    const lines = input.items.map((item) => {
      const p = productMap.get(item.productId)!;
      if (!existing && !p.isActive) throw new UserError(`"${p.name}" নিষ্ক্রিয় পণ্য`);
      const unit = item.unitId ? unitMap.get(item.unitId) : p.unit;
      if (!unit) throw new UserError("ইউনিট পাওয়া যায়নি");
      const factor = unitConversionFactor(
        { id: unit.id, baseUnitId: unit.baseUnitId, factor: Number(unit.factor) },
        { id: p.unit.id, baseUnitId: p.unit.baseUnitId, factor: Number(p.unit.factor) },
      );
      if (factor === null) throw new UserError(`"${p.name}" এর জন্য "${unit.name}" ইউনিট প্রযোজ্য নয়`);
      // Sales may leave the batch empty: FEFO picks it. Receipts and purchase returns must name it.
      if (p.trackBatch && type !== "SALES" && !item.batchNo) throw new UserError(`"${p.name}" ব্যাচভিত্তিক পণ্য — ব্যাচ নম্বর দিন`);
      const computedBase = round3(item.quantity * factor);
      // free / scheme goods: on purchases (received with the invoice) and sales (given with it) only
      const freeQuantity = round3(item.freeQuantity ?? 0);
      if (freeQuantity > 0 && type !== "PURCHASE" && type !== "SALES") throw new UserError("ফেরত ভাউচারে ফ্রি পরিমাণ দেওয়া যায় না");
      if (item.baseQuantity !== undefined && Math.abs(item.baseQuantity - computedBase) > factor * 0.005 + 1e-9) {
        throw new UserError(`"${p.name}" — পরিমাণ ও মূল এককের পরিমাণ মিলছে না`);
      }
      return {
        id: randomUUID(),
        product: p,
        unitId: unit.id,
        factor,
        quantity: item.quantity,
        baseQuantity: item.baseQuantity !== undefined ? round3(item.baseQuantity) : computedBase,
        freeQuantity,
        freeBase: round3(freeQuantity * factor),
        rate: item.rate,
        discount: item.discount,
        amount: lineAmount({ quantity: item.quantity, unitPrice: item.rate, discount: item.discount }),
        batchNo: p.trackBatch ? item.batchNo : null,
        expiryDate: p.trackBatch ? item.expiryDate : null,
        mfgDate: p.trackBatch ? item.mfgDate : null,
      };
    });

    // ── an edited invoice may not drop below what has already been returned against it
    if (existing) {
      const returned = await tx.voucherItem.findMany({ where: { voucher: { returnOfId: existing.id } }, select: { productId: true, baseQuantity: true } });
      const need = new Map<string, number>();
      for (const r of returned) need.set(r.productId, round3((need.get(r.productId) ?? 0) + Number(r.baseQuantity)));
      for (const [pid, q] of need) {
        const have = round3(lines.filter((l) => l.product.id === pid).reduce((s, l) => s + l.baseQuantity, 0));
        if (have + 1e-9 < q) throw new UserError(`এই ইনভয়েস থেকে ইতিমধ্যে ${q} ফেরত হয়েছে — "${productMap.get(pid)?.name ?? "পণ্য"}" এর পরিমাণ এর কম করা যাবে না`);
      }
    }

    // ── returns: must reference an original invoice of the same party, within returnable quantities
    if (input.returnOfId) {
      if (!rule.returnOf) throw new UserError("এই ভাউচারে মূল ইনভয়েস যুক্ত করা যায় না");
      const original = await tx.voucher.findFirst({
        where: { id: input.returnOfId, businessId: ctx.businessId, type: rule.returnOf },
        include: { items: true, returns: { where: existing ? { id: { not: existing.id } } : {}, include: { items: true } } },
      });
      if (!original) throw new UserError("মূল ইনভয়েস পাওয়া যায়নি");
      if ((original.partyAccountId ?? null) !== (input.partyAccountId ?? null)) throw new UserError("ফেরতের পার্টি মূল ইনভয়েসের পার্টির সাথে মিলছে না");
      const sold = new Map<string, number>();
      for (const i of original.items) sold.set(i.productId, round3((sold.get(i.productId) ?? 0) + Number(i.baseQuantity)));
      for (const r of original.returns) for (const i of r.items) sold.set(i.productId, round3((sold.get(i.productId) ?? 0) - Number(i.baseQuantity)));
      const want = new Map<string, number>();
      for (const l of lines) want.set(l.product.id, round3((want.get(l.product.id) ?? 0) + l.baseQuantity));
      for (const [pid, q] of want) {
        const left = sold.get(pid) ?? 0;
        if (q > left + 1e-9) throw new UserError(`"${productMap.get(pid)!.name}" — মূল ইনভয়েস থেকে সর্বোচ্চ ${left} ফেরত নেওয়া যাবে`);
      }
    }

    // ── totals & payments
    const totals = computeTotals(
      lines.map((l) => ({ quantity: l.quantity, unitPrice: l.rate, discount: l.discount })),
      input.discount,
      type === "SALES" ? input.vatPercent : 0,
    );
    const payments = input.payments;
    const paid = paidOf({ payments });
    if (!input.partyAccountId) {
      if (payments.length === 0) throw new UserError("নগদ লেনদেনে নগদ/ব্যাংক হিসাব নির্বাচন করুন");
      if (paid !== totals.total) throw new UserError(`পার্টি ছাড়া লেনদেনে সম্পূর্ণ ${formatMoney(totals.total)} পরিশোধ করতে হবে (দেওয়া হয়েছে ${formatMoney(paid)})`);
    }
    if (paid > totals.total) throw new UserError("পরিশোধিত টাকা মোট বিলের বেশি হতে পারবে না");

    // ── customer credit limit
    if (type === "SALES" && input.partyAccountId && partyTerms && partyTerms.creditLimit > 0) {
      const projected = round2((await ledgerBalance(tx, ctx.businessId, input.partyAccountId, vBook)) + totals.total - paid);
      if (projected > partyTerms.creditLimit) {
        throw new UserError(`ক্রেডিট সীমা অতিক্রম করছে: বাকি হবে ${formatMoney(projected)}, সীমা ${formatMoney(partyTerms.creditLimit)}। আরও টাকা আদায় নিন বা সীমা বাড়ান।`);
      }
    }

    // ── header
    const dueDate =
      (type === "SALES" || type === "PURCHASE") && input.partyAccountId
        ? input.dueDate ?? (partyTerms?.creditDays ? addDays(input.date, partyTerms.creditDays) : null)
        : null;
    const header = {
      date: input.date,
      reference: input.reference,
      narration: input.narration,
      partyAccountId: input.partyAccountId,
      cashAccountId: payments[0]?.accountId ?? null,
      warehouseId,
      returnOfId: input.returnOfId,
      dueDate,
      subtotal: totals.subtotal,
      discount: totals.discount,
      vatPercent: type === "SALES" ? input.vatPercent : 0,
      vatAmount: totals.vatAmount,
      amount: totals.total,
      paidAmount: paid,
    };
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
      : await tx.voucher.create({
          data: { ...header, businessId: ctx.businessId, type, book: vBook, voucherNo: await nextVoucherNo(tx, ctx.businessId, type, business.invoicePrefix, vBook), createdById: ctx.userId },
        });

    // ── batches: receipts create / match the lot; sales use the chosen batch or FEFO
    const allocation = totals.subtotal > 0 ? totals.total / totals.subtotal : 0; // spreads purchase discount over lines
    // stock moves by paid + free; only the paid quantity is billed — a purchase's cost is spread over both
    const stockBase = (l: (typeof lines)[number]) => round3(l.baseQuantity + l.freeBase);
    const purchaseCostOf = (l: (typeof lines)[number]) => (type === "PURCHASE" && stockBase(l) > 0 ? (l.amount * allocation) / stockBase(l) : 0);
    const supplier = type === "PURCHASE" && input.partyAccountId ? await tx.supplier.findUnique({ where: { accountId: input.partyAccountId }, select: { id: true } }) : null;
    const batchesOf = new Map<string, BatchAllocation[]>();
    const used = new Map<string, number>();
    for (const l of lines) {
      if (!l.product.trackBatch) continue;
      if (rule.stock === "in") {
        const b = await ensureInboundBatch(tx, ctx.businessId, {
          productId: l.product.id, productName: l.product.name, batchNo: l.batchNo!, expiryDate: l.expiryDate, mfgDate: l.mfgDate,
          supplierId: supplier?.id, date: input.date,
          ...(type === "PURCHASE" ? { unitCost: round4(purchaseCostOf(l)), salePrice: Number(l.product.salePrice) } : {}),
        });
        batchesOf.set(l.id, [{ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, baseQuantity: stockBase(l) }]);
      } else if (type === "SALES") {
        batchesOf.set(l.id, await allocateSaleBatches(tx, {
          product: l.product, batchNo: l.batchNo, baseQuantity: stockBase(l), warehouseId, saleDate: input.date,
          allowExpiredSale: business.allowExpiredSale, used,
        }));
      } else {
        const b = await requireBatch(tx, l.product.id, l.product.name, l.batchNo!);
        batchesOf.set(l.id, [{ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, baseQuantity: l.baseQuantity }]);
      }
    }
    const single = (id: string) => {
      const a = batchesOf.get(id);
      return a && a.length === 1 ? a[0] : null;
    };

    // ── lines, payments, stock movements
    await tx.voucherItem.createMany({
      data: lines.map((l, i) => {
        const purchaseCost = purchaseCostOf(l);
        const b = single(l.id);
        return {
          id: l.id, voucherId: voucher.id, productId: l.product.id, warehouseId, unitId: l.unitId, unitFactor: l.factor,
          quantity: l.quantity, baseQuantity: l.baseQuantity, freeQuantity: l.freeQuantity, rate: l.rate, discount: l.discount, amount: l.amount,
          costRate: round4(purchaseCost), costAmount: round2(purchaseCost * stockBase(l)),
          batchId: b?.batchId ?? null, batchNo: b?.batchNo ?? null, expiryDate: b?.expiryDate ?? null, lineNo: i,
        };
      }),
    });
    if (payments.length) {
      await tx.voucherPayment.createMany({
        data: payments.map((p, i) => ({ voucherId: voucher.id, accountId: p.accountId, amount: round2(p.amount), reference: p.reference ?? null, lineNo: i })),
      });
    }
    // one movement per batch used (a FEFO line can span several batches); line cost = Σ movement costs
    const moves: MovementInput[] = lines.flatMap((l) =>
      (batchesOf.get(l.id) ?? [{ batchId: null, batchNo: null, expiryDate: null, baseQuantity: stockBase(l) }]).map((b) => ({
        productId: l.product.id,
        warehouseId,
        voucherItemId: l.id,
        type: rule.movement,
        ...(rule.stock === "in" ? { quantityIn: b.baseQuantity } : { quantityOut: b.baseQuantity }),
        unitCost: purchaseCostOf(l), // non-purchases: set by the replay
        batchId: b.batchId,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
      })),
    );
    await writeMovements(tx, ctx, voucher, moves);

    if (type === "PURCHASE") {
      for (const l of lines) await tx.product.update({ where: { id: l.product.id }, data: { purchasePrice: round2(l.rate / l.factor) } });
    }

    // ── replay stock timeline (costs, negative-stock check), then post this voucher
    await revalueProducts(tx, ctx.businessId, [...productIds, ...removedProducts], { skipRepost: new Set([voucher.id]) });
    await repostVoucher(tx, voucher.id);
    return voucher;
  }
}

// ───────────────────────── receipt / payment / journal ─────────────────────────

export async function saveCashVoucher(ctx: Ctx, type: "RECEIPT" | "PAYMENT", input: CashVoucherInput, editId?: string, book?: BookKey) {
  return prisma.$transaction(async (tx) => {
    const existing = editId ? await loadEditable(tx, ctx, editId, type) : null;
    await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
    const vBook: BookKey = existing ? existing.book : book ?? "GENERAL";
    await assertBookAccounts(tx, ctx.businessId, vBook, [input.cashAccountId, ...input.lines.map((l) => l.accountId)]);
    await assertAccounts(tx, ctx.businessId, [input.cashAccountId], { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    await assertAccounts(tx, ctx.businessId, input.lines.map((l) => l.accountId));
    if (input.lines.some((l) => l.accountId === input.cashAccountId)) throw new UserError("একই নগদ/ব্যাংক হিসাব উভয় দিকে ব্যবহার করা যাবে না");
    const entries = type === "RECEIPT" ? receiptEntries(input.cashAccountId, input.lines) : paymentEntries(input.cashAccountId, input.lines);
    const amount = round2(input.lines.reduce((s, l) => s + l.amount, 0));
    const party = input.lines.length === 1 ? input.lines[0].accountId : null;
    const header = { date: input.date, reference: input.reference, narration: input.narration, cashAccountId: input.cashAccountId, partyAccountId: party, amount, paidAmount: amount };
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
      : await tx.voucher.create({ data: { ...header, businessId: ctx.businessId, type, book: vBook, voucherNo: await nextVoucherNo(tx, ctx.businessId, type, undefined, vBook), createdById: ctx.userId } });
    await writeEntries(tx, voucher, entries);
    return voucher;
  }, TX_OPTIONS);
}

export async function saveJournalVoucher(ctx: Ctx, input: JournalVoucherInput, editId?: string, book?: BookKey) {
  return prisma.$transaction(async (tx) => {
    const existing = editId ? await loadEditable(tx, ctx, editId, "JOURNAL") : null;
    await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
    const vBook: BookKey = existing ? existing.book : book ?? "GENERAL";
    await assertBookAccounts(tx, ctx.businessId, vBook, input.lines.map((l) => l.accountId));
    await assertAccounts(tx, ctx.businessId, input.lines.map((l) => l.accountId));
    const entries = journalLinesFromInput(input.lines);
    const amount = round2(entries.reduce((s, l) => s + l.debit, 0));
    const header = { date: input.date, reference: input.reference, narration: input.narration, amount };
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
      : await tx.voucher.create({ data: { ...header, businessId: ctx.businessId, type: "JOURNAL", book: vBook, voucherNo: await nextVoucherNo(tx, ctx.businessId, "JOURNAL", undefined, vBook), createdById: ctx.userId } });
    await writeEntries(tx, voucher, entries);
    return voucher;
  }, TX_OPTIONS);
}

// ───────────────────────── stock journal ─────────────────────────

/** book DEPOT: a depot stock adjustment (its value moves the depot's inventory, never the general one). */
export async function saveStockJournal(ctx: Ctx, input: StockJournalInput, editId?: string, book?: BookKey) {
  return prisma.$transaction(async (tx) => {
    const existing = editId ? await loadEditable(tx, ctx, editId, "STOCK_JOURNAL") : null;
    return stockJournalTx(tx, ctx, input, existing, { book: existing ? existing.book : book ?? "GENERAL" });
  }, TX_OPTIONS);
}

/** Posts a stock journal inside the caller's transaction (also used by the expiry write-off). */
async function stockJournalTx(
  tx: Tx,
  ctx: Ctx,
  input: StockJournalInput,
  existing: { id: string; date: Date } | null,
  opts: { adjustmentAccountId?: string; book?: BookKey } = {},
) {
  {
    await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
    const removedProducts = existing ? await clearPostings(tx, existing.id) : [];
    const productIds = input.lines.map((l) => l.productId);
    await assertBookProducts(tx, ctx.businessId, opts.book ?? "GENERAL", productIds, removedProducts);
    await lockProducts(tx, [...productIds, ...removedProducts]);
    const products = await tx.product.findMany({ where: { id: { in: [...new Set(productIds)] }, businessId: ctx.businessId } });
    if (products.length !== new Set(productIds).size) throw new UserError("একটি পণ্য পাওয়া যায়নি");
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const l of input.lines) {
      await assertWarehouse(tx, ctx.businessId, l.warehouseId);
      if (productMap.get(l.productId)!.trackBatch && !l.batchNo) throw new UserError(`"${productMap.get(l.productId)!.name}" ব্যাচভিত্তিক পণ্য — ব্যাচ নম্বর দিন`);
    }
    if (removedProducts.length) await revalueProducts(tx, ctx.businessId, removedProducts);
    const fresh = new Map((await tx.product.findMany({ where: { id: { in: productIds } } })).map((p) => [p.id, p]));

    const header = { date: input.date, reference: input.reference, narration: input.narration, amount: 0, ...(opts.adjustmentAccountId ? { adjustmentAccountId: opts.adjustmentAccountId } : {}) };
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
      : await tx.voucher.create({ data: { ...header, businessId: ctx.businessId, type: "STOCK_JOURNAL", book: opts.book ?? "GENERAL", voucherNo: await nextVoucherNo(tx, ctx.businessId, "STOCK_JOURNAL", undefined, opts.book ?? "GENERAL"), createdById: ctx.userId } });

    const lines = [];
    for (const l of input.lines) {
      const p = fresh.get(l.productId)!;
      const inRate = l.rate ?? (Number(p.avgCost) || Number(p.purchasePrice));
      const unitCost = l.direction === 1 ? inRate : 0; // outgoing cost is set by the replay
      const batch = !p.trackBatch
        ? null
        : l.direction === 1
          ? await ensureInboundBatch(tx, ctx.businessId, { productId: p.id, productName: p.name, batchNo: l.batchNo!, expiryDate: l.expiryDate, mfgDate: l.mfgDate, date: input.date, unitCost: round4(inRate), salePrice: Number(p.salePrice) })
          : await requireBatch(tx, p.id, p.name, l.batchNo!);
      lines.push({
        ...l, id: randomUUID(), unitCost: round4(unitCost), value: round2(l.quantity * unitCost), unitId: p.unitId,
        batchId: batch?.id ?? null, batchNo: batch?.batchNo ?? null, expiryDate: batch?.expiryDate ?? null,
      });
    }
    await tx.voucherItem.createMany({
      data: lines.map((l, i) => ({
        id: l.id, voucherId: voucher.id, productId: l.productId, warehouseId: l.warehouseId, unitId: l.unitId,
        quantity: l.quantity, baseQuantity: l.quantity, rate: round2(l.unitCost), amount: l.value, costRate: l.unitCost, costAmount: l.value,
        direction: l.direction, batchId: l.batchId, batchNo: l.batchNo, expiryDate: l.expiryDate, lineNo: i,
      })),
    });
    await writeMovements(
      tx, ctx, voucher,
      lines.map((l) => ({
        productId: l.productId, warehouseId: l.warehouseId, voucherItemId: l.id,
        type: l.direction === 1 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        ...(l.direction === 1 ? { quantityIn: l.quantity } : { quantityOut: l.quantity }),
        unitCost: l.unitCost, batchId: l.batchId, batchNo: l.batchNo, expiryDate: l.expiryDate,
      })),
    );
    await revalueProducts(tx, ctx.businessId, [...productIds, ...removedProducts], { skipRepost: new Set([voucher.id]) });
    // out-line values were set by the replay; refresh line rates for display
    for (const it of await tx.voucherItem.findMany({ where: { voucherId: voucher.id, direction: -1 } })) {
      await tx.voucherItem.update({ where: { id: it.id }, data: { rate: round2(Number(it.costRate)), amount: it.costAmount } });
    }
    await repostVoucher(tx, voucher.id);
    return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
  }
}

// ───────────────────────── expiry write-off ─────────────────────────

/**
 * Writes off expired stock: one stock journal moving every selected expired batch (all
 * warehouses) out of inventory at its average cost, posted Dr "মেয়াদোত্তীর্ণ পণ্যের ক্ষতি" /
 * Cr Inventory, plus an audit-log row — all in one transaction.
 */
export async function writeOffExpired(ctx: Ctx, input: { date: Date; batchIds?: string[]; narration?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const batches = await tx.productBatch.findMany({
      where: { businessId: ctx.businessId, quantity: { gt: 0 }, expiryDate: { lt: input.date }, ...(input.batchIds ? { id: { in: input.batchIds } } : {}) },
      include: { product: { select: { id: true, name: true } } },
      orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }],
    });
    if (input.batchIds && batches.length !== new Set(input.batchIds).size) throw new UserError("শুধু মজুদ থাকা মেয়াদোত্তীর্ণ ব্যাচ বাতিল করা যায়");
    if (batches.length === 0) throw new UserError("বাতিল করার মতো মেয়াদোত্তীর্ণ মজুদ নেই");
    const perWarehouse = await tx.stockMovement.groupBy({
      by: ["batchId", "warehouseId", "productId"],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _sum: { quantityIn: true, quantityOut: true },
    });
    const byId = new Map(batches.map((b) => [b.id, b]));
    const lines = perWarehouse
      .map((r) => ({ r, qty: round3(Number(r._sum.quantityIn ?? 0) - Number(r._sum.quantityOut ?? 0)) }))
      .filter((x) => x.qty > 0)
      .map(({ r, qty }) => ({
        productId: r.productId, warehouseId: r.warehouseId, direction: -1 as const, quantity: qty,
        batchNo: byId.get(r.batchId!)!.batchNo, expiryDate: null, mfgDate: null, rate: undefined,
      }));
    const lossAccountId = await expiryLossAccount(tx, ctx.businessId);
    const voucher = await stockJournalTx(
      tx, ctx,
      { date: input.date, reference: null, narration: input.narration || "মেয়াদোত্তীর্ণ পণ্য বাতিল (write-off)", lines },
      null,
      { adjustmentAccountId: lossAccountId },
    );
    await tx.auditLog.create({
      data: {
        businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", entity: "ExpiryWriteOff", entityId: voucher.id,
        details: {
          voucherNo: voucher.voucherNo, value: Number(voucher.amount),
          batches: batches.map((b) => ({ product: b.product.name, batchNo: b.batchNo, quantity: Number(b.quantity), expiryDate: b.expiryDate?.toISOString().slice(0, 10) ?? null })),
        },
      },
    });
    return voucher;
  }, TX_OPTIONS);
}

// ───────────────────────── delete ─────────────────────────

export async function deleteVoucher(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.voucher.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { returns: true } } } });
    if (!v) throw new UserError("ভাউচার পাওয়া যায়নি");
    if (v.type === "OPENING") throw new UserError("প্রারম্ভিক ব্যালেন্স সংশ্লিষ্ট হিসাব/পণ্য থেকে পরিবর্তন করুন");
    if (isPayrollVoucher(v.sourceKey)) throw new UserError(PAYROLL_VOUCHER_MESSAGE);
    if (isPaddyLabourVoucher(v.sourceKey)) throw new UserError(PADDY_LABOUR_MESSAGE);
    await assertNotLocked(tx, ctx.businessId, v.date);
    if (v._count.returns > 0) throw new UserError("এই ইনভয়েসের বিপরীতে ফেরত ভাউচার আছে — আগে সেগুলো মুছুন");
    const products = await clearPostings(tx, v.id);
    await tx.voucher.delete({ where: { id: v.id } });
    // a paddy slip takes its labour payment with it (its entries cascade)
    await tx.voucher.deleteMany({ where: { businessId: ctx.businessId, sourceKey: `paddy-labour:${v.id}` } });
    // a depot commission transfer is two linked vouchers (depot + general): both go
    if (v.sourceKey?.startsWith(TRANSFER_SOURCE)) {
      const link = v.sourceKey.slice(0, v.sourceKey.lastIndexOf(":") + 1);
      await tx.voucher.deleteMany({ where: { businessId: ctx.businessId, sourceKey: { startsWith: link } } });
    }
    await lockProducts(tx, products);
    await revalueProducts(tx, ctx.businessId, products);
    return v;
  }, TX_OPTIONS);
}

/** Snapshot of a voucher's postings — stored in the audit log before edits / deletes. */
export async function voucherSnapshot(businessId: string, id: string) {
  const v = await prisma.voucher.findFirst({
    where: { id, businessId },
    include: { entries: { include: { account: { select: { name: true } } } }, items: true, payments: true },
  });
  if (!v) return null;
  return {
    voucherNo: v.voucherNo,
    type: v.type,
    date: v.date.toISOString().slice(0, 10),
    amount: Number(v.amount),
    entries: v.entries.map((e) => ({ account: e.account.name, debit: Number(e.debit), credit: Number(e.credit) })),
    items: v.items.map((i) => ({ productId: i.productId, qty: Number(i.quantity), rate: Number(i.rate) })),
    payments: v.payments.map((p) => ({ accountId: p.accountId, amount: Number(p.amount) })),
  };
}
