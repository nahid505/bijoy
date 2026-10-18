import "server-only";
import { partyListWhere, voucherScopeWhere } from "../party-scope";
// Depot reports (business type DEPOT): delivery register, market dues by route / area, company commission.
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { DEPOT_ACCESS, DEPOT_MODE_SHORT, isDepot } from "@/lib/depot";
import { addDays, dayOrToday, formatDate, formatMoney, formatQty as formatQtyText, toBnDigits } from "@/lib/format";
import { reportPeriod } from "../period";
import { balancesBefore } from "../services/ledger";
import { commissionSummary, listDepotDeliveries } from "../services/depot";
import { cashBookReport, ledgerReport, plReport } from "./definitions";
import type { AppContext } from "../auth";
import type { ReportDef, ReportResult, ReportRow } from "./types";

const NO_ROUTE = "রুট নির্ধারিত নেই";
const notDepot = (title: string): ReportResult => ({ title, columns: [], rows: [], emptyMessage: "এই রিপোর্ট শুধু ডিপো ব্যবসার জন্য — ব্যবসা সেটিং থেকে ব্যবসার ধরন \"ডিপো ব্যবসা\" করুন" });
const periodText = (from: string, to: string) => `${formatDate(from)} — ${formatDate(to)}`;

/** Delivery register — the /depot/deliveries list as a report (print / CSV / XLSX). Filters: from, to, mode, q;
 *  all=1 without dates = every challan (otherwise the fiscal year to date). Sale value = Σ supplied × challan rate. */
async function deliveryRegister(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  const title = "ডেলিভারি চালান রেজিস্টার";
  if (!isDepot(ctx.business.businessType)) return notDepot(title);
  const valid = (x?: string) => (x && /^d{4}-d{2}-d{2}$/.test(x) ? x : undefined);
  const allDates = p.all === "1" && !valid(p.from) && !valid(p.to);
  const period = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const from = allDates ? undefined : period.from;
  const to = allDates ? undefined : period.to;
  const mode = p.mode === "COMPANY_PAID" || p.mode === "DEPOT_COLLECTION" ? p.mode : undefined;
  const dayOf = (x?: string) => (x ? new Date(`${x}T00:00:00.000Z`) : undefined);
  const { rows: desc, totals } = await listDepotDeliveries(ctx.business.id, { from: dayOf(from), to: dayOf(to), mode, q: p.q?.trim() || undefined, scope: voucherScopeWhere(ctx) });
  const list = [...desc].reverse();
  let qty = 0, free = 0;
  const out: ReportRow[] = list.map((r) => {
    qty += r.quantity; free += r.free;
    return {
      href: `/vouchers/v/${r.voucher.id}`,
      cells: { date: r.voucher.date, voucher: r.voucher.voucherNo, mode: DEPOT_MODE_SHORT[r.mode], doNumber: r.doNumber ?? "", company: r.companyAccount?.name ?? "", dealer: r.dealerAccount?.name ?? "নগদ বিক্রয়", route: r.dealerAccount?.customer?.route ?? "", quantity: r.quantity, free: r.free || null, sale: r.saleValue, commission: num(r.commissionTotal) || null },
    };
  });
  out.push({ kind: "total", cells: { date: null, voucher: "মোট", mode: "", doNumber: "", company: "", dealer: "", route: "", quantity: round3(qty), free: round3(free), sale: totals.saleValue, commission: totals.commission } });
  const cur = ctx.business.currencySymbol;
  return {
    title,
    subtitle: [from && to ? periodText(from, to) : "সব তারিখ", mode ? DEPOT_MODE_SHORT[mode] : ""].filter(Boolean).join(" · "),
    columns: [
      { key: "date", label: "তারিখ", format: "date" },
      { key: "voucher", label: "চালান নং" },
      { key: "mode", label: "ধরন" },
      { key: "doNumber", label: "ডিও / রেফ." },
      { key: "company", label: "কোম্পানি" },
      { key: "dealer", label: "ডিলার" },
      { key: "route", label: "রুট / এরিয়া" },
      { key: "quantity", label: "পরিমাণ", format: "qty" },
      { key: "free", label: "ফ্রি", format: "qty" },
      { key: "sale", label: "বিক্রয় মূল্য", format: "money" },
      { key: "commission", label: "কমিশন", format: "money" },
    ],
    rows: list.length ? out : [],
    summary: [
      { label: "চালান", value: toBnDigits(list.length) },
      { label: "ডিও রিলিজ / মার্কেট সেলস", value: `${toBnDigits(totals.doCount)} / ${toBnDigits(totals.marketCount)}` },
      { label: "মোট বিক্রয় মূল্য", value: formatMoney(totals.saleValue, cur), tone: "green" },
      { label: "অর্জিত কমিশন", value: formatMoney(totals.commission, cur), tone: "blue" },
    ],
    emptyMessage: "এই সময়ে কোনো ডেলিভারি চালান নেই",
  };
}

async function marketDuesByRoute(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  const title = "রুট / এরিয়া ভিত্তিক মার্কেট বাকি";
  if (!isDepot(ctx.business.businessType)) return notDepot(title);
  const asOf = dayOrToday(p.asOf);
  const q = p.q?.trim().toLowerCase();
  const dealers = await prisma.customer.findMany({ where: { businessId: ctx.business.id, isDepotDealer: true, ...partyListWhere(ctx, "CUSTOMER") }, select: { id: true, accountId: true, name: true, mobile: true, route: true } });
  const balances = await balancesBefore(ctx.business.id, new Date(`${addDays(asOf, 1)}T00:00:00.000Z`), dealers.map((d) => d.accountId), "DEPOT");
  const due = dealers
    .map((d) => ({ ...d, route: d.route?.trim() || NO_ROUTE, due: round2(balances.get(d.accountId) ?? 0) }))
    .filter((d) => d.due > 0 && (!q || [d.name, d.mobile, d.route].some((x) => x?.toLowerCase().includes(q))));
  const routes = [...new Set(due.map((d) => d.route))].sort((a, b) => (a === NO_ROUTE ? 1 : b === NO_ROUTE ? -1 : a.localeCompare(b, "bn")));
  const rows: ReportRow[] = [];
  for (const route of routes) {
    const list = due.filter((d) => d.route === route).sort((a, b) => b.due - a.due);
    const total = round2(list.reduce((s, d) => s + d.due, 0));
    rows.push({ kind: "group", cells: { dealer: route, mobile: `${toBnDigits(list.length)} জন ডিলার`, due: total } });
    for (const d of list) rows.push({ indent: 1, href: `/depot/dealers/${d.id}`, cells: { dealer: d.name, mobile: d.mobile ?? "", due: d.due } });
  }
  const grand = round2(due.reduce((s, d) => s + d.due, 0));
  if (rows.length) rows.push({ kind: "total", cells: { dealer: "সর্বমোট মার্কেট বাকি", mobile: `${toBnDigits(due.length)} জন ডিলার`, due: grand } });
  return {
    title,
    subtitle: `${formatDate(asOf)} পর্যন্ত`,
    columns: [{ key: "dealer", label: "রুট / ডিলার" }, { key: "mobile", label: "মোবাইল" }, { key: "due", label: "মার্কেট বাকি", format: "money" }],
    rows,
    summary: [
      { label: "মোট মার্কেট বাকি", value: formatMoney(grand, ctx.business.currencySymbol), tone: "red" },
      { label: "বাকি থাকা ডিলার", value: toBnDigits(due.length) },
      { label: "রুট / এরিয়া", value: toBnDigits(routes.length) },
    ],
    emptyMessage: "কোনো ডিলারের মার্কেট বাকি নেই",
  };
}

async function commissionReport(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  const title = "কোম্পানি কমিশন রিপোর্ট";
  if (!isDepot(ctx.business.businessType)) return notDepot(title);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const s = await commissionSummary(ctx.business.id, { from: range.gte, to: range.lt ? new Date(range.lt.getTime() - 1) : undefined });
  const rows: ReportRow[] = s.rows.map((r) => ({ href: `/accounts/${r.receivableAccountId}`, cells: { company: r.company, deliveries: r.deliveries, earned: r.earned, settled: r.settled, outstanding: r.outstanding } }));
  const sum = (k: "earned" | "settled") => round2(s.rows.reduce((t, r) => t + r[k], 0));
  if (rows.length) rows.push({ kind: "total", cells: { company: "মোট", deliveries: s.rows.reduce((t, r) => t + r.deliveries, 0), earned: sum("earned"), settled: sum("settled"), outstanding: s.outstanding } });
  return {
    title,
    subtitle: periodText(from, to),
    columns: [
      { key: "company", label: "কোম্পানি" },
      { key: "deliveries", label: "ডিও চালান", format: "qty" },
      { key: "earned", label: "অর্জিত কমিশন", format: "money" },
      { key: "settled", label: "আদায় / সমন্বয়", format: "money" },
      { key: "outstanding", label: "বর্তমান প্রাপ্য", format: "money" },
    ],
    rows,
    summary: [
      { label: "অর্জিত কমিশন (সময়কালে)", value: formatMoney(sum("earned"), ctx.business.currencySymbol), tone: "blue" },
      { label: "আদায় / সমন্বয় (সময়কালে)", value: formatMoney(sum("settled"), ctx.business.currencySymbol), tone: "green" },
      { label: "কোম্পানির কাছে বর্তমান প্রাপ্য", value: formatMoney(s.outstanding, ctx.business.currencySymbol), tone: "red" },
    ],
    notes: ["অর্জিত = এই সময়ের ডিও রিলিজ চালানের কমিশন; প্রাপ্য = আজ পর্যন্ত কমিশন প্রাপ্য লেজারের ব্যালেন্স।"],
    emptyMessage: "এখনও কোনো ডিও রিলিজ চালান নেই",
  };
}

/** Free / scheme goods: received from the company (purchases), given to dealers (DO releases and market
 *  sales), and the free stock still at the depot (all received − all given, up to the end date). */
async function freeSchemeReport(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  const title = "ফ্রি স্কিম রিপোর্ট";
  if (!isDepot(ctx.business.businessType)) return notDepot(title);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const items = await prisma.voucherItem.findMany({
    where: { freeQuantity: { gt: 0 }, voucher: { businessId: ctx.business.id, book: "DEPOT", type: { in: ["PURCHASE", "SALES", "DEPOT_DELIVERY"] }, date: { lt: range.lt } } },
    select: { productId: true, freeQuantity: true, unitFactor: true, voucher: { select: { type: true, date: true } }, product: { select: { name: true, unit: { select: { name: true } } } } },
  });
  const byProduct = new Map<string, { name: string; unit: string; received: number; given: number; balance: number }>();
  for (const i of items) {
    const base = round3(num(i.freeQuantity) * num(i.unitFactor));
    const row = byProduct.get(i.productId) ?? { name: i.product.name, unit: i.product.unit.name, received: 0, given: 0, balance: 0 };
    const inPeriod = range.gte ? i.voucher.date >= range.gte : true;
    const received = i.voucher.type === "PURCHASE";
    if (inPeriod && received) row.received = round3(row.received + base);
    if (inPeriod && !received) row.given = round3(row.given + base);
    row.balance = round3(row.balance + (received ? base : -base));
    byProduct.set(i.productId, row);
  }
  const list = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name, "bn"));
  const rows: ReportRow[] = list.map((r) => ({ cells: { product: r.name, unit: r.unit, received: r.received, given: r.given, balance: r.balance } }));
  // totals only when every product has the same unit (bags and kg are never added together)
  const units = [...new Set(list.map((r) => r.unit))];
  const sum = (k: "received" | "given" | "balance") => round3(list.reduce((s, r) => s + r[k], 0));
  if (list.length && units.length === 1) rows.push({ kind: "total", cells: { product: "মোট", unit: units[0], received: sum("received"), given: sum("given"), balance: sum("balance") } });
  const perUnit = (k: "received" | "given" | "balance") =>
    units.map((u) => `${formatQtyText(round3(list.filter((r) => r.unit === u).reduce((s, r) => s + r[k], 0)))} ${u}`).join(" · ") || "০";
  return {
    title,
    subtitle: periodText(from, to),
    columns: [
      { key: "product", label: "পণ্য" },
      { key: "unit", label: "একক" },
      { key: "received", label: "কোম্পানি থেকে ফ্রি প্রাপ্ত", format: "qty" },
      { key: "given", label: "ডিলারদের ফ্রি প্রদান", format: "qty" },
      { key: "balance", label: "অবশিষ্ট ফ্রি স্টক", format: "qty" },
    ],
    rows,
    summary: [
      { label: "কোম্পানি থেকে ফ্রি প্রাপ্ত", value: perUnit("received"), tone: "green" },
      { label: "ডিলারদের স্কিম বাবদ ফ্রি প্রদান", value: perUnit("given"), tone: "blue" },
      { label: "ডিপোতে অবশিষ্ট ফ্রি স্টক", value: perUnit("balance"), tone: "red" },
    ],
    notes: [
      "প্রাপ্ত ও প্রদান = এই সময়ের হিসাব; অবশিষ্ট = শুরু থেকে শেষ তারিখ পর্যন্ত মোট প্রাপ্ত − মোট প্রদান।",
      "অবশিষ্ট ঋণাত্মক হলে কোম্পানির ফ্রির চেয়ে বেশি ফ্রি ডিপো নিজের স্টক থেকে দিয়েছে।",
    ],
    emptyMessage: "এখনও কোনো ফ্রি পণ্য নেই — স্টক ইন বা ডেলিভারি চালানের \"ফ্রি পরিমাণ\" ঘরে দিলে এখানে আসবে",
  };
}

/** A dealer's statement in the depot book (dealer profile → স্টেটমেন্ট). */
async function dealerLedger(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  const title = "ডিলার লেজার (ডিপো হিসাব)";
  if (!isDepot(ctx.business.businessType)) return notDepot(title);
  const dealer = p.accountId ? await prisma.customer.findFirst({ where: { businessId: ctx.business.id, accountId: p.accountId, isDepotDealer: true, ...partyListWhere(ctx, "CUSTOMER") }, select: { name: true, accountId: true } }) : null;
  if (!dealer) return { title, columns: [], rows: [], emptyMessage: "ডিলার নির্বাচন করুন" };
  return ledgerReport(ctx, p, [dealer.accountId], `ডিলার লেজার: ${dealer.name}`, "DEPOT");
}

/** A company's depot-book ledger: stock in, DO releases, payments and commission adjustments (its general ledger is separate). */
async function companyLedger(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  const title = "কোম্পানি লেজার (ডিপো হিসাব)";
  if (!isDepot(ctx.business.businessType)) return notDepot(title);
  const company = p.accountId ? await prisma.supplier.findFirst({ where: { businessId: ctx.business.id, accountId: p.accountId, ...partyListWhere(ctx, "SUPPLIER") }, select: { name: true, accountId: true } }) : null;
  if (!company) return { title, columns: [], rows: [], emptyMessage: "কোম্পানি (সরবরাহকারী) নির্বাচন করুন" };
  return ledgerReport(ctx, p, [company.accountId], `কোম্পানি লেজার (ডিপো): ${company.name}`, "DEPOT");
}

/** The depot's own profit & loss: commission, market-sale margin and depot expenses — nothing of the general books. */
async function depotProfitLoss(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  if (!isDepot(ctx.business.businessType)) return notDepot("ডিপো লাভ-ক্ষতি");
  return plReport(ctx, p, "DEPOT", "ডিপো লাভ-ক্ষতি");
}

/** The depot cash book: market collections, cash sales, company payments, commission received / transferred. */
async function depotCashBook(ctx: AppContext, p: Record<string, string | undefined>): Promise<ReportResult> {
  if (!isDepot(ctx.business.businessType)) return notDepot("ডিপো ক্যাশ বুক");
  return cashBookReport(ctx, p, "DEPOT", "ডিপো ক্যাশ বুক");
}

export const DEPOT_REPORTS: ReportDef[] = [
  { slug: "depot-free", title: "ফ্রি স্কিম রিপোর্ট", description: "কোম্পানি থেকে ফ্রি প্রাপ্ত, ডিলারদের ফ্রি প্রদান ও ডিপোতে অবশিষ্ট ফ্রি স্টক", filters: ["range"], permission: DEPOT_ACCESS.scheme, run: freeSchemeReport },
  { slug: "depot-deliveries", title: "ডেলিভারি চালান রেজিস্টার", description: "ডিও রিলিজ ও মার্কেট সেলস চালান — ডিলার, রুট, পরিমাণ, ফ্রি, বিক্রয় মূল্য ও কমিশন", filters: ["range", "q"], permission: DEPOT_ACCESS.register, run: deliveryRegister },
  { slug: "depot-market-dues", title: "রুট / এরিয়া ভিত্তিক মার্কেট বাকি", description: "রুট/এরিয়া অনুযায়ী ডিলারদের মার্কেট বাকি — রুটের মোট ও সর্বমোট", filters: ["asOf", "q"], permission: DEPOT_ACCESS.reports, run: marketDuesByRoute },
  { slug: "depot-profit-loss", title: "ডিপো লাভ-ক্ষতি", description: "শুধু ডিপো হিসাব — কোম্পানি কমিশন, মার্কেট সেলসের লাভ ও ডিপোর খরচ; সাধারণ ব্যবসার লাভ-ক্ষতিতে যুক্ত হয় না", filters: ["range"], permission: DEPOT_ACCESS.profitLoss, run: depotProfitLoss },
  { slug: "depot-cash-book", title: "ডিপো ক্যাশ বুক", description: "শুধু ডিপো হিসাবের নগদ — মার্কেট কালেকশন, নগদ বিক্রয়, কোম্পানি পেমেন্ট, কমিশন আদায় ও স্থানান্তর", filters: ["cashAccount", "range", "q"], permission: DEPOT_ACCESS.cashbook, run: depotCashBook },
  { slug: "depot-company-ledger", title: "কোম্পানি লেজার (ডিপো হিসাব)", description: "কোম্পানির সাথে ডিপোর লেনদেন — স্টক ইন, ডিও রিলিজ, পেমেন্ট ও কমিশন সমন্বয়; চলমান দেনা", filters: ["supplier", "range"], permission: DEPOT_ACCESS.companyLedger, run: companyLedger },
  { slug: "depot-dealer-ledger", title: "ডিলার লেজার (ডিপো হিসাব)", description: "একজন ডিলারের ডিপো হিসাবের খতিয়ান ও চলমান বাকি", filters: ["account", "range", "q"], permission: DEPOT_ACCESS.dealersView, run: dealerLedger },
  { slug: "depot-commission", title: "কোম্পানি কমিশন রিপোর্ট", description: "কোম্পানিভিত্তিক অর্জিত কমিশন, আদায়/সমন্বয় ও বর্তমান প্রাপ্য", filters: ["range"], permission: DEPOT_ACCESS.reports, run: commissionReport },
];
