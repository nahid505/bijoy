// Dashboard building blocks: the centred header (title, company, English and Bangla date),
// cash book & account balances, debtors & creditors summary, and quick accounting actions.
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { MONTHS_EN } from "@/lib/i18n";
import { round2 } from "@/lib/calc";
import { isDepot, DEPOT_CASH_NAME } from "@/lib/depot";
import { businessModules } from "@/lib/business-types";
import { can, type AppContext } from "@/server/auth";
import { getT } from "@/server/i18n";
import { allowedAccounts } from "@/server/party-scope";
import { dailyCash } from "@/server/reports/daily-cash";
import { balancesByKind, sumBalances } from "@/server/services/ledger";
import { type BookFilter } from "@/lib/book";
import { depotCashSummary } from "@/server/services/depot-cash";

const BN_WEEKDAYS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];

/** "28 October 2026" and "২৮ অক্টোবর ২০২৬, বুধবার" for a YYYY-MM-DD day. */
export function dashboardDates(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  return { en: `${d} ${MONTHS_EN[(m || 1) - 1]} ${y}`, bn: `${formatDate(day)}, ${BN_WEEKDAYS[weekday]}` };
}

export async function DashboardHeader({ ctx, note }: { ctx: AppContext; note?: string }) {
  const t = await getT();
  const dates = dashboardDates(toDateInput());
  return (
    <header className="mb-6 text-center" id="dashboard-header">
      {/* স্বত্বাধিকারী পরিচিতি ও ছবি */}
      <div className="mx-auto flex flex-col items-center mb-3">
        <div className="relative">
          <img
            src="/nahid.jpg"
            alt={t("স্বত্বাধিকারী: নাহিদ হাসান")}
            className="w-16 h-16 sm:w-20 sm:h-20 aspect-square rounded-2xl object-cover border-2 border-white shadow-md ring-2 ring-emerald-500/30"
          />
        </div>
        <span className="mt-2 text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-300 px-3 py-1 rounded-full shadow-xs tracking-wide">
          {t("স্বত্বাধিকারী: নাহিদ হাসান")}
        </span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-ink-900">{t("ড্যাশবোর্ড")}</h1>
      <p className="mt-1 text-lg sm:text-xl font-bold text-brand-700" data-keep-lang>{ctx.business?.name ?? ""}</p>
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm font-semibold">
        <span id="date-en" className="rounded-full bg-sky-50 px-3.5 py-1.5 text-sky-800 ring-1 ring-sky-200 shadow-2xs" data-keep-lang>{dates.en}</span>
        <span id="date-bn" className="rounded-full bg-emerald-50 px-3.5 py-1.5 text-emerald-800 ring-1 ring-emerald-200 shadow-2xs" data-keep-lang>{dates.bn}</span>
      </div>
      {note && <p className="mt-2 text-sm sm:text-xs font-medium text-slate-600 leading-relaxed">{note}</p>}
    </header>
  );
}

/** Today's cash book: brought forward, cash received, cash paid and cash in hand (the daily cash book's figures). */
export async function CashBookWidget({ ctx }: { ctx: AppContext }) {
  if (!can(ctx, "accounts:view")) return null;
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const c = await dailyCash(ctx.business.id, {}).catch(() => null);
  const row = (label: string, value: number, cls = "", id?: string) => (
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:py-2.5">
      <span className="text-sm sm:text-base font-medium text-slate-700 leading-relaxed">{label}</span>
      <span id={id} className={`text-base sm:text-lg font-bold tabular-nums ${cls}`}>{formatMoney(value ?? 0, cur)}</span>
    </div>
  );
  return (
    <section className="panel flex h-full flex-col shadow-xs" id="cash-book-widget" aria-labelledby="cash-book-heading">
      <div className="panel-head">
        <h2 id="cash-book-heading" className="panel-title text-base sm:text-lg font-bold">📒 {t("ক্যাশ বুক")}</h2>
        <Link prefetch={false} href="/reports/daily-cash" className="text-xs sm:text-sm font-semibold text-brand-700 hover:underline">{t("ডেইলী জমা-খরচ হিসাব")}</Link>
      </div>
      <div className="flex-1 divide-y divide-rule">
        {row(t("পূর্বের জের"), c?.opening ?? 0, "text-slate-700", "cb-opening")}
        {row(t("আজকের মোট নগদ জমা"), c?.todayReceipts ?? 0, "text-debit", "cb-in")}
        {row(t("আজকের মোট নগদ খরচ"), c?.totalPayments ?? 0, "text-credit", "cb-out")}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-b-lg border-t-2 border-brand-600 bg-brand-50 px-4 py-3.5 sm:py-3">
        <span className="text-sm sm:text-base font-bold text-ink-900 leading-relaxed">{t("অবশিষ্ট ক্যাশ ইন হ্যান্ড")}</span>
        <span id="cb-closing" className={`text-xl sm:text-2xl font-black tabular-nums ${(c?.closing ?? 0) < 0 ? "text-credit" : "text-brand-700"}`}>{formatMoney(c?.closing ?? 0, cur)}</span>
      </div>
    </section>
  );
}

/**
 * ১ম সেকশন (একদম উপরে): "ক্যাশ বুক ও বর্তমান ক্যাশ ব্যালেন্স"
 * ক্যাশ বুকের সংক্ষিপ্ত তথ্য এবং বর্তমান ব্যালেন্স কার্ডগুলো (নগদ ক্যাশ, ডিপো ক্যাশ, ব্যাংক ব্যালেন্স ইত্যাদি)
 * এক সারিতে সুন্দর গ্রিড আকারে।
 */
export async function CashAndBalancesSection({ ctx }: { ctx: AppContext }) {
  if (!can(ctx, "accounts:view")) return null;
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const isDep = isDepot(ctx.business.businessType);
  const bookFilter: BookFilter = isDep ? "ALL" : "GENERAL";
  const heads = allowedAccounts(ctx);

  const [c, cashRows, bankRows, depotBox] = await Promise.all([
    dailyCash(ctx.business.id, {}).catch(() => null),
    balancesByKind(ctx.business.id, ["CASH"], undefined, bookFilter).catch(() => []),
    balancesByKind(ctx.business.id, ["BANK"], undefined, bookFilter).catch(() => []),
    isDep ? depotCashSummary(ctx.business.id).catch(() => null) : Promise.resolve(null),
  ]);

  let cashAccounts = cashRows
    .filter((r) => heads === null || heads.includes(r.id))
    .map((r) => (depotBox && r.id === depotBox.accountId ? { ...r, balance: depotBox.balance } : r));

  if (depotBox && !cashAccounts.some((x) => x.id === depotBox.accountId) && (heads === null || heads.includes(depotBox.accountId))) {
    cashAccounts.push({
      id: depotBox.accountId,
      name: t(DEPOT_CASH_NAME),
      code: null,
      balance: depotBox.balance,
      kind: "CASH",
      isActive: true,
      imageUrl: null,
    } as any);
  }

  const bankAccounts = bankRows.filter((r) => heads === null || heads.includes(r.id));
  const totalCash = sumBalances(cashAccounts);
  const totalBank = sumBalances(bankAccounts);
  const totalLiquid = round2(totalCash + totalBank);

  const allAccounts = [
    ...cashAccounts.map((a) => ({ ...a, typeBadge: t("নগদ"), isCash: true })),
    ...bankAccounts.map((a) => ({ ...a, typeBadge: t("ব্যাংক"), isCash: false })),
  ];

  const row = (label: string, value: number, cls = "", id?: string) => (
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:py-2.5">
      <span className="text-sm sm:text-base font-medium text-slate-700 leading-relaxed">{label}</span>
      <span id={id} className={`text-base sm:text-lg font-bold tabular-nums ${cls}`}>{formatMoney(value ?? 0, cur)}</span>
    </div>
  );

  return (
    <section className="mb-6 space-y-3" id="cash-balances-section" aria-labelledby="cash-balances-heading">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 id="cash-balances-heading" className="text-lg sm:text-xl font-bold text-ink-900 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100 text-amber-700 text-xs font-bold" aria-hidden>
              📒
            </span>
            <span>{t("ক্যাশ বুক ও বর্তমান ক্যাশ ব্যালেন্স")}</span>
          </h2>
          <p className="mt-1 text-xs sm:text-sm font-medium text-slate-600 leading-relaxed">
            {t("দৈনিক ক্যাশ বিবরণী ও প্রতিটি ক্যাশ/ব্যাংক হিসাবের লাইভ ব্যালেন্স")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            prefetch={false}
            href="/reports/daily-cash"
            className="text-xs sm:text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline flex items-center gap-1 bg-brand-50 px-3 py-2 rounded-lg border border-brand-200 transition hover:bg-brand-100"
          >
            <span>{t("ডেইলী জমা-খরচ")}</span>
            <span aria-hidden>→</span>
          </Link>
          <Link
            prefetch={false}
            href="/accounts/cash"
            className="text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 hover:underline flex items-center gap-1 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 transition hover:bg-slate-100"
          >
            <span>{t("ক্যাশ খতিয়ান")}</span>
          </Link>
          <Link
            prefetch={false}
            href="/accounts/bank"
            className="text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 hover:underline flex items-center gap-1 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 transition hover:bg-slate-100"
          >
            <span>{t("ব্যাংক খতিয়ান")}</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left: আজকের ক্যাশ বুক (প্রিমিয়াম নীল সামারি কার্ড) */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col">
          <Link
            prefetch={false}
            href="/reports/daily-cash"
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50/70 via-sky-50/40 to-white p-5 sm:p-6 shadow-sm transition-all hover:border-blue-400 hover:shadow-md cursor-pointer h-full"
            id="today-cash-book-card"
          >
            {/* Top Badge & Right Icon */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs sm:text-sm font-semibold text-blue-700 border border-blue-200">
                  <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  {t("• দৈনিক ক্যাশ স্থিতি")}
                </span>
                <h3 className="mt-2.5 text-xl sm:text-2xl font-bold text-gray-800 leading-tight">
                  {t("আজকের ক্যাশ বুক (ক্যাশ ইন হ্যান্ড)")}
                </h3>
              </div>
              <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-600/20 group-hover:scale-105 transition-transform">
                <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>

            {/* Main Balance */}
            <div className="my-4">
              <span className="text-xs sm:text-sm font-medium text-slate-500 block mb-1">
                {t("অবশিষ্ট ক্যাশ ইন হ্যান্ড")}
              </span>
              <div
                id="cb-closing"
                className={`text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight tabular-nums ${
                  (c?.closing ?? 0) < 0 ? "text-rose-700" : "text-blue-900"
                }`}
              >
                {formatMoney(c?.closing ?? 0, cur)}
              </div>
            </div>

            {/* Sub-info: Input / Output Summary */}
            <div className="rounded-xl bg-white/90 p-3 sm:p-3.5 border border-blue-100 shadow-2xs my-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-700 font-semibold">{t("আজকের মোট জমা")}:</span>
                  <span className="font-bold text-emerald-800 tabular-nums">{formatMoney(c?.todayReceipts ?? 0, cur)}</span>
                </span>
                <span className="text-slate-300 font-light">|</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-rose-700 font-semibold">{t("আজকের মোট খরচ")}:</span>
                  <span className="font-bold text-rose-800 tabular-nums">{formatMoney(c?.totalPayments ?? 0, cur)}</span>
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
                <span>{t("পূর্বের জের")}:</span>
                <span className="font-semibold text-slate-700 tabular-nums">{formatMoney(c?.opening ?? 0, cur)}</span>
              </div>
            </div>

            {/* Action button at bottom */}
            <div className="flex items-center justify-between border-t border-blue-200/80 pt-4 mt-2">
              <span className="text-xs sm:text-sm text-blue-800/80 font-semibold">{t("ডেইলী জমা-খরচ হিসাব")}</span>
              <span className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition group-hover:bg-blue-700 group-hover:shadow">
                <span>{t("বিস্তারিত দেখুন")}</span>
                <span aria-hidden>→</span>
              </span>
            </div>
          </Link>
        </div>

        {/* Right: বর্তমান ব্যালেন্স কার্ডগুলো (নগদ ক্যাশ, ডিপো ক্যাশ, ব্যাংক ব্যালেন্স ইত্যাদি) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col">
          <div className="panel flex h-full flex-col p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold text-ink-900 flex items-center gap-1.5">
                  <span>🏦</span>
                  <span>{t("অ্যাকাউন্ট ব্যালেন্স")}</span>
                </span>
                <span className="text-xs sm:text-sm text-slate-500 font-medium">({toBnDigits(allAccounts.length)} {t("টি খাত")})</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 sm:px-3 py-1.5 font-semibold text-emerald-800 border border-emerald-200">
                  <span className="text-xs text-emerald-600">{t("নগদ")}:</span>
                  <span className="tabular-nums font-bold">{formatMoney(totalCash, cur)}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2.5 sm:px-3 py-1.5 font-semibold text-sky-800 border border-sky-200">
                  <span className="text-xs text-sky-600">{t("ব্যাংক")}:</span>
                  <span className="tabular-nums font-bold">{formatMoney(totalBank, cur)}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2.5 sm:px-3 py-1.5 font-semibold text-brand-900 border border-brand-200">
                  <span className="text-xs text-brand-700">{t("মোট")}:</span>
                  <span className="tabular-nums font-extrabold">{formatMoney(totalLiquid, cur)}</span>
                </span>
              </div>
            </div>

            {allAccounts.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-8 text-center text-sm font-medium text-slate-400">
                {t("কোনো ক্যাশ বা ব্যাংক অ্যাকাউন্ট পাওয়া যায়নি")}
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[310px] overflow-y-auto pr-0.5">
                {allAccounts.map((acc) => (
                  <Link
                    prefetch={false}
                    key={acc.id}
                    href={`/accounts/${acc.id}`}
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-3.5 sm:p-3 shadow-2xs transition-all hover:border-brand-500 hover:shadow-xs hover:-translate-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 text-sm sm:text-base font-bold text-slate-800 group-hover:text-brand-700 leading-relaxed truncate">
                        <span aria-hidden className="text-base">{acc.isCash ? "💵" : "🏦"}</span>
                        <span className="truncate">{acc.name}</span>
                      </span>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${acc.isCash ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-sky-50 text-sky-700 border border-sky-200"}`}>
                        {acc.typeBadge}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500">{t("বর্তমান স্থিতি")}</span>
                      <span className={`text-base sm:text-lg font-bold tabular-nums ${acc.balance < 0 ? "text-credit" : "text-ink-900 group-hover:text-brand-700"}`}>
                        {formatMoney(acc.balance, cur)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * ২য় সেকশন: "দেনাদার, পাওনাদার ও স্টক সামারি" (Debtors, Creditors & Stock Summary)
 * পাশাপাশি তিনটি বড় আকর্ষণীয় কার্ড:
 * (ক) মোট দেনাদার (Receivables / মোট বকেয়া পাওনা) - হালকা সবুজ শেড
 * (খ) মোট পাওনাদার (Payables / মোট দেনা) - হালকা লাল শেড
 * (গ) মোট স্টক মূল্য (Total Stock Value / বর্তমান মজুদ) - হালকা হলুদ/অ্যাম্বার শেড
 */
export async function DebtorsCreditorsSummary({ ctx }: { ctx: AppContext }) {
  if (!can(ctx, "accounts:view")) return null;
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const isDep = isDepot(ctx.business.businessType);
  const bookFilter: BookFilter = isDep ? "ALL" : "GENERAL";

  const [debtorAccounts, creditorAccounts, products] = await Promise.all([
    balancesByKind(ctx.business.id, ["CUSTOMER"], undefined, bookFilter).catch(() => []),
    balancesByKind(ctx.business.id, ["SUPPLIER"], undefined, bookFilter).catch(() => []),
    prisma.product.findMany({
      where: {
        businessId: ctx.business.id,
        isActive: true,
        ...(isDep ? {} : { isDepotProduct: false }),
      },
      select: {
        id: true,
        stock: true,
        purchasePrice: true,
        salePrice: true,
        avgCost: true,
      },
    }).catch(() => []),
  ]);

  // Debtor balances: positive balance (debit > credit) = customer owes money (receivable)
  const debtorDueList = debtorAccounts.filter((r) => r.balance > 0.005);
  const totalReceivable = round2(debtorDueList.reduce((sum, r) => sum + r.balance, 0));
  const debtorCount = debtorDueList.length;

  // Creditor balances: negative balance in ledger (credit > debit) = business owes supplier (payable)
  const creditorDueList = creditorAccounts.filter((r) => -r.balance > 0.005);
  const totalPayable = round2(creditorDueList.reduce((sum, r) => sum + (-r.balance), 0));
  const creditorCount = creditorDueList.length;

  // Stock valuation: Σ (remaining stock × (last purchase price > 0 ? purchase price : sale price))
  let totalStockValue = 0;
  let stockProductCount = 0;
  for (const p of products) {
    const qty = num(p.stock);
    if (qty > 0.0001) {
      stockProductCount++;
      const pPrice = num(p.purchasePrice);
      const sPrice = num(p.salePrice);
      const rate = pPrice > 0 ? pPrice : sPrice > 0 ? sPrice : num(p.avgCost);
      totalStockValue += qty * rate;
    }
  }
  totalStockValue = round2(totalStockValue);

  const stockHref = isDep && !can(ctx, "reports:view") ? "/depot/products" : "/reports/daily-stock";

  return (
    <section className="mb-6 space-y-3" id="debtors-creditors-section" aria-labelledby="debtors-creditors-heading">
      <div className="mb-1">
        <h2 id="debtors-creditors-heading" className="text-lg sm:text-xl font-bold text-ink-900 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-blue-700 text-xs font-bold" aria-hidden>
            📊
          </span>
          <span>{t("দেনাদার, পাওনাদার ও স্টক সামারি")}</span>
        </h2>
        <p className="mt-1 text-xs sm:text-sm font-medium text-slate-600 leading-relaxed">
          {t("বাজারের মোট বকেয়া পাওনা, সরবরাহকারীদের কাছে মোট দেনা এবং বর্তমান স্টক মূল্যের সারসংক্ষেপ")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: মোট দেনাদার (Receivables / মোট বকেয়া পাওনা) */}
        <Link
          prefetch={false}
          href="/accounts/debtors"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-emerald-200/90 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white p-5 sm:p-6 shadow-sm transition-all hover:border-emerald-400 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs sm:text-sm font-bold text-emerald-800 border border-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
                {t("মোট বকেয়া পাওনা")}
              </span>
              <h3 className="mt-2.5 text-xl sm:text-2xl font-bold text-slate-800 leading-tight">
                {t("মোট দেনাদার")} <span className="text-sm sm:text-base font-semibold text-emerald-700">({t("কাস্টমার পাওনা")})</span>
              </h3>
            </div>
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20 group-hover:scale-105 transition-transform">
              <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>

          <div className="my-4">
            <div className="text-3xl sm:text-4xl font-black tracking-tight text-emerald-900 tabular-nums">
              {formatMoney(totalReceivable, cur)}
            </div>
            <p className="mt-2 text-sm sm:text-base font-medium text-emerald-800/90 flex items-center gap-1.5 leading-relaxed">
              <span>👥</span>
              <span>{t("{count} জন কাস্টমারের কাছে বাকি রয়েছে", { count: toBnDigits(debtorCount) })}</span>
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-emerald-200/80 pt-4">
            <span className="text-xs sm:text-sm text-emerald-800/80 font-semibold">{t("কাস্টমারভিত্তিক খতিয়ান")}</span>
            <span
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-xs transition group-hover:bg-emerald-700 group-hover:shadow"
            >
              <span>{t("বিস্তারিত দেখুন")}</span>
              <span aria-hidden>→</span>
            </span>
          </div>
        </Link>

        {/* Card 2: মোট পাওনাদার (Payables / মোট দেনা) */}
        <Link
          prefetch={false}
          href="/accounts/creditors"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-rose-200/90 bg-gradient-to-br from-rose-50 via-amber-50/40 to-white p-5 sm:p-6 shadow-sm transition-all hover:border-rose-400 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs sm:text-sm font-bold text-rose-800 border border-rose-200">
                <span className="h-2 w-2 rounded-full bg-rose-600 animate-pulse" />
                {t("মোট ব্যবসায়িক দেনা")}
              </span>
              <h3 className="mt-2.5 text-xl sm:text-2xl font-bold text-slate-800 leading-tight">
                {t("মোট পাওনাদার")} <span className="text-sm sm:text-base font-semibold text-rose-700">({t("সরবরাহকারী দেনা")})</span>
              </h3>
            </div>
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-md shadow-rose-600/20 group-hover:scale-105 transition-transform">
              <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
          </div>

          <div className="my-4">
            <div className="text-3xl sm:text-4xl font-black tracking-tight text-rose-900 tabular-nums">
              {formatMoney(totalPayable, cur)}
            </div>
            <p className="mt-2 text-sm sm:text-base font-medium text-rose-800/90 flex items-center gap-1.5 leading-relaxed">
              <span>🏭</span>
              <span>{t("{count} জন সরবরাহকারীর কাছে দেনা রয়েছে", { count: toBnDigits(creditorCount) })}</span>
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-rose-200/80 pt-4">
            <span className="text-xs sm:text-sm text-rose-800/80 font-semibold">{t("সরবরাহকারীভিত্তিক খতিয়ান")}</span>
            <span
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-xs transition group-hover:bg-rose-700 group-hover:shadow"
            >
              <span>{t("বিস্তারিত দেখুন")}</span>
              <span aria-hidden>→</span>
            </span>
          </div>
        </Link>

        {/* Card 3: মোট স্টক (Total Stock Value / বর্তমান মজুদ) */}
        <Link
          prefetch={false}
          href={stockHref}
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-amber-200/90 bg-gradient-to-br from-amber-50 via-yellow-50/50 to-white p-5 sm:p-6 shadow-sm transition-all hover:border-amber-400 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs sm:text-sm font-bold text-amber-800 border border-amber-200">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                {t("• মোট বর্তমান স্টক")}
              </span>
              <h3 className="mt-2.5 text-xl sm:text-2xl font-bold text-slate-800 leading-tight">
                {t("মোট স্টক মূল্য")} <span className="text-sm sm:text-base font-semibold text-amber-700">({t("বর্তমান মজুদ")})</span>
              </h3>
            </div>
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform">
              <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>

          <div className="my-4">
            <div className="text-3xl sm:text-4xl font-black tracking-tight text-amber-900 tabular-nums">
              {formatMoney(totalStockValue, cur)}
            </div>
            <p className="mt-2 text-sm sm:text-base font-medium text-amber-800/90 flex items-center gap-1.5 leading-relaxed">
              <span>📦</span>
              <span>{t("{count} টি পণ্যের স্টক মজুদ রয়েছে", { count: toBnDigits(stockProductCount) })}</span>
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-amber-200/80 pt-4">
            <span className="text-xs sm:text-sm text-amber-800/80 font-semibold">{t("পণ্যভিত্তিক দৈনিক হিসাব")}</span>
            <span
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-xs transition group-hover:bg-amber-700 group-hover:shadow"
            >
              <span>{t("বিস্তারিত দেখুন")}</span>
              <span aria-hidden>→</span>
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}

export interface QuickActionCard {
  href: string;
  title: string;
  subLabel: string;
  icon: React.ReactNode;
  colors: {
    card: string;
    icon: string;
    title: string;
    subLabel: string;
  };
}

/**
 * Premium quick entry / quick actions section for accountants to record daily transactions fast.
 * 6 responsive cards (Grid 2/3/6 col) with custom color themes, smooth transitions, and bilingual labels.
 */
export async function QuickAccountingActions({ ctx }: { ctx?: AppContext } = {}) {
  const t = await getT();
  const isRiceMill = ctx ? businessModules(ctx.business.businessTypes).has("RICE_MILL") : true;
  const isDep = ctx ? isDepot(ctx.business.businessType) : false;

  const actions: QuickActionCard[] = isRiceMill
    ? [
    {
      href: "/purchases/paddy/new",
      title: "ধান ক্রয় ও স্কেল",
      subLabel: "Paddy Purchase",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0-18l-8 5m8-5l8 5M4 8l-2 5a3 3 0 006 0L6 8zm12 0l-2 5a3 3 0 006 0l-2-5zM9 21h6" />
        </svg>
      ),
      colors: {
        card: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 hover:border-amber-300",
        icon: "bg-amber-100 text-amber-700 border-amber-200",
        title: "text-amber-950",
        subLabel: "text-amber-700",
      },
    },
    {
      href: "/vouchers/receipt/new",
      title: "রিসিপ্ট / জমা",
      subLabel: "Receipt Voucher",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 5L5 19M5 19h10M5 19V9" />
        </svg>
      ),
      colors: {
        card: "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300",
        icon: "bg-emerald-100 text-emerald-700 border-emerald-200",
        title: "text-emerald-950",
        subLabel: "text-emerald-700",
      },
    },
    {
      href: "/vouchers/payment/new",
      title: "পেমেন্ট / খরচ",
      subLabel: "Payment Voucher",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 19L19 5M19 5H9M19 5v10" />
        </svg>
      ),
      colors: {
        card: "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 hover:border-rose-300",
        icon: "bg-rose-100 text-rose-700 border-rose-200",
        title: "text-rose-950",
        subLabel: "text-rose-700",
      },
    },
    {
      href: "/vouchers/purchase/new",
      title: "ক্রয়",
      subLabel: "Purchase",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
      colors: {
        card: "bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300",
        icon: "bg-indigo-100 text-indigo-700 border-indigo-200",
        title: "text-indigo-950",
        subLabel: "text-indigo-700",
      },
    },
    {
      href: "/vouchers/sales/new",
      title: "বিক্রয়",
      subLabel: "Sales",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m5 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      colors: {
        card: "bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 hover:border-sky-300",
        icon: "bg-sky-100 text-sky-700 border-sky-200",
        title: "text-sky-950",
        subLabel: "text-sky-700",
      },
    },
    {
      href: "/production/new",
      title: "মিলিং ও প্রসেসিং",
      subLabel: "Milling & Processing",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      colors: {
        card: "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100 hover:border-teal-300",
        icon: "bg-teal-100 text-teal-700 border-teal-200",
        title: "text-teal-950",
        subLabel: "text-teal-700",
      },
    },
  ]
: [
    {
      href: "/pos",
      title: "পস বিক্রয়",
      subLabel: "POS Sales",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m5 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      colors: {
        card: "bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 hover:border-sky-300",
        icon: "bg-sky-100 text-sky-700 border-sky-200",
        title: "text-sky-950",
        subLabel: "text-sky-700",
      },
    },
    {
      href: "/vouchers/receipt/new",
      title: "রিসিপ্ট / জমা",
      subLabel: "Receipt Voucher",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 5L5 19M5 19h10M5 19V9" />
        </svg>
      ),
      colors: {
        card: "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300",
        icon: "bg-emerald-100 text-emerald-700 border-emerald-200",
        title: "text-emerald-950",
        subLabel: "text-emerald-700",
      },
    },
    {
      href: "/vouchers/payment/new",
      title: "পেমেন্ট / পরিশোধ",
      subLabel: "Payment Voucher",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 19L19 5M19 5H9M19 5v10" />
        </svg>
      ),
      colors: {
        card: "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 hover:border-rose-300",
        icon: "bg-rose-100 text-rose-700 border-rose-200",
        title: "text-rose-950",
        subLabel: "text-rose-700",
      },
    },
    {
      href: "/vouchers/purchase/new",
      title: "ক্রয়",
      subLabel: "Purchase",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
      colors: {
        card: "bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300",
        icon: "bg-indigo-100 text-indigo-700 border-indigo-200",
        title: "text-indigo-950",
        subLabel: "text-indigo-700",
      },
    },
    {
      href: "/vouchers/payment/new?mode=expense",
      title: "দৈনিক খরচ",
      subLabel: "Expense Voucher",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
      colors: {
        card: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 hover:border-amber-300",
        icon: "bg-amber-100 text-amber-700 border-amber-200",
        title: "text-amber-950",
        subLabel: "text-amber-700",
      },
    },
    isDep
      ? {
          href: "/depot/deliveries/new",
          title: "ডেলিভারি চালান",
          subLabel: "Delivery Challan",
          icon: (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          ),
          colors: {
            card: "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100 hover:border-teal-300",
            icon: "bg-teal-100 text-teal-700 border-teal-200",
            title: "text-teal-950",
            subLabel: "text-teal-700",
          },
        }
      : {
          href: "/vouchers/journal/new",
          title: "জার্নাল ভাউচার",
          subLabel: "Journal Voucher",
          icon: (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          ),
          colors: {
            card: "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100 hover:border-purple-300",
            icon: "bg-purple-100 text-purple-700 border-purple-200",
            title: "text-purple-950",
            subLabel: "text-purple-700",
          },
        },
  ];

  return (
    <section className="mt-6 mb-4" id="quick-accounting-actions" aria-labelledby="quick-accounting-heading">
      <div className="mb-3">
        <h2 id="quick-accounting-heading" className="text-lg sm:text-xl font-bold text-ink-900 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold" aria-hidden>
            ⚡
          </span>
          <span>{t("দ্রুত এন্ট্রি ও ভাউচার")}</span>
        </h2>
        <p className="mt-1 text-xs sm:text-sm font-medium text-slate-600 leading-relaxed">
          {t("অ্যাকাউন্ট্যান্টের সহজে ও দ্রুত লেনদেন এন্ট্রি দেওয়ার শর্টকাট")}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-3.5">
        {actions.map((item) => (
          <Link
            prefetch={false}
            key={item.href}
            href={item.href}
            className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border p-4 sm:p-4.5 transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 ${item.colors.card}`}
          >
            <div className="flex items-center justify-between w-full mb-3">
              <div className={`flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl border shadow-xs transition-transform duration-200 group-hover:scale-105 ${item.colors.icon}`}>
                {item.icon}
              </div>
              <span className="text-xs font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-80" aria-hidden>
                →
              </span>
            </div>
            <div>
              <div className={`text-base sm:text-lg font-bold leading-relaxed tracking-tight ${item.colors.title}`}>
                {t(item.title)}
              </div>
              <div className={`mt-1 text-xs sm:text-sm font-medium tracking-wide leading-normal ${item.colors.subLabel}`}>
                {item.subLabel}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
