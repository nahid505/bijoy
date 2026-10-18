// Depot management (business type DEPOT): delivery challans, company commission and the depot dashboard.
//
//   COMPANY_PAID      a DEPOT_DELIVERY voucher: stock out (DEPOT_OUT, moving-average cost) against the
//                     company's ledger + commission (Σ quantity × rate) — see depotDeliveryEntries.
//                     The dealer gets no due.
//   DEPOT_COLLECTION  a normal SALES voucher to the dealer (stock, COGS, cash or market due).
// Both carry a DepotDelivery row (mode, DO number, company, dealer, vehicle, driver, commission).
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { ci } from "@/lib/dialect";
import { round2, round3 } from "@/lib/calc";
import { COMMISSION_INCOME_KEY, COMMISSION_RECEIVABLE_PREFIX, commissionReceivableKey, depotTotals, GENERAL_COMMISSION_INCOME_KEY, isDepot, TRANSFER_OUT_KEY, TRANSFER_SOURCE, type DepotMode } from "@/lib/depot";
import type { CommissionSettlementInput, CommissionTransferInput, DepotDeliveryInput } from "@/lib/validation";
import { assertAccounts, assertNotLocked, nextVoucherNo, writeEntries, type Ctx, type Tx } from "./accounting";
import { allocateSaleBatches } from "./batches";
import { defaultWarehouseId, lockProducts, writeMovements, type MovementInput } from "./inventory";
import { balancesBefore } from "./ledger";
import { repostVoucher, revalueProducts } from "./posting";
import { assertWarehouse, clearPostings, loadEditable, saveCashVoucher, saveJournalVoucher, tradeVoucherTx, TX_OPTIONS } from "./voucher";

export async function assertDepotBusiness(tx: Tx | typeof prisma, businessId: string) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { businessType: true } });
  if (!isDepot(b.businessType)) throw new UserError("এই সুবিধা শুধু ডিপো ব্যবসার জন্য — ব্যবসা সেটিং থেকে ব্যবসার ধরন \"ডিপো ব্যবসা\" করুন");
}

/** The commission ledgers: income (one per business) and receivable (one per company), created on first use. */
export async function commissionAccounts(tx: Tx, businessId: string, companyAccountId: string): Promise<{ income: string; receivable: string }> {
  const ensure = async (systemKey: string, groupKey: string, nature: "INCOME" | "ASSET", name: string) => {
    const found = await tx.account.findFirst({ where: { businessId, systemKey }, select: { id: true } });
    if (found) return found.id;
    const group = await tx.accountGroup.findFirst({ where: { businessId, systemKey: groupKey } });
    if (!group) throw new Error(`${groupKey} group missing for business ${businessId}`);
    return (await tx.account.create({ data: { businessId, groupId: group.id, nature, name, systemKey, isSystem: true } })).id;
  };
  const company = await tx.account.findFirstOrThrow({ where: { id: companyAccountId, businessId }, select: { name: true } });
  return {
    income: await ensure(COMMISSION_INCOME_KEY, "INDIRECT_INCOME", "INCOME", "ডিপো কমিশন আয়"),
    receivable: await ensure(commissionReceivableKey(companyAccountId), "CURRENT_ASSETS", "ASSET", `কমিশন প্রাপ্য — ${company.name}`),
  };
}

/** The ledger must belong to a customer (dealer) / supplier (company) of this business. */
async function assertParty(tx: Tx, businessId: string, accountId: string, kind: "dealer" | "company") {
  const hit = kind === "dealer"
    ? await tx.customer.findFirst({ where: { businessId, accountId, isDepotDealer: true }, select: { id: true } }) // depot dealers only
    : await tx.supplier.findFirst({ where: { businessId, accountId }, select: { id: true } });
  if (!hit) throw new UserError(kind === "dealer" ? "ডিলার পাওয়া যায়নি — ডিপোর ডিলার তালিকা থেকে নির্বাচন করুন" : "কোম্পানি পাওয়া যায়নি — সরবরাহকারী তালিকা থেকে নির্বাচন করুন");
}

export async function saveDepotDelivery(ctx: Ctx, input: DepotDeliveryInput, editId?: string) {
  return prisma.$transaction(async (tx) => {
    await assertDepotBusiness(tx, ctx.businessId);
    if (editId) {
      const prev = await tx.depotDelivery.findFirst({ where: { voucherId: editId, businessId: ctx.businessId }, select: { mode: true } });
      if (!prev) throw new UserError("ডেলিভারি চালান পাওয়া যায়নি");
      if (prev.mode !== input.mode) throw new UserError("ডেলিভারির ধরন পরিবর্তন করা যায় না — চালানটি মুছে নতুন করে তৈরি করুন");
    }
    if (input.dealerAccountId) await assertParty(tx, ctx.businessId, input.dealerAccountId, "dealer");
    if (input.companyAccountId) await assertParty(tx, ctx.businessId, input.companyAccountId, "company");
    const totals = depotTotals(input.lines);
    const challan = {
      mode: input.mode as DepotMode,
      doNumber: input.doNumber,
      companyAccountId: input.companyAccountId,
      dealerAccountId: input.dealerAccountId,
      vehicleNo: input.vehicleNo,
      driverName: input.driverName,
      notes: input.notes,
      commissionTotal: input.mode === "COMPANY_PAID" ? totals.total : 0,
    };

    const voucher = input.mode === "COMPANY_PAID" ? await saveDoRelease(tx, ctx, input, editId) : await saveMarketSale(tx, ctx, input, editId);
    await tx.depotDelivery.upsert({ where: { voucherId: voucher.id }, create: { ...challan, voucherId: voucher.id, businessId: ctx.businessId }, update: challan });
    return voucher;
  }, TX_OPTIONS);
}

/** COMPANY_PAID: a DEPOT_DELIVERY voucher (stock out against the company, commission receivable). */
async function saveDoRelease(tx: Tx, ctx: Ctx, input: DepotDeliveryInput, editId?: string) {
  const companyAccountId = input.companyAccountId!;
  const existing = editId ? await loadEditable(tx, ctx, editId, "DEPOT_DELIVERY") : null;
  await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
  const warehouseId = input.warehouseId ?? (await defaultWarehouseId(tx, ctx.businessId));
  await assertWarehouse(tx, ctx.businessId, warehouseId);
  await commissionAccounts(tx, ctx.businessId, companyAccountId);

  const removed = existing ? await clearPostings(tx, existing.id) : [];
  const ids = input.lines.map((l) => l.productId);
  await lockProducts(tx, [...ids, ...removed]);
  const products = new Map((await tx.product.findMany({ where: { id: { in: ids }, businessId: ctx.businessId } })).map((p) => [p.id, p]));
  if (products.size !== new Set(ids).size) throw new UserError("একটি পণ্য পাওয়া যায়নি");

  const header = { date: input.date, reference: input.reference, narration: input.narration ?? input.notes, partyAccountId: companyAccountId, warehouseId, amount: 0, subtotal: 0 };
  const voucher = existing
    ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
    : await tx.voucher.create({ data: { ...header, businessId: ctx.businessId, type: "DEPOT_DELIVERY", book: "DEPOT", voucherNo: await nextVoucherNo(tx, ctx.businessId, "DEPOT_DELIVERY"), createdById: ctx.userId } });

  const items: Prisma.VoucherItemCreateManyInput[] = [];
  const moves: MovementInput[] = [];
  const used = new Map<string, number>();
  for (const [i, l] of input.lines.entries()) {
    const p = products.get(l.productId)!;
    const itemId = randomUUID();
    const quantity = round3(l.quantity);
    const freeQuantity = round3(l.freeQuantity ?? 0);
    const out = round3(quantity + freeQuantity); // stock leaves paid + free; commission only on the paid quantity
    const allocs = p.trackBatch
      ? await allocateSaleBatches(tx, { product: p, batchNo: null, baseQuantity: out, warehouseId, saleDate: input.date, allowExpiredSale: false, used })
      : [{ batchId: null, batchNo: null, expiryDate: null, baseQuantity: out }];
    const single = allocs.length === 1 ? allocs[0] : null;
    // rate / amount of a DO line = commission per unit / commission
    items.push({ id: itemId, voucherId: voucher.id, productId: p.id, warehouseId, unitId: p.unitId, quantity, baseQuantity: quantity, freeQuantity, rate: l.rate, challanRate: l.challanRate ?? num(p.purchasePrice), amount: round2(quantity * l.rate), direction: -1, batchId: single?.batchId ?? null, batchNo: single?.batchNo ?? null, expiryDate: single?.expiryDate ?? null, lineNo: i });
    for (const a of allocs) moves.push({ productId: p.id, warehouseId, voucherItemId: itemId, type: "DEPOT_OUT", quantityOut: a.baseQuantity, unitCost: 0, batchId: a.batchId, batchNo: a.batchNo, expiryDate: a.expiryDate });
  }
  await tx.voucherItem.createMany({ data: items });
  await writeMovements(tx, ctx, voucher, moves);
  // replay at moving-average cost on the delivery date (refuses negative stock), then post
  await revalueProducts(tx, ctx.businessId, [...ids, ...removed], { skipRepost: new Set([voucher.id]) });
  await repostVoucher(tx, voucher.id);
  return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
}

/** DEPOT_COLLECTION: a SALES voucher to the dealer (cash now, the rest is the dealer's market due). */
async function saveMarketSale(tx: Tx, ctx: Ctx, input: DepotDeliveryInput, editId?: string) {
  if (editId && !(await tx.voucher.findFirst({ where: { id: editId, businessId: ctx.businessId, type: "SALES" }, select: { id: true } }))) throw new UserError("ডেলিভারি চালান পাওয়া যায়নি");
  const total = depotTotals(input.lines).total;
  const paid = input.dealerAccountId ? Math.min(input.paidAmount, total) : total;
  const v = await tradeVoucherTx(tx, ctx, "SALES", {
    date: input.date,
    reference: input.reference ?? input.doNumber,
    narration: input.narration ?? input.notes,
    partyAccountId: input.dealerAccountId,
    warehouseId: input.warehouseId,
    returnOfId: null,
    dueDate: null,
    discount: 0,
    vatPercent: 0,
    payments: paid > 0 && input.cashAccountId ? [{ accountId: input.cashAccountId, amount: paid, reference: null }] : [],
    items: input.lines.map((l) => ({ productId: l.productId, unitId: null, quantity: l.quantity, freeQuantity: l.freeQuantity ?? 0, rate: l.rate, discount: 0, batchNo: null, expiryDate: null, mfgDate: null })),
  }, editId, "DEPOT"); // a depot market sale lives in the depot book (MS- series), never in general sales
  // a market sale prints its own sale rate on the dealer challan
  const items = await tx.voucherItem.findMany({ where: { voucherId: v.id }, select: { id: true, rate: true } });
  for (const i of items) await tx.voucherItem.update({ where: { id: i.id }, data: { challanRate: i.rate } });
  return v;
}

/** A challan with its voucher, lines and parties (form, detail, print). */
export async function loadDepotDelivery(businessId: string, voucherId: string) {
  return prisma.depotDelivery.findFirst({
    where: { voucherId, businessId },
    include: {
      companyAccount: { select: { id: true, name: true } },
      dealerAccount: { select: { id: true, name: true, customer: { select: { route: true, mobile: true } } } },
      voucher: {
        include: {
          payments: { include: { account: { select: { id: true, name: true } } } },
          items: { orderBy: { lineNo: "asc" }, include: { product: { select: { id: true, name: true, code: true, barcode: true, unitId: true, salePrice: true, wholesalePrice: true, purchasePrice: true, avgCost: true, stock: true, trackBatch: true, depotCommissionRate: true, unit: { select: { name: true } } } } } },
        },
      },
    },
  });
}

/** A challan line's rate on the dealer copy: the saved challan rate (old lines: DO → the product's
 *  purchase price, market sale → its sale rate). */
export function challanLineRate(mode: DepotMode, i: { rate: unknown; challanRate: unknown; product: { purchasePrice: unknown } }) {
  if (i.challanRate !== null && i.challanRate !== undefined) return num(i.challanRate as never);
  return mode === "COMPANY_PAID" ? num(i.product.purchasePrice as never) : num(i.rate as never);
}

/** Goods value of a challan (as printed for the dealer): Σ supplied quantity × challan rate; free goods are not priced. */
export function challanValue(mode: DepotMode, items: { quantity: unknown; rate: unknown; challanRate: unknown; product: { purchasePrice: unknown } }[]) {
  return round2(items.reduce((s, i) => s + round2(num(i.quantity as never) * challanLineRate(mode, i)), 0));
}

const deliveryLineSelect = { quantity: true, freeQuantity: true, rate: true, challanRate: true, product: { select: { purchasePrice: true, unit: { select: { name: true } } } } } as const;

/** opts.scope: voucherScopeWhere(ctx) — assigned-only roles see only their parties' challans. */
export function deliveryWhere(businessId: string, opts: { from?: Date; to?: Date; mode?: DepotMode; q?: string; scope?: Prisma.VoucherWhereInput }): Prisma.DepotDeliveryWhereInput {
  return {
    businessId,
    ...(opts.scope && Object.keys(opts.scope).length ? { AND: [{ voucher: opts.scope }] } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.from || opts.to ? { voucher: { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } } : {}),
    ...(opts.q
      ? { OR: [{ doNumber: ci(opts.q) }, { voucher: { voucherNo: ci(opts.q) } }, { dealerAccount: { name: ci(opts.q) } }, { companyAccount: { name: ci(opts.q) } }] }
      : {}),
  };
}

/** Challans for the list (a page, or every match with take = undefined) and totals over the whole filter. */
export async function listDepotDeliveries(businessId: string, opts: { from?: Date; to?: Date; mode?: DepotMode; q?: string; skip?: number; take?: number; scope?: Prisma.VoucherWhereInput }) {
  const where = deliveryWhere(businessId, opts);
  const [rows, total, all] = await Promise.all([
    prisma.depotDelivery.findMany({
      where,
      orderBy: [{ voucher: { date: "desc" } }, { createdAt: "desc" }],
      skip: opts.skip,
      take: opts.take,
      include: {
        companyAccount: { select: { name: true } },
        dealerAccount: { select: { name: true, customer: { select: { route: true } } } },
        voucher: { select: { id: true, voucherNo: true, date: true, amount: true, paidAmount: true, items: { select: deliveryLineSelect } } },
      },
    }),
    prisma.depotDelivery.count({ where }),
    prisma.depotDelivery.findMany({ where, select: { mode: true, commissionTotal: true, voucher: { select: { items: { select: deliveryLineSelect } } } } }),
  ]);
  const quantityOf = (items: { quantity: unknown; freeQuantity: unknown }[]) => ({
    quantity: round3(items.reduce((s, i) => s + num(i.quantity as never), 0)),
    free: round3(items.reduce((s, i) => s + num(i.freeQuantity as never), 0)),
  });
  return {
    rows: rows.map((r) => ({ ...r, saleValue: challanValue(r.mode, r.voucher.items), ...quantityOf(r.voucher.items) })),
    total,
    totals: {
      saleValue: round2(all.reduce((s, r) => s + challanValue(r.mode, r.voucher.items), 0)),
      commission: round2(all.reduce((s, r) => s + num(r.commissionTotal), 0)),
      doCount: all.filter((r) => r.mode === "COMPANY_PAID").length,
      marketCount: all.filter((r) => r.mode === "DEPOT_COLLECTION").length,
    },
  };
}

/** Commission receivable per company: earned (DO releases), settled, outstanding (ledger balance). */
export async function commissionSummary(businessId: string, range: { from?: Date; to?: Date } = {}) {
  const receivables = await prisma.account.findMany({ where: { businessId, systemKey: { startsWith: COMMISSION_RECEIVABLE_PREFIX } }, select: { id: true, systemKey: true } });
  const companyIds = receivables.map((r) => r.systemKey!.slice(COMMISSION_RECEIVABLE_PREFIX.length));
  const [companies, earned, credits, balances] = await Promise.all([
    prisma.account.findMany({ where: { businessId, id: { in: companyIds } }, select: { id: true, name: true } }),
    prisma.depotDelivery.groupBy({
      by: ["companyAccountId"],
      where: { businessId, mode: "COMPANY_PAID", ...(range.from || range.to ? { voucher: { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } } : {}) },
      _sum: { commissionTotal: true },
      _count: true,
    }),
    prisma.journalEntry.groupBy({
      by: ["accountId"],
      where: { businessId, book: "DEPOT", accountId: { in: receivables.map((r) => r.id) }, ...(range.from || range.to ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {}) },
      _sum: { credit: true },
    }),
    balancesBefore(businessId, undefined, receivables.map((r) => r.id), "DEPOT"),
  ]);
  const name = new Map(companies.map((c) => [c.id, c.name]));
  const rows = receivables.map((r) => {
    const companyAccountId = r.systemKey!.slice(COMMISSION_RECEIVABLE_PREFIX.length);
    const e = earned.find((x) => x.companyAccountId === companyAccountId);
    return {
      companyAccountId,
      company: name.get(companyAccountId) ?? "—",
      receivableAccountId: r.id,
      deliveries: e?._count ?? 0,
      earned: num(e?._sum.commissionTotal),
      settled: num(credits.find((c) => c.accountId === r.id)?._sum.credit),
      outstanding: round2(balances.get(r.id) ?? 0),
    };
  }).sort((a, b) => b.outstanding - a.outstanding);
  return { rows, outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)) };
}

/** Commission received from the company (cash/bank) or adjusted against what the depot owes it. */
export async function settleCommission(ctx: Ctx, input: CommissionSettlementInput) {
  await assertDepotBusiness(prisma, ctx.businessId);
  const receivable = await prisma.account.findFirst({ where: { businessId: ctx.businessId, systemKey: commissionReceivableKey(input.companyAccountId) }, select: { id: true } });
  if (!receivable) throw new UserError("এই কোম্পানির কোনো কমিশন প্রাপ্য নেই");
  const outstanding = (await balancesBefore(ctx.businessId, undefined, [receivable.id], "DEPOT")).get(receivable.id) ?? 0;
  if (input.amount > round2(outstanding) + 0.001) throw new UserError(`প্রাপ্য কমিশনের (৳ ${round2(outstanding)}) বেশি সমন্বয় করা যাবে না`, { amount: ["প্রাপ্যের চেয়ে বেশি"] });
  const company = await prisma.account.findFirstOrThrow({ where: { id: input.companyAccountId, businessId: ctx.businessId }, select: { name: true } });
  const narration = `ডিপো কমিশন ${input.method === "CASH" ? "আদায়" : "সমন্বয়"} — ${company.name}`;
  return input.method === "CASH"
    ? saveCashVoucher(ctx, "RECEIPT", { date: input.date, reference: input.reference, narration, cashAccountId: input.cashAccountId!, lines: [{ accountId: receivable.id, amount: input.amount, narration }] }, undefined, "DEPOT")
    : saveJournalVoucher(ctx, { date: input.date, reference: input.reference, narration, lines: [
        { accountId: input.companyAccountId, debit: input.amount, credit: 0, narration: "কোম্পানির পাওনা থেকে কমিশন সমন্বয়" },
        { accountId: receivable.id, debit: 0, credit: input.amount, narration },
      ] }, undefined, "DEPOT");
}

// ───────────────────────── commission → general income ─────────────────────────

async function transferAccounts(tx: Tx, businessId: string) {
  const ensure = async (systemKey: string, groupKey: string, nature: "INCOME" | "EQUITY", name: string) => {
    const found = await tx.account.findFirst({ where: { businessId, systemKey }, select: { id: true } });
    if (found) return found.id;
    const group = await tx.accountGroup.findFirst({ where: { businessId, systemKey: groupKey } });
    if (!group) throw new Error(`${groupKey} group missing for business ${businessId}`);
    return (await tx.account.create({ data: { businessId, groupId: group.id, nature, name, systemKey, isSystem: true } })).id;
  };
  return {
    out: await ensure(TRANSFER_OUT_KEY, "CAPITAL", "EQUITY", "মূল ব্যবসায় স্থানান্তর (ডিপো)"),
    income: await ensure(GENERAL_COMMISSION_INCOME_KEY, "INDIRECT_INCOME", "INCOME", "ডিপো কমিশন আয় (স্থানান্তরিত)"),
  };
}

/** Commission the depot earned and has not yet moved to the general books. */
export async function transferableCommission(businessId: string) {
  const accounts = await prisma.account.findMany({ where: { businessId, systemKey: { in: [COMMISSION_INCOME_KEY, TRANSFER_OUT_KEY] } }, select: { id: true, systemKey: true } });
  const bal = await balancesBefore(businessId, undefined, accounts.map((a) => a.id), "DEPOT");
  const of = (key: string) => bal.get(accounts.find((a) => a.systemKey === key)?.id ?? "") ?? 0;
  const earned = round2(-of(COMMISSION_INCOME_KEY)); // income: credit balance
  const transferred = round2(of(TRANSFER_OUT_KEY)); // transfers: debit balance
  return { earned, transferred, available: round2(Math.max(earned - transferred, 0)) };
}

/**
 * Moves depot commission into the business's general income — the only link between the books.
 * Depot book (JOURNAL, DJ-): Dr "মূল ব্যবসায় স্থানান্তর" / Cr depot cash.
 * General book (RECEIPT): Dr general cash / Cr "ডিপো কমিশন আয় (স্থানান্তরিত)".
 * Both are written in one transaction and linked by sourceKey (deleting one deletes the other).
 */
export async function transferCommission(ctx: Ctx, input: CommissionTransferInput) {
  return prisma.$transaction(async (tx) => {
    await assertDepotBusiness(tx, ctx.businessId);
    await assertNotLocked(tx, ctx.businessId, input.date);
    await assertAccounts(tx, ctx.businessId, [input.depotCashAccountId, input.generalCashAccountId], { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    const { available } = await transferableCommission(ctx.businessId);
    if (input.amount > available + 0.001) throw new UserError(`স্থানান্তরযোগ্য কমিশন ৳ ${available} — এর বেশি স্থানান্তর করা যাবে না`, { amount: ["স্থানান্তরযোগ্যের চেয়ে বেশি"] });
    const acc = await transferAccounts(tx, ctx.businessId);
    const link = randomUUID();
    const narration = "ডিপো কমিশন সাধারণ আয়ে স্থানান্তর";
    const base = { businessId: ctx.businessId, date: input.date, reference: input.reference, narration, amount: input.amount, createdById: ctx.userId };
    const depotV = await tx.voucher.create({
      data: { ...base, type: "JOURNAL", book: "DEPOT", sourceKey: `${TRANSFER_SOURCE}${link}:depot`, voucherNo: await nextVoucherNo(tx, ctx.businessId, "JOURNAL", undefined, "DEPOT") },
    });
    await writeEntries(tx, depotV, [
      { accountId: acc.out, debit: input.amount, credit: 0, narration },
      { accountId: input.depotCashAccountId, debit: 0, credit: input.amount, narration },
    ]);
    const generalV = await tx.voucher.create({
      data: { ...base, type: "RECEIPT", book: "GENERAL", cashAccountId: input.generalCashAccountId, partyAccountId: acc.income, paidAmount: input.amount, sourceKey: `${TRANSFER_SOURCE}${link}:general`, voucherNo: await nextVoucherNo(tx, ctx.businessId, "RECEIPT") },
    });
    await writeEntries(tx, generalV, [
      { accountId: input.generalCashAccountId, debit: input.amount, credit: 0, narration },
      { accountId: acc.income, debit: 0, credit: input.amount, narration },
    ]);
    return { depot: depotV, general: generalV };
  }, TX_OPTIONS);
}

/** The depot dashboard cards. */
export async function depotDashboard(businessId: string, today: string) {
  const day = new Date(`${today}T00:00:00.000Z`);
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  const [todays, commission, dealerAccounts, products] = await Promise.all([
    prisma.depotDelivery.findMany({ where: { businessId, voucher: { date: { gte: day, lt: next } } }, select: { mode: true, commissionTotal: true, voucher: { select: { amount: true, items: { select: { quantity: true } } } } } }),
    commissionSummary(businessId),
    prisma.customer.findMany({ where: { businessId, isDepotDealer: true }, select: { accountId: true } }),
    prisma.product.findMany({ where: { businessId }, select: { stock: true, avgCost: true } }),
  ]);
  const balances = await balancesBefore(businessId, undefined, dealerAccounts.map((d) => d.accountId), "DEPOT");
  const dues = [...balances.values()].filter((v) => v > 0);
  return {
    today: {
      count: todays.length,
      doCount: todays.filter((t) => t.mode === "COMPANY_PAID").length,
      marketCount: todays.filter((t) => t.mode === "DEPOT_COLLECTION").length,
      quantity: round3(todays.reduce((s, t) => s + t.voucher.items.reduce((q, i) => q + num(i.quantity), 0), 0)),
      marketValue: round2(todays.filter((t) => t.mode === "DEPOT_COLLECTION").reduce((s, t) => s + num(t.voucher.amount), 0)),
      commission: round2(todays.reduce((s, t) => s + num(t.commissionTotal), 0)),
    },
    commissionReceivable: commission.outstanding,
    marketDue: round2(dues.reduce((s, v) => s + v, 0)),
    dealersWithDue: dues.length,
    stockValue: round2(products.reduce((s, p) => s + num(p.stock) * num(p.avgCost), 0)),
  };
}
