// Posting engine.
//
// • repostVoucher: trade & stock vouchers derive their journal entries from stored data
//   (header + lines + payments + line costs). Entries are therefore always reproducible.
// • revalueProducts: replays a product's whole stock timeline in date order. Every outgoing
//   movement (and every sales-return inflow) is re-costed at the moving average in force on
//   its date; vouchers whose cost changed are reposted. This is what makes BACKDATED
//   purchases, sales, returns, edits and deletes produce correct inventory and COGS.
//   The replay also enforces that stock never goes negative at ANY point in time.
import type { Prisma } from "@prisma/client";
import {
  purchaseEntries,
  purchaseReturnEntries,
  salesEntries,
  salesReturnEntries,
  stockJournalEntries,
  type SystemAccounts,
  type TradeInput,
} from "@/lib/accounting";
import { round2, round3, round4, weightedAverageCost } from "@/lib/calc";
import { formatDate } from "@/lib/format";
import { UserError } from "@/lib/errors";
import { systemAccounts, writeEntries, type Tx } from "./accounting";
import { syncBatchQuantities } from "./batches";

const TRADE = ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"] as const;

/** Rebuilds the journal entries of a trade / stock-journal voucher from its stored data. */
export async function repostVoucher(tx: Tx, voucherId: string, acc?: SystemAccounts) {
  const v = await tx.voucher.findUniqueOrThrow({
    where: { id: voucherId },
    include: { items: true, payments: { orderBy: { lineNo: "asc" } } },
  });
  const accounts = acc ?? (await systemAccounts(tx, v.businessId));
  if ((TRADE as readonly string[]).includes(v.type)) {
    const input: TradeInput = {
      partyAccountId: v.partyAccountId,
      payments: v.payments.map((p) => ({ accountId: p.accountId, amount: Number(p.amount) })),
      subtotal: Number(v.subtotal),
      discount: Number(v.discount),
      vatAmount: Number(v.vatAmount),
      total: Number(v.amount),
      cost: round2(v.items.reduce((s, i) => s + Number(i.costAmount), 0)),
    };
    const lines =
      v.type === "SALES" ? salesEntries(input, accounts)
      : v.type === "PURCHASE" ? purchaseEntries(input, accounts)
      : v.type === "SALES_RETURN" ? salesReturnEntries(input, accounts)
      : purchaseReturnEntries(input, accounts);
    await writeEntries(tx, v, lines);
  } else if (v.type === "STOCK_JOURNAL") {
    const valueIn = round2(v.items.filter((i) => i.direction === 1).reduce((s, i) => s + Number(i.costAmount), 0));
    const valueOut = round2(v.items.filter((i) => i.direction === -1).reduce((s, i) => s + Number(i.costAmount), 0));
    await tx.voucher.update({ where: { id: v.id }, data: { amount: Math.max(valueIn, valueOut) } });
    const label = v.adjustmentAccountId ? "মজুদ বাতিল (ক্ষতি)" : undefined;
    await writeEntries(tx, v, stockJournalEntries(valueIn, valueOut, accounts, v.adjustmentAccountId, label), { allowEmpty: true });
  }
}

type Move = Prisma.StockMovementGetPayload<{ include: { voucher: { select: { type: true } } } }>;

/**
 * Replays every product's movements chronologically. Returns ids of vouchers whose
 * line costs changed (they have already been reposted).
 */
export async function revalueProducts(tx: Tx, businessId: string, productIds: Iterable<string>, opts: { skipRepost?: Set<string> } = {}) {
  const changedVouchers = new Set<string>();
  for (const productId of new Set(productIds)) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { id: true, name: true, purchasePrice: true, trackBatch: true } });
    const moves: Move[] = await tx.stockMovement.findMany({
      where: { productId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: { voucher: { select: { type: true } } },
    });
    let qty = 0;
    let avg = 0;
    const byKey = new Map<string, number>(); // warehouse|batch → qty
    const itemCost = new Map<string, { voucherId: string; cost: number; qty: number }>();

    for (const m of moves) {
      const qin = Number(m.quantityIn);
      const qout = Number(m.quantityOut);
      const key = `${m.warehouseId}|${product.trackBatch ? m.batchNo ?? "" : ""}`;
      let unitCost = Number(m.unitCost);
      const fallback = avg > 0 ? avg : Number(product.purchasePrice);
      if (qin > 0) {
        if (m.voucher?.type === "SALES_RETURN") unitCost = fallback; // returned goods come back at current average
        avg = weightedAverageCost(qty, avg, qin, unitCost);
        qty = round3(qty + qin);
        byKey.set(key, round3((byKey.get(key) ?? 0) + qin));
      } else if (qout > 0) {
        unitCost = fallback;
        qty = round3(qty - qout);
        const left = round3((byKey.get(key) ?? 0) - qout);
        byKey.set(key, left);
        if (left < -1e-9) {
          const batch = product.trackBatch && m.batchNo ? ` (ব্যাচ ${m.batchNo})` : "";
          throw new UserError(`"${product.name}"${batch} এর পর্যাপ্ত স্টক নেই — ${formatDate(m.date)} তারিখে মজুদ ঋণাত্মক হয়ে যায়`);
        }
      }
      unitCost = round4(unitCost);
      if (Math.abs(unitCost - Number(m.unitCost)) > 0.00005) {
        const value = round2((qin || qout) * unitCost);
        await tx.stockMovement.update({ where: { id: m.id }, data: { unitCost, value } });
        if (m.voucherId) changedVouchers.add(m.voucherId);
      }
      if (m.voucherItemId && m.voucherId) {
        const c = itemCost.get(m.voucherItemId) ?? { voucherId: m.voucherId, cost: 0, qty: 0 };
        c.cost += (qin || qout) * unitCost;
        c.qty += qin || qout;
        itemCost.set(m.voucherItemId, c);
      }
    }
    // Sync line costs (used by repostVoucher) with the replayed movement costs.
    for (const [itemId, c] of itemCost) {
      const item = await tx.voucherItem.findUnique({ where: { id: itemId }, select: { costAmount: true } });
      const costAmount = round2(c.cost);
      if (item && Math.abs(Number(item.costAmount) - costAmount) > 0.004) {
        await tx.voucherItem.update({ where: { id: itemId }, data: { costAmount, costRate: c.qty ? round4(c.cost / c.qty) : 0 } });
        changedVouchers.add(c.voucherId);
      }
    }
    await tx.product.update({ where: { id: productId }, data: { stock: round3(qty), avgCost: round4(avg) } });
    await syncBatchQuantities(tx, productId);
  }

  const acc = changedVouchers.size ? await systemAccounts(tx, businessId) : undefined;
  for (const id of changedVouchers) if (!opts.skipRepost?.has(id)) await repostVoucher(tx, id, acc);
  return changedVouchers;
}
