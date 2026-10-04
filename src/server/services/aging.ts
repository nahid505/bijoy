// Due aging (বাকি বয়স বিশ্লেষণ) for customers and suppliers.
// Payments / returns / credit notes are allocated to the OLDEST open invoices first (FIFO),
// so the result reconciles exactly with the party ledger balance.
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/calc";

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

export interface OpenItem {
  voucherId: string;
  voucherNo: string;
  date: Date;
  dueDate: Date;
  amount: number;
  open: number;
  daysOld: number;
  overdueDays: number;
}

export interface AgingRow {
  accountId: string;
  name: string;
  mobile: string | null;
  partyId: string;
  creditLimit: number;
  creditDays: number;
  balance: number; // in the party's natural direction (customer: receivable, supplier: payable)
  overdue: number;
  buckets: Record<AgingBucket, number>;
  openItems: OpenItem[];
}

const DAY = 86_400_000;

function bucketOf(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/** `asOf` is a business date (UTC midnight); entries dated on or before it are included. */
export async function partyAging(businessId: string, kind: "CUSTOMER" | "SUPPLIER", asOf: Date, accountIds?: string[]): Promise<AgingRow[]> {
  const parties =
    kind === "CUSTOMER"
      ? (await prisma.customer.findMany({ where: { businessId, ...(accountIds ? { accountId: { in: accountIds } } : {}) }, orderBy: { name: "asc" } })).map((c) => ({ ...c, creditLimit: Number(c.creditLimit) }))
      : (await prisma.supplier.findMany({ where: { businessId, ...(accountIds ? { accountId: { in: accountIds } } : {}) }, orderBy: { name: "asc" } })).map((s) => ({ ...s, creditLimit: 0 }));
  if (parties.length === 0) return [];
  const until = new Date(asOf.getTime() + DAY);
  const entries = await prisma.journalEntry.findMany({
    where: { businessId, accountId: { in: parties.map((p) => p.accountId) }, date: { lt: until } },
    orderBy: [{ date: "asc" }, { voucher: { createdAt: "asc" } }, { lineNo: "asc" }],
    select: { accountId: true, date: true, debit: true, credit: true, voucher: { select: { id: true, voucherNo: true, dueDate: true } } },
  });
  const sign = kind === "CUSTOMER" ? 1 : -1; // customer: debit increases due; supplier: credit increases due
  const byAccount = new Map<string, typeof entries>();
  for (const e of entries) (byAccount.get(e.accountId) ?? byAccount.set(e.accountId, []).get(e.accountId)!).push(e);

  return parties.map((p) => {
    const list = byAccount.get(p.accountId) ?? [];
    const increases: OpenItem[] = [];
    let decreases = 0;
    for (const e of list) {
      const delta = sign * (Number(e.debit) - Number(e.credit));
      if (delta > 0) {
        const due = e.voucher.dueDate ?? new Date(e.date.getTime() + p.creditDays * DAY);
        const daysOld = Math.max(0, Math.round((asOf.getTime() - e.date.getTime()) / DAY));
        const overdueDays = Math.max(0, Math.round((asOf.getTime() - due.getTime()) / DAY));
        increases.push({ voucherId: e.voucher.id, voucherNo: e.voucher.voucherNo, date: e.date, dueDate: due, amount: round2(delta), open: round2(delta), daysOld, overdueDays });
      } else if (delta < 0) {
        decreases += -delta;
      }
    }
    // FIFO allocation of payments / returns to the oldest items
    let left = round2(decreases);
    for (const it of increases) {
      if (left <= 0) break;
      const used = Math.min(left, it.open);
      it.open = round2(it.open - used);
      left = round2(left - used);
    }
    const openItems = increases.filter((i) => i.open > 0);
    const buckets: Record<AgingBucket, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    let overdue = 0;
    for (const i of openItems) {
      buckets[bucketOf(i.daysOld)] = round2(buckets[bucketOf(i.daysOld)] + i.open);
      if (i.overdueDays > 0) overdue = round2(overdue + i.open);
    }
    const balance = round2(openItems.reduce((s, i) => s + i.open, 0) - left); // negative = advance
    return {
      accountId: p.accountId, name: p.name, mobile: p.mobile, partyId: p.id, creditLimit: p.creditLimit, creditDays: p.creditDays,
      balance, overdue, buckets, openItems,
    };
  });
}
