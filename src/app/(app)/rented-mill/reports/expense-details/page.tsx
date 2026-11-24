import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  EXPENSE_CATEGORIES,
  getRentedMillSettings,
  parseExpenseCategories,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  AutoPrint,
  PrintButton,
  RentedMillTabs,
  ReportPrintHeader,
} from "../../rented-mill-ui";
import { ExpenseRowActions } from "../../rented-mill-edit-modals";

export const metadata: Metadata = {
  title: "খরচের বিস্তারিত বিবরণ রিপোর্ট - শুভংকর অটো রাইস মিল",
};

export default async function ExpenseDetailsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; category?: string; print?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const shouldAutoPrint = sp.print === "true";
  const range = sp.range || "month";
  const filterCat = sp.category || "";

  const configuredCategories = parseExpenseCategories(settings.expenseCategories);

  const now = new Date();
  let dateFilter: { gte?: Date; lte?: Date } | undefined;
  let rangeLabel = "চলতি মাস";

  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = `আজ (${getBengaliDateLabel(start)})`;
  } else if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = `${now.toLocaleString("bn-BD", { month: "long" })} ${toBn(now.getFullYear())}`;
  } else if (range === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = "গত মাস";
  } else if (range === "custom" && (sp.from || sp.to)) {
    const gte = sp.from ? new Date(`${sp.from}T00:00:00`) : undefined;
    const lte = sp.to ? new Date(`${sp.to}T23:59:59`) : undefined;
    dateFilter = { gte, lte };
    rangeLabel = `${sp.from ? toBn(sp.from) : ""} হতে ${sp.to ? toBn(sp.to) : ""}`;
  } else if (range === "all") {
    dateFilter = undefined;
    rangeLabel = "সব সময়ের সার্বিক খরচ";
  }

  const whereClause: any = {
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(filterCat ? { category: filterCat } : {}),
    status: "APPROVED",
  };

  const expenses = await prisma.rentedMillExpense.findMany({
    where: whereClause,
    orderBy: { date: "asc" },
  });

  const totalExpenseAmount = expenses.reduce((s, x) => s + x.amount, 0);

  const buildUrl = (targetCat?: string, targetRange?: string) => {
    const p = new URLSearchParams();
    const r = targetRange !== undefined ? targetRange : range;
    if (r) p.set("range", r);
    if (r === "custom") {
      if (sp.from) p.set("from", sp.from);
      if (sp.to) p.set("to", sp.to);
    }
    const c = targetCat !== undefined ? targetCat : filterCat;
    if (c) p.set("category", c);
    const qs = p.toString();
    return `/rented-mill/reports/expense-details${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      {shouldAutoPrint && <AutoPrint />}
      <RentedMillTabs role={role} />

      {/* Screen Controls & Date Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            খরচের বিস্তারিত বিবরণ রিপোর্ট
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            {settings.millName}, {settings.millAddress} · সময়কাল: <b>{rangeLabel}</b>
            {filterCat && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 border border-brand-200">
                খাত: {filterCat}
                <Link href={buildUrl("")} className="hover:text-red-600 ml-0.5" title="ফিল্টার মুছুন">
                  ✕
                </Link>
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-rule bg-white p-1 text-xs shadow-2xs">
            <Link
              href={buildUrl(undefined, "today")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "today" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              আজ
            </Link>
            <Link
              href={buildUrl(undefined, "month")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "month" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              চলতি মাস
            </Link>
            <Link
              href={buildUrl(undefined, "last-month")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "last-month" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              গত মাস
            </Link>
            <Link
              href={buildUrl(undefined, "all")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "all" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              সব সময়
            </Link>
          </div>

          <PrintButton label="A4 প্রিন্ট করুন" />
        </div>
      </div>

      {/* Category Filter Pills (Screen Only) */}
      <div className="flex flex-wrap items-center gap-1.5 no-print rounded-xl border border-rule bg-slate-50 p-2.5">
        <span className="mr-1 inline-flex items-center gap-1 text-xs font-bold text-slate-600">
          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          খাত ফিল্টার:
        </span>
        <Link
          href={buildUrl("")}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
            !filterCat
              ? "bg-slate-900 text-white shadow-xs"
              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
          }`}
        >
          সকল খাত
        </Link>
        {configuredCategories.map((cat) => {
          const isSelected = filterCat === cat;
          return (
            <Link
              key={cat}
              href={buildUrl(cat)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                isSelected
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              {cat}
            </Link>
          );
        })}
      </div>

      {/* Printable Report Header */}
      <ReportPrintHeader
        millName={settings.millName}
        millAddress={settings.millAddress}
        title="খরচের বিস্তারিত বিবরণ রিপোর্ট"
        subTitle={`হিসাবের সময়কাল: ${rangeLabel}${filterCat ? ` (খাত: ${filterCat})` : ""}`}
      />

      {/* Main Expenses Table */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden print:border-black print:rounded-none">
        <table className="w-full text-left text-xs print:text-xs">
          <thead>
            <tr className="border-b border-rule bg-slate-100/90 text-slate-800 print:border-black print:bg-slate-200 font-bold">
              <th className="py-2.5 px-3 w-14 text-center">ক্রমিক নং</th>
              <th className="py-2.5 px-3 w-28">তারিখ</th>
              <th className="py-2.5 px-3 w-40">খরচের খাত</th>
              <th className="py-2.5 px-3">বিস্তারিত বিবরণ</th>
              <th className="py-2.5 px-3 w-32">প্রাপক</th>
              <th className="py-2.5 px-3 text-right w-36">পরিমাণ (টাকা)</th>
              {role !== "PARTNER" && (
                <th className="py-2.5 px-3 text-center w-16 no-print">একশন</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 print:divide-black">
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={role !== "PARTNER" ? 7 : 6} className="py-12 text-center text-slate-400 print:text-slate-600">
                  নির্বাচিত সময়সীমায় কোনো খরচের এন্ট্রি পাওয়া যায়নি।
                </td>
              </tr>
            ) : (
              expenses.map((exp, idx) => (
                <tr key={exp.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 text-center font-semibold text-slate-600 print:text-black">
                    {toBn(idx + 1)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500 print:text-black">
                    {getBengaliDateLabel(exp.date)}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-ink-900 print:text-black">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold print:p-0 ${
                        exp.category === "মাসিক মিল ভাড়া"
                          ? "bg-purple-100 text-purple-900"
                          : exp.category === "বিদ্যুৎ বিল"
                          ? "bg-yellow-100 text-yellow-900"
                          : exp.category === "লেবার খরচ"
                          ? "bg-blue-100 text-blue-900"
                          : "bg-slate-100 text-slate-800"
                      }`}
                    >
                      {exp.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-medium text-ink-900 print:text-black">
                    {exp.description || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 print:text-black">
                    {exp.paidTo || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-red-700 print:text-black">
                    {formatBnCurrency(exp.amount)}
                  </td>
                  {role !== "PARTNER" && (
                    <td className="py-2.5 px-3 text-center no-print">
                      <ExpenseRowActions expense={exp} role={role} compact={true} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-rule bg-slate-100 font-bold text-xs print:border-black print:bg-slate-200">
              <td colSpan={5} className="py-2.5 px-3 text-right">
                {filterCat ? `সর্বমোট খরচ (${filterCat}):` : "সর্বমোট খরচ:"}
              </td>
              <td className="py-2.5 px-3 text-right text-red-700 print:text-black font-extrabold text-sm">
                {formatBnCurrency(totalExpenseAmount)}
              </td>
              {role !== "PARTNER" && <td className="no-print"></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Print Signatures */}
      <div className="hidden print:grid grid-cols-2 gap-12 pt-16 text-center text-xs text-black">
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            হিসাবরক্ষকের স্বাক্ষর
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            মালিকের স্বাক্ষর
          </div>
        </div>
      </div>
    </div>
  );
}
