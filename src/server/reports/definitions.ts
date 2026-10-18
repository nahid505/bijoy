import "server-only";
import type { Prisma, VoucherType } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { naturalBalance, VOUCHER_TYPES, type Nature, type VoucherTypeKey } from "@/lib/accounting";
import { dayRange, formatDate, formatDrCr, formatMoney, toDateInput } from "@/lib/format";
import { reportPeriod } from "../period";
import { listAccounts, partySummaries, statement } from "../services/ledger";
import { balanceSheet, profitAndLoss, trialBalance } from "../services/report";
import type { ReportDef, ReportParams, ReportResult, ReportRow } from "./types";
import type { AppContext } from "../auth";
import { ci } from "@/lib/dialect";
import type { BookKey } from "@/lib/book";
import { allowedAccounts, canOpenLedger, partyListWhere, voucherScopeWhere } from "../party-scope";

const typeLabel = (t: VoucherType) => VOUCHER_TYPES[t as VoucherTypeKey].label;
const periodText = (from: string, to: string) => `${formatDate(from)} — ${formatDate(to)}`;
const voucherHref = (id: string) => `/vouchers/v/${id}`;

function asOfRange(p: ReportParams) {
  const asOf = p.asOf && /^\d{4}-\d{2}-\d{2}$/.test(p.asOf) ? p.asOf : toDateInput();
  return { asOf, lt: dayRange(asOf, asOf).lt! };
}

// ───────────────────────── statements over ledgers ─────────────────────────

/** Ledger / cash book of one book (GENERAL by default; the depot reports pass DEPOT). */
export async function ledgerReport(ctx: AppContext, p: ReportParams, accountIds: string[], title: string, book: BookKey = "GENERAL"): Promise<ReportResult> {
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const st = await statement(ctx.business.id, accountIds, range, { book });
  const multi = accountIds.length > 1;
  const q = p.q?.trim().toLowerCase();
  const lines = q ? st.lines.filter((l) => `${l.voucherNo} ${l.narration ?? ""} ${l.against}`.toLowerCase().includes(q)) : st.lines;
  const rows: ReportRow[] = [
    { kind: "group", cells: { date: null, voucher: "", type: "", particulars: "প্রারম্ভিক ব্যালেন্স", debit: null, credit: null, balance: st.opening } },
    ...lines.map((l) => ({
      href: voucherHref(l.voucherId),
      cells: {
        date: l.date,
        voucher: l.voucherNo,
        type: typeLabel(l.voucherType),
        particulars: [multi ? `[${l.accountName}]` : null, l.against, l.narration].filter(Boolean).join(" — "),
        debit: l.debit || null,
        credit: l.credit || null,
        balance: l.balance,
      },
    })),
    { kind: "total", cells: { date: null, voucher: "", type: "", particulars: "মোট / সমাপনী ব্যালেন্স", debit: st.totalDebit, credit: st.totalCredit, balance: st.closing } },
  ];
  return {
    title,
    subtitle: periodText(from, to),
    columns: [
      { key: "date", label: "তারিখ", format: "date" },
      { key: "voucher", label: "ভাউচার" },
      { key: "type", label: "ধরন" },
      { key: "particulars", label: "বিবরণ (বিপরীত হিসাব)" },
      { key: "debit", label: "ডেবিট", format: "money" },
      { key: "credit", label: "ক্রেডিট", format: "money" },
      { key: "balance", label: "ব্যালেন্স", format: "drcr" },
    ],
    rows,
    summary: [
      { label: "প্রারম্ভিক", value: formatDrCr(st.opening, cur) },
      { label: "মোট ডেবিট", value: formatMoney(st.totalDebit, cur), tone: "blue" },
      { label: "মোট ক্রেডিট", value: formatMoney(st.totalCredit, cur), tone: "red" },
      { label: "সমাপনী", value: formatDrCr(st.closing, cur), tone: "green" },
    ],
  };
}

/** heads: the assigned account heads of a restricted user (null = all) */
async function kindAccounts(businessId: string, kind: "CASH" | "BANK", selected?: string, heads: string[] | null = null) {
  const all = await prisma.account.findMany({ where: { businessId, kind, ...(heads ? { id: { in: heads } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const ids = selected && all.some((a) => a.id === selected) ? [selected] : all.map((a) => a.id);
  return { ids, names: all.filter((a) => ids.includes(a.id)).map((a) => a.name) };
}

// ───────────────────────── party reports ─────────────────────────

/** Profit & loss of one book (GENERAL by default; the depot P&L passes DEPOT). */
export async function plReport(ctx: AppContext, p: ReportParams, book: BookKey = "GENERAL", title = "লাভ-ক্ষতি হিসাব"): Promise<ReportResult> {
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const pl = await profitAndLoss(ctx.business.id, range, book);
  const rows: ReportRow[] = [];
  const section = (title: string, lines: { accountId: string; name: string; amount: number }[], subtotalLabel: string, subtotal: number) => {
    rows.push({ kind: "group", cells: { particulars: title, amount: null } });
    for (const l of lines) rows.push({ indent: 1, href: book === "GENERAL" ? `/accounts/${l.accountId}` : undefined, cells: { particulars: l.name, amount: l.amount } });
    rows.push({ kind: "subtotal", cells: { particulars: subtotalLabel, amount: subtotal } });
  };
  section("বিক্রয় আয়", pl.salesLines, "নিট বিক্রয়", pl.netSales);
  section("বিক্রিত পণ্যের ব্যয়", pl.directExpenseLines, "মোট প্রত্যক্ষ ব্যয়", pl.directExpenses);
  rows.push({ kind: "total", cells: { particulars: "মোট লাভ (গ্রস প্রফিট)", amount: pl.grossProfit } });
  section("অন্যান্য আয়", pl.otherIncomeLines, "মোট অন্যান্য আয়", pl.otherIncome);
  section("পরিচালন ব্যয়", pl.expenseLines, "মোট পরিচালন ব্যয়", pl.expenses);
  rows.push({ kind: "total", cells: { particulars: pl.netProfit >= 0 ? "নিট লাভ" : "নিট ক্ষতি", amount: pl.netProfit } });
  return {
    title,
    subtitle: periodText(from, to),
    columns: [{ key: "particulars", label: "বিবরণ" }, { key: "amount", label: "টাকা", format: "money" }],
    rows,
    summary: [
      { label: "নিট বিক্রয়", value: formatMoney(pl.netSales, cur), tone: "blue" },
      { label: "গ্রস প্রফিট", value: formatMoney(pl.grossProfit, cur), tone: pl.grossProfit >= 0 ? "green" : "red" },
      { label: pl.netProfit >= 0 ? "নিট লাভ" : "নিট ক্ষতি", value: formatMoney(pl.netProfit, cur), tone: pl.netProfit >= 0 ? "green" : "red" },
    ],
  };
}

/** Cash book (all cash ledgers, or one) of one book. */
export async function cashBookReport(ctx: AppContext, p: ReportParams, book: BookKey = "GENERAL", title = "ক্যাশ বুক"): Promise<ReportResult> {
  const { ids, names } = await kindAccounts(ctx.business.id, "CASH", p.accountId, allowedAccounts(ctx));
  if (!ids.length) return { title, columns: [], rows: [], emptyMessage: "কোনো নগদ হিসাব নেই" };
  return ledgerReport(ctx, p, ids, `${title} — ${names.join(", ")}`, book);
}

async function partyReport(ctx: AppContext, p: ReportParams, kind: "CUSTOMER" | "SUPPLIER"): Promise<ReportResult> {
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim();
  const where = { businessId: ctx.business.id, ...partyListWhere(ctx, kind), ...(kind === "CUSTOMER" ? { isDepotDealer: false } : {}), ...(q ? { OR: [{ name: ci(q) }, { mobile: { contains: q } }] } : {}) };
  const parties =
    kind === "CUSTOMER"
      ? await prisma.customer.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, mobile: true, accountId: true } })
      : await prisma.supplier.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, mobile: true, accountId: true } });
  const sums = await partySummaries(ctx.business.id, kind, range, parties.map((x) => x.accountId));
  let tOpen = 0, tDr = 0, tCr = 0, tClose = 0;
  const rows: ReportRow[] = parties.map((x) => {
    const s = sums.get(x.accountId) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
    tOpen += s.opening; tDr += s.debit; tCr += s.credit; tClose += s.closing;
    return {
      href: `/${kind === "CUSTOMER" ? "customers" : "suppliers"}/${x.id}`,
      cells: { name: x.name, mobile: x.mobile, opening: s.opening, debit: s.debit || null, credit: s.credit || null, closing: s.closing },
    };
  });
  rows.push({ kind: "total", cells: { name: "মোট", mobile: "", opening: round2(tOpen), debit: round2(tDr), credit: round2(tCr), closing: round2(tClose) } });
  const isCustomer = kind === "CUSTOMER";
  return {
    title: isCustomer ? "কাস্টমার রিপোর্ট" : "সরবরাহকারী রিপোর্ট",
    subtitle: periodText(from, to),
    columns: [
      { key: "name", label: "নাম" },
      { key: "mobile", label: "মোবাইল" },
      { key: "opening", label: "প্রারম্ভিক", format: "drcr" },
      { key: "debit", label: isCustomer ? "বিক্রয়/ডেবিট" : "পরিশোধ/ডেবিট", format: "money" },
      { key: "credit", label: isCustomer ? "আদায়/ক্রেডিট" : "ক্রয়/ক্রেডিট", format: "money" },
      { key: "closing", label: isCustomer ? "পাওনা (সমাপনী)" : "দেনা (সমাপনী)", format: "drcr" },
    ],
    rows,
    summary: [{ label: isCustomer ? "মোট পাওনা" : "মোট দেনা", value: formatMoney(isCustomer ? tClose : -tClose, cur), tone: "red" }],
  };
}

// ───────────────────────── trade (sales / purchase) registers ─────────────────────────

async function tradeRegister(ctx: AppContext, p: ReportParams, types: ["SALES", "SALES_RETURN"] | ["PURCHASE", "PURCHASE_RETURN"]): Promise<ReportResult> {
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim();
  const where: Prisma.VoucherWhereInput = {
    businessId: ctx.business.id,
    book: "GENERAL", // depot stock in / market sales are in the depot book
    ...voucherScopeWhere(ctx),
    type: { in: types },
    date: range,
    ...(q ? { OR: [{ voucherNo: ci(q) }, { partyAccount: { name: ci(q) } }, { reference: ci(q) }] } : {}),
  };
  const vouchers = await prisma.voucher.findMany({ where, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 5000, include: { partyAccount: { select: { name: true } } } });
  const t = { subtotal: 0, discount: 0, vat: 0, total: 0, paid: 0, returns: 0 };
  const rows: ReportRow[] = vouchers.map((v) => {
    const isReturn = v.type === types[1];
    const sign = isReturn ? -1 : 1;
    const total = num(v.amount) * sign;
    const paid = num(v.paidAmount) * sign;
    if (isReturn) t.returns += num(v.amount);
    else {
      t.subtotal += num(v.subtotal); t.discount += num(v.discount); t.vat += num(v.vatAmount);
    }
    t.total += total; t.paid += paid;
    return {
      href: voucherHref(v.id),
      cells: {
        date: v.date, voucher: v.voucherNo, type: typeLabel(v.type), party: v.partyAccount?.name ?? "নগদ",
        subtotal: isReturn ? null : num(v.subtotal), discount: isReturn ? null : num(v.discount) || null, vat: isReturn ? null : num(v.vatAmount) || null,
        total, paid: paid || null, due: round2(total - paid) || null,
      },
    };
  });
  rows.push({ kind: "total", cells: { date: null, voucher: "", type: "", party: "মোট", subtotal: round2(t.subtotal), discount: round2(t.discount), vat: round2(t.vat), total: round2(t.total), paid: round2(t.paid), due: round2(t.total - t.paid) } });
  const sales = types[0] === "SALES";
  return {
    title: sales ? "বিক্রয় রিপোর্ট" : "ক্রয় রিপোর্ট",
    subtitle: periodText(from, to),
    columns: [
      { key: "date", label: "তারিখ", format: "date" },
      { key: "voucher", label: "ভাউচার" },
      { key: "type", label: "ধরন" },
      { key: "party", label: sales ? "কাস্টমার" : "সরবরাহকারী" },
      { key: "subtotal", label: "উপমোট", format: "money" },
      { key: "discount", label: "ছাড়", format: "money" },
      ...(sales ? [{ key: "vat", label: "ভ্যাট", format: "money" as const }] : []),
      { key: "total", label: "মোট", format: "money" },
      { key: "paid", label: sales ? "আদায়" : "পরিশোধ", format: "money" },
      { key: "due", label: "বাকি", format: "money" },
    ],
    rows,
    summary: [
      { label: sales ? "মোট বিক্রয়" : "মোট ক্রয়", value: formatMoney(t.total + t.returns, cur), tone: "blue" },
      { label: sales ? "বিক্রয় ফেরত" : "ক্রয় ফেরত", value: formatMoney(t.returns, cur), tone: "red" },
      { label: "নিট", value: formatMoney(t.total, cur), tone: "green" },
      { label: sales ? "নগদে আদায়" : "নগদে পরিশোধ", value: formatMoney(t.paid, cur) },
    ],
  };
}

// ───────────────────────── registry ─────────────────────────

export const REPORTS: ReportDef[] = [
  {
    slug: "day-book",
    title: "ডে বুক",
    description: "নির্দিষ্ট সময়ের সকল ভাউচার ও তাদের ডেবিট-ক্রেডিট এন্ট্রি",
    filters: ["range", "q", "voucherType"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const q = p.q?.trim();
      const type = p.type && p.type in VOUCHER_TYPES ? (p.type as VoucherType) : undefined;
      const vouchers = await prisma.voucher.findMany({
        where: {
          businessId: ctx.business.id,
          book: "GENERAL", // the depot keeps its own day book
          ...voucherScopeWhere(ctx), // account-head restriction: vouchers of my heads
          date: range,
          ...(type ? { type } : {}),
          ...(q ? { OR: [{ voucherNo: ci(q) }, { narration: ci(q) }, { reference: ci(q) }, { partyAccount: { name: ci(q) } }] } : {}),
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take: 1000,
        include: { partyAccount: { select: { name: true } }, entries: { orderBy: { lineNo: "asc" }, include: { account: { select: { name: true } } } } },
      });
      let dr = 0, crt = 0;
      const rows: ReportRow[] = [];
      for (const v of vouchers) {
        rows.push({ kind: "group", href: voucherHref(v.id), cells: { date: v.date, voucher: v.voucherNo, type: typeLabel(v.type), particulars: v.partyAccount?.name ?? v.narration ?? "", debit: null, credit: null } });
        for (const e of v.entries) {
          dr += num(e.debit); crt += num(e.credit);
          rows.push({ kind: "detail", indent: 1, cells: { date: null, voucher: "", type: "", particulars: e.account.name, debit: num(e.debit) || null, credit: num(e.credit) || null } });
        }
      }
      rows.push({ kind: "total", cells: { date: null, voucher: "", type: "", particulars: "মোট", debit: round2(dr), credit: round2(crt) } });
      return {
        title: "ডে বুক",
        subtitle: periodText(from, to),
        columns: [
          { key: "date", label: "তারিখ", format: "date" },
          { key: "voucher", label: "ভাউচার" },
          { key: "type", label: "ধরন" },
          { key: "particulars", label: "বিবরণ / হিসাব" },
          { key: "debit", label: "ডেবিট", format: "money" },
          { key: "credit", label: "ক্রেডিট", format: "money" },
        ],
        rows,
        summary: [{ label: "ভাউচার সংখ্যা", value: String(vouchers.length) }, { label: "ডেবিট = ক্রেডিট", value: round2(dr) === round2(crt) ? "✔ মিলেছে" : "✘ মেলেনি", tone: round2(dr) === round2(crt) ? "green" : "red" }],
      };
    },
  },
  {
    slug: "ledger",
    title: "লেজার রিপোর্ট",
    description: "যেকোনো হিসাবের বিস্তারিত খতিয়ান ও চলমান ব্যালেন্স",
    filters: ["account", "range", "q"],
    permission: "reports:view",
    async run(ctx, p) {
      const account = p.accountId ? await prisma.account.findFirst({ where: { id: p.accountId, businessId: ctx.business.id } }) : null;
      if (!account) return { title: "লেজার রিপোর্ট", columns: [], rows: [], emptyMessage: "রিপোর্ট দেখতে একটি হিসাব (লেজার) নির্বাচন করুন" };
      if (!(await canOpenLedger(ctx, account.id))) return { title: "লেজার রিপোর্ট", columns: [], rows: [], emptyMessage: "এই লেজারটি আপনার জন্য নির্ধারিত নয় — শুধু নির্ধারিত কাস্টমার/সরবরাহকারীর লেজার দেখা যাবে" };
      return ledgerReport(ctx, p, [account.id], `লেজার: ${account.name}`);
    },
  },
  {
    slug: "cash-book",
    title: "ক্যাশ বুক",
    description: "নগদ হিসাবের প্রাপ্তি ও প্রদান",
    filters: ["cashAccount", "range", "q"],
    permission: "accounts:view",
    run: (ctx, p) => cashBookReport(ctx, p),
  },
  {
    slug: "bank-book",
    title: "ব্যাংক বুক",
    description: "ব্যাংক ও মোবাইল ব্যাংকিং হিসাবের লেনদেন",
    filters: ["bankAccount", "range", "q"],
    permission: "accounts:view",
    async run(ctx, p) {
      const { ids, names } = await kindAccounts(ctx.business.id, "BANK", p.accountId, allowedAccounts(ctx));
      if (!ids.length) return { title: "ব্যাংক বুক", columns: [], rows: [], emptyMessage: "কোনো ব্যাংক হিসাব নেই" };
      return ledgerReport(ctx, p, ids, `ব্যাংক বুক — ${names.join(", ")}`);
    },
  },
  {
    slug: "trial-balance",
    title: "ট্রায়াল ব্যালেন্স",
    description: "সকল লেজারের ডেবিট ও ক্রেডিট ব্যালেন্সের সমতা যাচাই",
    filters: ["range"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const tb = await trialBalance(ctx.business.id, range);
      const rows: ReportRow[] = [];
      let lastGroup = "";
      for (const r of tb.rows) {
        if (r.groupName !== lastGroup) {
          rows.push({ kind: "group", cells: { account: r.groupName, opening: null, debit: null, credit: null, closingDr: null, closingCr: null } });
          lastGroup = r.groupName;
        }
        rows.push({
          indent: 1,
          href: `/accounts/${r.id}`,
          cells: { account: r.name, opening: r.opening, debit: r.debit || null, credit: r.credit || null, closingDr: r.closing > 0 ? r.closing : null, closingCr: r.closing < 0 ? -r.closing : null },
        });
      }
      rows.push({ kind: "total", cells: { account: "মোট", opening: null, debit: tb.totals.debit, credit: tb.totals.credit, closingDr: tb.totals.closingDebit, closingCr: tb.totals.closingCredit } });
      return {
        title: "ট্রায়াল ব্যালেন্স",
        subtitle: periodText(from, to),
        columns: [
          { key: "account", label: "হিসাব" },
          { key: "opening", label: "প্রারম্ভিক", format: "drcr" },
          { key: "debit", label: "ডেবিট (সময়কাল)", format: "money" },
          { key: "credit", label: "ক্রেডিট (সময়কাল)", format: "money" },
          { key: "closingDr", label: "সমাপনী ডেবিট", format: "money" },
          { key: "closingCr", label: "সমাপনী ক্রেডিট", format: "money" },
        ],
        rows,
        summary: [
          { label: "সমাপনী ডেবিট", value: formatMoney(tb.totals.closingDebit, cur), tone: "blue" },
          { label: "সমাপনী ক্রেডিট", value: formatMoney(tb.totals.closingCredit, cur), tone: "red" },
          { label: "অবস্থা", value: tb.balanced ? "✔ ব্যালেন্সড" : "✘ অমিল", tone: tb.balanced ? "green" : "red" },
        ],
      };
    },
  },
  {
    slug: "profit-loss",
    title: "লাভ-ক্ষতি হিসাব",
    description: "আয়, বিক্রিত পণ্যের ব্যয়, পরিচালন ব্যয় ও নিট লাভ",
    filters: ["range"],
    permission: "reports:view",
    run: (ctx, p) => plReport(ctx, p),
  },
  {
    slug: "balance-sheet",
    title: "ব্যালান্স শীট",
    description: "নির্দিষ্ট তারিখে সম্পদ, দায় ও মূলধনের অবস্থা",
    filters: ["asOf"],
    permission: "reports:view",
    async run(ctx, p) {
      const { asOf, lt } = asOfRange(p);
      const cur = ctx.business.currencySymbol;
      const bs = await balanceSheet(ctx.business.id, lt);
      const rows: ReportRow[] = [];
      const block = (title: string, groups: typeof bs.assets) => {
        rows.push({ kind: "group", cells: { particulars: title, amount: null } });
        for (const g of groups) {
          rows.push({ indent: 1, kind: "subtotal", cells: { particulars: g.name, amount: g.total } });
          for (const l of g.lines) rows.push({ indent: 2, href: `/accounts/${l.accountId}`, cells: { particulars: l.name, amount: l.amount } });
        }
      };
      block("সম্পদ", bs.assets);
      rows.push({ kind: "total", cells: { particulars: "মোট সম্পদ", amount: bs.totalAssets } });
      block("দায়", bs.liabilities);
      block("মূলধন", bs.equity);
      rows.push({ indent: 1, cells: { particulars: bs.currentProfit >= 0 ? "চলতি লাভ (লাভ-ক্ষতি হিসাব থেকে)" : "চলতি ক্ষতি (লাভ-ক্ষতি হিসাব থেকে)", amount: bs.currentProfit } });
      rows.push({ kind: "total", cells: { particulars: "মোট দায় ও মূলধন", amount: bs.totalLiabilitiesAndEquity } });
      return {
        title: "ব্যালান্স শীট",
        subtitle: `${formatDate(asOf)} তারিখ পর্যন্ত`,
        columns: [{ key: "particulars", label: "বিবরণ" }, { key: "amount", label: "টাকা", format: "money" }],
        rows,
        summary: [
          { label: "মোট সম্পদ", value: formatMoney(bs.totalAssets, cur), tone: "blue" },
          { label: "দায় + মূলধন", value: formatMoney(bs.totalLiabilitiesAndEquity, cur), tone: "blue" },
          { label: "সম্পদ = দায় + মূলধন", value: bs.difference === 0 ? "✔ মিলেছে" : `✘ পার্থক্য ${formatMoney(bs.difference, cur)}`, tone: bs.difference === 0 ? "green" : "red" },
        ],
      };
    },
  },
  {
    slug: "stock",
    title: "স্টক রিপোর্ট",
    description: "পণ্যভিত্তিক প্রারম্ভিক, আগমন, নির্গমন, সমাপনী মজুদ ও মূল্য",
    filters: ["range", "q", "warehouse"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const q = p.q?.trim();
      const warehouseId = p.warehouseId || undefined;
      const products = await prisma.product.findMany({
        where: { businessId: ctx.business.id, ...(q ? { OR: [{ name: ci(q) }, { code: ci(q) }, { barcode: { contains: q } }] } : {}) },
        orderBy: { name: "asc" },
        include: { unit: { select: { name: true } } },
      });
      const base = { businessId: ctx.business.id, ...(warehouseId ? { warehouseId } : {}) };
      const [before, during] = await Promise.all([
        prisma.stockMovement.groupBy({ by: ["productId"], where: { ...base, date: { lt: range.gte } }, _sum: { quantityIn: true, quantityOut: true } }),
        prisma.stockMovement.groupBy({ by: ["productId"], where: { ...base, date: range }, _sum: { quantityIn: true, quantityOut: true } }),
      ]);
      const bMap = new Map(before.map((r) => [r.productId, num(r._sum.quantityIn) - num(r._sum.quantityOut)]));
      const dMap = new Map(during.map((r) => [r.productId, { in: num(r._sum.quantityIn), out: num(r._sum.quantityOut) }]));
      let totalValue = 0;
      const rows: ReportRow[] = products.map((pr) => {
        const opening = round3(bMap.get(pr.id) ?? 0);
        const d = dMap.get(pr.id) ?? { in: 0, out: 0 };
        const closing = round3(opening + d.in - d.out);
        const value = round2(closing * num(pr.avgCost));
        totalValue += value;
        return {
          href: `/products/${pr.id}`,
          cells: { product: pr.name, unit: pr.unit.name, opening, in: d.in || null, out: d.out || null, closing, rate: num(pr.avgCost), value },
        };
      });
      rows.push({ kind: "total", cells: { product: "মোট", unit: "", opening: null, in: null, out: null, closing: null, rate: null, value: round2(totalValue) } });
      return {
        title: "স্টক রিপোর্ট",
        subtitle: periodText(from, to),
        columns: [
          { key: "product", label: "পণ্য" },
          { key: "unit", label: "ইউনিট" },
          { key: "opening", label: "প্রারম্ভিক", format: "qty" },
          { key: "in", label: "আগমন", format: "qty" },
          { key: "out", label: "নির্গমন", format: "qty" },
          { key: "closing", label: "সমাপনী", format: "qty" },
          { key: "rate", label: "গড় ক্রয়মূল্য", format: "money" },
          { key: "value", label: "মজুদ মূল্য", format: "money" },
        ],
        rows,
        summary: [{ label: "মোট মজুদ মূল্য", value: formatMoney(totalValue, cur), tone: "blue" }],
        notes: ["মজুদ মূল্য = সমাপনী পরিমাণ × বর্তমান গড় ক্রয়মূল্য (মুভিং অ্যাভারেজ)।"],
      };
    },
  },
  { slug: "customers", title: "কাস্টমার রিপোর্ট", description: "কাস্টমারভিত্তিক প্রারম্ভিক, লেনদেন ও পাওনা", filters: ["range", "q"], permission: "reports:view", run: (ctx, p) => partyReport(ctx, p, "CUSTOMER") },
  { slug: "suppliers", title: "সরবরাহকারী রিপোর্ট", description: "সরবরাহকারীভিত্তিক প্রারম্ভিক, লেনদেন ও দেনা", filters: ["range", "q"], permission: "reports:view", run: (ctx, p) => partyReport(ctx, p, "SUPPLIER") },
  { slug: "sales", title: "বিক্রয় রিপোর্ট", description: "বিক্রয় ও বিক্রয় ফেরত রেজিস্টার", filters: ["range", "q"], permission: "reports:view", run: (ctx, p) => tradeRegister(ctx, p, ["SALES", "SALES_RETURN"]) },
  { slug: "purchases", title: "ক্রয় রিপোর্ট", description: "ক্রয় ও ক্রয় ফেরত রেজিস্টার", filters: ["range", "q"], permission: "reports:view", run: (ctx, p) => tradeRegister(ctx, p, ["PURCHASE", "PURCHASE_RETURN"]) },
  {
    slug: "income-expense",
    title: "আয়-ব্যয় রিপোর্ট",
    description: "খাতভিত্তিক অন্যান্য আয় ও পরিচালন ব্যয়",
    filters: ["range"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const accounts = await listAccounts(ctx.business.id, { nature: { in: ["INCOME", "EXPENSE"] }, group: { isDirect: false } });
      const moves = await prisma.journalEntry.groupBy({ by: ["accountId"], where: { businessId: ctx.business.id, book: "GENERAL", date: range, accountId: { in: accounts.map((a) => a.id) } }, _sum: { debit: true, credit: true } });
      const m = new Map(moves.map((x) => [x.accountId, num(x._sum.debit) - num(x._sum.credit)]));
      const rows: ReportRow[] = [];
      const totals = { INCOME: 0, EXPENSE: 0 };
      for (const nature of ["INCOME", "EXPENSE"] as const) {
        rows.push({ kind: "group", cells: { account: nature === "INCOME" ? "আয়" : "ব্যয়", group: "", amount: null } });
        for (const a of accounts.filter((x) => x.nature === nature)) {
          const amount = naturalBalance(nature as Nature, m.get(a.id) ?? 0);
          if (!amount) continue;
          totals[nature] = round2(totals[nature] + amount);
          rows.push({ indent: 1, href: `/accounts/${a.id}`, cells: { account: a.name, group: a.groupName, amount } });
        }
        rows.push({ kind: "subtotal", cells: { account: nature === "INCOME" ? "মোট আয়" : "মোট ব্যয়", group: "", amount: totals[nature] } });
      }
      const net = round2(totals.INCOME - totals.EXPENSE);
      rows.push({ kind: "total", cells: { account: "আয় − ব্যয়", group: "", amount: net } });
      return {
        title: "আয়-ব্যয় রিপোর্ট",
        subtitle: periodText(from, to),
        columns: [{ key: "account", label: "খাত" }, { key: "group", label: "গ্রুপ" }, { key: "amount", label: "টাকা", format: "money" }],
        rows,
        summary: [
          { label: "মোট আয়", value: formatMoney(totals.INCOME, cur), tone: "green" },
          { label: "মোট ব্যয়", value: formatMoney(totals.EXPENSE, cur), tone: "red" },
        ],
        notes: ["বিক্রয় ও বিক্রিত পণ্যের ব্যয় লাভ-ক্ষতি হিসাবে দেখুন।"],
      };
    },
  },
];

export function findReport(slug: string) {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}
