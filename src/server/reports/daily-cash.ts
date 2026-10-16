import "server-only";
// ডেইলী জমা-খরচ হিসাব (daily cash book / receipts & payments) for one date.
//
//   পূর্বের জমা   = balance of the chosen cash accounts before the date
//   আজকের রিসিট  = Σ the day's vouchers whose net effect on those accounts is a receipt
//   মোট রিসিট    = পূর্বের জমা + আজকের রিসিট
//   মোট পেমেন্ট   = Σ the day's vouchers whose net effect is a payment
//   অবশিষ্ট ক্যাশ = মোট রিসিট − মোট পেমেন্ট   (= the ledger balance at the end of the day)
//
// Each voucher is one line, netted over the chosen accounts: a transfer between two of them
// (cash → bank with "নগদ ও ব্যাংক") nets to zero and is left out. Opening-balance vouchers dated on the
// day (the books start date) count in পূর্বের জমা.
import type { VoucherType } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { dayOrToday, dayRange, formatDate, formatMoney } from "@/lib/format";
import { balancesBefore } from "../services/ledger";
import type { ReportDef, ReportRow } from "./types";

export type CashScope = "cash" | "cash-bank" | string; // or one cash / bank account id

export interface CashLine {
  voucherId: string;
  voucherNo: string;
  typeLabel: string;
  /** party, else the other side's accounts */
  particulars: string;
  narration: string | null;
  amount: number;
}

export interface DailyCash {
  date: string;
  scope: CashScope;
  scopeLabel: string;
  accounts: { id: string; name: string; kind: string }[];
  opening: number;
  receipts: CashLine[];
  payments: CashLine[];
  todayReceipts: number;
  totalReceipts: number;
  totalPayments: number;
  closing: number;
}


/** The cash / bank accounts a scope covers, and its label. */
export async function cashScopeAccounts(businessId: string, scope?: string) {
  const all = await prisma.account.findMany({
    where: { businessId, kind: { in: ["CASH", "BANK"] } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, isActive: true },
  });
  const one = scope && scope !== "cash" && scope !== "cash-bank" ? all.find((a) => a.id === scope) : undefined;
  if (one) return { scope: one.id, label: one.name, accounts: [one], all };
  if (scope === "cash-bank") return { scope: "cash-bank", label: "নগদ ও ব্যাংক", accounts: all, all };
  return { scope: "cash", label: "নগদ তহবিল", accounts: all.filter((a) => a.kind === "CASH"), all };
}

export async function dailyCash(businessId: string, params: { date?: string; scope?: string }): Promise<DailyCash> {
  const date = dayOrToday(params.date);
  const { scope, label, accounts } = await cashScopeAccounts(businessId, params.scope);
  const ids = accounts.map((a) => a.id);
  const range = dayRange(date, date) as { gte: Date; lt: Date };

  const [openMap, entries] = await Promise.all([
    ids.length ? balancesBefore(businessId, range.gte, ids) : new Map<string, number>(),
    ids.length ? prisma.journalEntry.findMany({ where: { businessId, accountId: { in: ids }, date: range }, select: { voucherId: true, debit: true, credit: true } }) : [],
  ]);
  let opening = round2([...openMap.values()].reduce((s, v) => s + v, 0));

  const net = new Map<string, number>();
  for (const e of entries) net.set(e.voucherId, (net.get(e.voucherId) ?? 0) + num(e.debit) - num(e.credit));
  const voucherIds = [...net].filter(([, v]) => round2(v) !== 0).map(([id]) => id);
  const vouchers = voucherIds.length
    ? await prisma.voucher.findMany({
        where: { id: { in: voucherIds }, businessId },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, voucherNo: true, type: true, narration: true,
          partyAccount: { select: { name: true } },
          entries: { orderBy: { lineNo: "asc" }, select: { accountId: true, debit: true, credit: true, account: { select: { name: true } } } },
        },
      })
    : [];

  const inScope = new Set(ids);
  const receipts: CashLine[] = [];
  const payments: CashLine[] = [];
  for (const v of vouchers) {
    const amount = round2(net.get(v.id) ?? 0);
    // an opening balance dated on this day (books start) is brought forward, not a receipt of the day
    if (v.type === "OPENING") {
      opening = round2(opening + amount);
      continue;
    }
    // the other side: credits for a receipt, debits for a payment, largest first
    const other = new Map<string, number>();
    for (const e of v.entries) {
      if (inScope.has(e.accountId)) continue;
      const side = amount > 0 ? num(e.credit) : num(e.debit);
      if (side > 0) other.set(e.account.name, (other.get(e.account.name) ?? 0) + side);
    }
    const names = [...other].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const particulars = v.partyAccount?.name ?? (names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "") : VOUCHER_TYPES[v.type as VoucherTypeKey]?.label ?? v.type);
    const line: CashLine = { voucherId: v.id, voucherNo: v.voucherNo, typeLabel: typeLabel(v.type), particulars, narration: v.narration, amount: Math.abs(amount) };
    (amount > 0 ? receipts : payments).push(line);
  }
  const todayReceipts = round2(receipts.reduce((s, l) => s + l.amount, 0));
  const totalPayments = round2(payments.reduce((s, l) => s + l.amount, 0));
  const totalReceipts = round2(opening + todayReceipts);
  return {
    date, scope, scopeLabel: label, accounts: accounts.map(({ id, name, kind }) => ({ id, name, kind })),
    opening, receipts, payments, todayReceipts, totalReceipts, totalPayments, closing: round2(totalReceipts - totalPayments),
  };
}

const typeLabel = (t: VoucherType) => VOUCHER_TYPES[t as VoucherTypeKey]?.label ?? t;

/** Registry entry: the reports index and the CSV / Excel export (the screen has its own two-column page). */
export const DAILY_CASH_REPORT: ReportDef = {
  slug: "daily-cash",
  title: "ডেইলী জমা-খরচ হিসাব",
  description: "নির্দিষ্ট দিনের পূর্বের জমা, রিসিট, পেমেন্ট ও অবশিষ্ট ক্যাশ — ক্যাশ খাতার মতো দুই কলামে, A4 প্রিন্টসহ",
  filters: [],
  permission: "accounts:view",
  async run(ctx, p) {
    const d = await dailyCash(ctx.business.id, { date: p.date, scope: p.scope });
    const cur = ctx.business.currencySymbol;
    const line = (l: CashLine, i: number): ReportRow => ({ href: `/vouchers/v/${l.voucherId}`, cells: { no: String(i + 1), voucher: l.voucherNo, particulars: [l.particulars, l.typeLabel, l.narration].filter(Boolean).join(" — "), amount: l.amount } });
    const rows: ReportRow[] = [
      { kind: "group", cells: { no: null, voucher: "", particulars: "জমা / রিসিট", amount: null } },
      { kind: "subtotal", cells: { no: null, voucher: "", particulars: "পূর্বের জমা (প্রারম্ভিক ব্যালেন্স)", amount: d.opening } },
      ...d.receipts.map(line),
      { kind: "subtotal", cells: { no: null, voucher: "", particulars: "আজকের রিসিট", amount: d.todayReceipts } },
      { kind: "total", cells: { no: null, voucher: "", particulars: "মোট রিসিট", amount: d.totalReceipts } },
      { kind: "group", cells: { no: null, voucher: "", particulars: "খরচ / পেমেন্ট", amount: null } },
      ...d.payments.map(line),
      { kind: "total", cells: { no: null, voucher: "", particulars: "মোট পেমেন্ট", amount: d.totalPayments } },
      { kind: "total", cells: { no: null, voucher: "", particulars: "অবশিষ্ট ক্যাশ (সমাপনী ব্যালেন্স)", amount: d.closing } },
    ];
    return {
      title: "ডেইলী জমা-খরচ হিসাব",
      subtitle: `${formatDate(d.date)} — ${d.scopeLabel}`,
      columns: [{ key: "no", label: "নং" }, { key: "voucher", label: "ভাউচার" }, { key: "particulars", label: "বিবরণ" }, { key: "amount", label: "টাকা", format: "money" }],
      rows,
      summary: [
        { label: "মোট রিসিট", value: formatMoney(d.totalReceipts, cur), tone: "green" },
        { label: "মোট পেমেন্ট", value: formatMoney(d.totalPayments, cur), tone: "red" },
        { label: "অবশিষ্ট ক্যাশ", value: formatMoney(d.closing, cur), tone: "blue" },
      ],
    };
  },
};
