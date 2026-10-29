import "server-only";
// ডেইলী জমা-খরচ হিসাব (daily cash book / receipts & payments) for one date.
//
//   পূর্বের জমা   = balance of the chosen cash accounts before the date
//   আজকের রিসিট  = Σ the day's vouchers whose net effect on those accounts is a receipt
//   মোট রিসিট    = পূর্বের জমা + আজকের রিসিট
//   মোট পেমেন্ট   = Σ the day's vouchers whose net effect is a payment
//   অবশিষ্ট ক্যাশ = মোট রিসিট − মোট পেমেন্ট   (= the ledger balance at the end of the day)
//
// Each voucher is netted over the chosen accounts: a transfer between two of them (cash → bank with "নগদ ও ব্যাংক")
// nets to zero and is left out. What is left becomes one line per ledger on the other side — never joined:
//   a voucher with a party (sale, purchase, collection, payment to a supplier) → one line, the party, the whole amount;
//   otherwise each counter ledger on the other side (credits for a receipt, debits for a payment, netted per ledger,
//   in entry order) → its own line with its own amount. Should the voucher also hold entries that do not touch cash,
//   the cash amount is allotted to those ledgers in entry order, so the lines always add up to the cash moved. Opening-balance vouchers dated on the
// day (the books start date) count in পূর্বের জমা.
//
// বিবরণ of a line, two rows:  "<ledger>, <address> (<entered by>)"  /  "বর্তমান জের: <balance>, <note>"
// The balance is the line's own ledger right after that voucher — its running balance through the day, so on today's
// report the last line of a ledger shows its balance now.
import type { VoucherType } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { dayOrToday, dayRange, formatDate, formatDrCr, formatMoney } from "@/lib/format";
import { balancesBefore } from "../services/ledger";
import type { ReportDef, ReportRow } from "./types";

export type CashScope = "cash" | "cash-bank" | string; // or one cash / bank account id

export interface CashLine {
  /** unique per line: voucher + ledger (a voucher can give several lines) */
  key: string;
  voucherId: string;
  /** the line's ledger (null only for a voucher with no ledger on the other side) */
  accountId: string | null;
  voucherNo: string;
  typeLabel: string;
  /** the line's ledger: the party, or one counter ledger */
  particulars: string;
  /** who entered the voucher */
  enteredBy: string | null;
  /** the ledger's address (customer / supplier), when it has one */
  address: string | null;
  /** debit − credit of the line's ledger right after this voucher */
  balance: number | null;
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
    ids.length ? prisma.journalEntry.findMany({ where: { businessId, book: "GENERAL", accountId: { in: ids }, date: range }, select: { voucherId: true, debit: true, credit: true } }) : [],
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
          partyAccountId: true,
          partyAccount: { select: { name: true } },
          createdBy: { select: { name: true } },
          entries: { orderBy: { lineNo: "asc" }, select: { accountId: true, debit: true, credit: true, narration: true, account: { select: { name: true } } } },
        },
      })
    : [];

  const inScope = new Set(ids);
  // the lines of each voucher: one per ledger on the other side (see the header)
  type Part = { accountId: string | null; name: string; amount: number };
  const partsOf = new Map<string, Part[]>();
  for (const v of vouchers) {
    if (v.type === "OPENING") continue;
    const amount = round2(net.get(v.id) ?? 0);
    const total = Math.abs(amount);
    if (v.partyAccountId) {
      partsOf.set(v.id, [{ accountId: v.partyAccountId, name: v.partyAccount?.name ?? "", amount: total }]);
      continue;
    }
    // counter ledgers, netted per ledger: + on the cash's other side (credit for a receipt, debit for a payment)
    const per = new Map<string, { name: string; net: number }>();
    for (const e of v.entries) {
      if (inScope.has(e.accountId)) continue;
      const side = amount > 0 ? num(e.credit) - num(e.debit) : num(e.debit) - num(e.credit);
      const cur = per.get(e.accountId) ?? { name: e.account.name, net: 0 };
      cur.net = round2(cur.net + side);
      per.set(e.accountId, cur);
    }
    const parts: Part[] = [];
    let left = total;
    for (const [accountId, { name, net: n }] of per) {
      if (n <= 0 || left <= 0) continue;
      const share = round2(Math.min(n, left));
      parts.push({ accountId, name, amount: share });
      left = round2(left - share);
    }
    if (!parts.length) parts.push({ accountId: null, name: VOUCHER_TYPES[v.type as VoucherTypeKey]?.label ?? v.type, amount: total });
    else if (left > 0) parts[parts.length - 1].amount = round2(parts[parts.length - 1].amount + left); // rounding only
    partsOf.set(v.id, parts);
  }
  const lineAccounts = [...new Set([...partsOf.values()].flat().flatMap((x) => (x.accountId ? [x.accountId] : [])))];
  const [before, dayEntries, info] = lineAccounts.length
    ? await Promise.all([
        balancesBefore(businessId, range.gte, lineAccounts),
        prisma.journalEntry.findMany({
          where: { businessId, book: "GENERAL", accountId: { in: lineAccounts }, date: range },
          select: { accountId: true, voucherId: true, debit: true, credit: true, voucher: { select: { date: true, createdAt: true } } },
        }),
        prisma.account.findMany({ where: { id: { in: lineAccounts }, businessId }, select: { id: true, customer: { select: { address: true } }, supplier: { select: { address: true } } } }),
      ])
    : [new Map<string, number>(), [], []];
  // running balance through the day, in voucher order (date, then entry time — the order of the report)
  const runAfter = new Map<string, number>(); // "accountId|voucherId" → balance after that voucher
  const running = new Map(lineAccounts.map((a) => [a, before.get(a) ?? 0]));
  const ordered = [...dayEntries].sort((a, b) => +a.voucher.date - +b.voucher.date || +a.voucher.createdAt - +b.voucher.createdAt || a.voucherId.localeCompare(b.voucherId));
  for (const e of ordered) {
    const bal = round2((running.get(e.accountId) ?? 0) + num(e.debit) - num(e.credit));
    running.set(e.accountId, bal);
    runAfter.set(`${e.accountId}|${e.voucherId}`, bal);
  }
  const addressOf = new Map(info.map((a) => [a.id, a.customer?.address?.trim() || a.supplier?.address?.trim() || null]));

  const receipts: CashLine[] = [];
  const payments: CashLine[] = [];
  for (const v of vouchers) {
    const amount = round2(net.get(v.id) ?? 0);
    // an opening balance dated on this day (books start) is brought forward, not a receipt of the day
    if (v.type === "OPENING") {
      opening = round2(opening + amount);
      continue;
    }
    const enteredBy = v.createdBy?.name?.trim() || null;
    for (const [i, part] of (partsOf.get(v.id) ?? []).entries()) {
      const line: CashLine = {
        key: `${v.id}:${part.accountId ?? i}`,
        voucherId: v.id, accountId: part.accountId, voucherNo: v.voucherNo, typeLabel: typeLabel(v.type),
        particulars: part.name,
        enteredBy,
        address: part.accountId ? (addressOf.get(part.accountId) ?? null) : null,
        balance: part.accountId ? (runAfter.get(`${part.accountId}|${v.id}`) ?? null) : null,
        // the note: the line's own (a voucher with several ledgers can note each), else the voucher's
        narration: (part.accountId ? v.entries.find((e) => e.accountId === part.accountId && e.narration?.trim())?.narration?.trim() : null) || v.narration?.trim() || null,
        amount: part.amount,
      };
      (amount > 0 ? receipts : payments).push(line);
    }
  }
  const todayReceipts = round2(receipts.reduce((s, l) => s + l.amount, 0));
  const totalPayments = round2(payments.reduce((s, l) => s + l.amount, 0));
  const totalReceipts = round2(opening + todayReceipts);
  return {
    date, scope, scopeLabel: label, accounts: accounts.map(({ id, name, kind }) => ({ id, name, kind })),
    opening, receipts, payments, todayReceipts, totalReceipts, totalPayments, closing: round2(totalReceipts - totalPayments),
  };
}

/** বিবরণ row 1: "সাইফুল, বীরগঞ্জ, দিনাজপুর (Delower)" — no address → "সাইফুল (Delower)"; no brackets when nobody is recorded */
export function cashLineTitle(l: Pick<CashLine, "particulars" | "address" | "enteredBy">): string {
  const name = [l.particulars, l.address].filter(Boolean).join(", ");
  return l.enteredBy ? `${name} (${l.enteredBy})` : name;
}

/** বিবরণ row 2: "বর্তমান জের: ৳ ২,৫৫৫.০০ ডেবিট, চাউল ক্রয় বাবদ" — no note → the balance alone ("" when neither) */
export function cashLineDetail(l: Pick<CashLine, "balance" | "narration">, money: (n: number) => string, label = "বর্তমান জের:"): string {
  return [l.balance !== null ? `${label} ${money(l.balance)}` : null, l.narration?.trim() || null].filter(Boolean).join(", ");
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
    const line = (l: CashLine, i: number): ReportRow => ({ href: `/vouchers/v/${l.voucherId}`, cells: { no: String(i + 1), voucher: l.voucherNo, particulars: [cashLineTitle(l), cashLineDetail(l, (n) => formatDrCr(n, cur))].filter(Boolean).join(" — "), amount: l.amount } });
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
