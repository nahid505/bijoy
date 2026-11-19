import type { Metadata } from "next";
import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { calculateJVSettlement, getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { CustomMillingTabs, PrintButton } from "../custom-milling-ui";

export const metadata: Metadata = {
  title: "৬০:৪০ জয়েন্ট ভেঞ্চার পার্টনারশিপ হিসাব",
};

export default async function CustomMillingJVReportPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; range?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const role = resolveMillRole(ctx, sp.role);

  // RBAC: MILL_ACCOUNTANT cannot access JV report
  if (role === "MILL_ACCOUNTANT") {
    return (
      <div className="space-y-6">
        <PageHeader title="৬০:৪০ পার্টনারশিপ হিসাব" description="প্রবেশাধিকার সংরক্ষিত" />
        <CustomMillingTabs role={role} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-900">
          <span className="text-4xl">🚫</span>
          <h2 className="mt-2 text-lg font-bold">অনুমতি নেই (Access Restricted)</h2>
          <p className="mt-1 text-sm text-red-700">
            ৬০:৪০ জয়েন্ট ভেঞ্চার পার্টনারশিপ আর্থিক প্রতিবেদন শুধুমাত্র মালিক (নাহিদ হাসান) এবং মিল পার্টনারদের জন্য সংরক্ষিত।
          </p>
        </div>
      </div>
    );
  }

  // Parse date range
  const now = new Date();
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  const range = sp.range || "all";

  if (range === "today") {
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (range === "month") {
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (sp.from && sp.to) {
    fromDate = new Date(sp.from);
    toDate = new Date(sp.to);
  }

  const [jv, settings] = await Promise.all([
    calculateJVSettlement({ from: fromDate, to: toDate }),
    getRiceMillSettings(),
  ]);

  const CATEGORY_NAMES: Record<string, string> = {
    MILL_RENT: "মিলের ভাড়া (Rent)",
    ELECTRICITY_FUEL: "বিদ্যুৎ ও জ্বালানি / ডিজেল",
    LABOUR: "শ্রমিক মজুরি (Labour)",
    PARTS_MAINTENANCE: "যন্ত্রাংশ ও মেরামত",
    OTHER: "অন্যান্য মিল খরচ",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between no-print">
        <PageHeader
          title="৬০:৪০ জয়েন্ট ভেঞ্চার পার্টনারশিপ হিসাব"
          description={`পার্টনারশিপ লাভ-ক্ষতি ও পার্টনার সেটেলমেন্ট বিবরণী (${settings.partner1Name} ৬০% : ${settings.partner2Name} ৪০%)`}
        />
        <div className="flex items-center gap-2">
          <PrintButton />
        </div>
      </div>

      <div className="no-print">
        <CustomMillingTabs role={role} />
      </div>

      {/* Date Filter Bar (Hidden on print) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-white p-3.5 shadow-2xs no-print">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">সময়সীমা:</span>
          <Link
            href={`/custom-milling/reports?range=all${sp.role ? `&role=${sp.role}` : ""}`}
            prefetch={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              range === "all" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            সার্বক্ষণিক (All Time)
          </Link>
          <Link
            href={`/custom-milling/reports?range=month${sp.role ? `&role=${sp.role}` : ""}`}
            prefetch={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              range === "month" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            চলতি মাস (This Month)
          </Link>
          <Link
            href={`/custom-milling/reports?range=today${sp.role ? `&role=${sp.role}` : ""}`}
            prefetch={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              range === "today" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            আজকের দিন (Today)
          </Link>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          স্ট্যান্ডার্ড বস্তা: <span className="font-bold text-slate-800">{settings.bagStandardKg} KG</span>
        </div>
      </div>

      {/* Top Settlement KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-emerald-900">মোট রাজস্ব আয় (Revenue)</p>
          <p className="text-2xl font-black text-emerald-950">৳ {formatNumber(jv.totalRevenue)}</p>
          <span className="text-[10px] text-emerald-700">মাড়াই বিল + কুঁড়া/ভূসি বিক্রয়</span>
        </div>

        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-red-900">মোট মিল খরচ (Expenses)</p>
          <p className="text-2xl font-black text-red-950">৳ {formatNumber(jv.totalExpenses)}</p>
          <span className="text-[10px] text-red-700">ভাড়া, বিদ্যুৎ, শ্রমিক ও মেরামত</span>
        </div>

        <div className={`rounded-xl border p-4 shadow-2xs ${jv.netProfit >= 0 ? "border-brand-200 bg-brand-50/70" : "border-rose-200 bg-rose-50/70"}`}>
          <p className="text-[11px] font-semibold text-brand-900">মোট নিট লাভ (Net Profit)</p>
          <p className={`text-2xl font-black ${jv.netProfit >= 0 ? "text-brand-950" : "text-rose-950"}`}>
            ৳ {formatNumber(jv.netProfit)}
          </p>
          <span className="text-[10px] text-brand-700">রাজস্ব - খরচ</span>
        </div>

        <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-purple-900">মিলের নগদ ক্যাশ স্থিতি</p>
          <p className="text-2xl font-black text-purple-950">৳ {formatNumber(jv.millCashBalance)}</p>
          <span className="text-[10px] text-purple-700">মিলের বাক্সে ক্যাশ ইন হ্যান্ড</span>
        </div>
      </div>

      {/* Main Printable Financial Statement */}
      <section className="panel p-6 sm:p-8 bg-white print:border-none print:shadow-none print:p-0">
        {/* Header for print */}
        <div className="border-b-2 border-slate-900 pb-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">{settings.millName}</h1>
          <p className="text-xs text-slate-600 font-medium mt-0.5">
            {settings.millAddress} · মোবাইল: {settings.millPhone}
          </p>
          <div className="mt-2 inline-block rounded border border-slate-800 bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-900">
            ৬০:৪০ জয়েন্ট ভেঞ্চার অংশীদারি হিসাব বিবরণী
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            সময়কাল: {range === "today" ? "আজকের দিন" : range === "month" ? "চলতি মাস" : "সার্বক্ষণিক"}
          </p>
        </div>

        {/* 2-Column: Revenue & Expense Breakdown */}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* Revenue Breakdown */}
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="border-b border-rule pb-2 font-bold text-slate-900 flex items-center justify-between text-sm">
              <span>📈 রাজস্ব / আয় বিবরণী</span>
              <span className="text-emerald-700 font-mono">৳ {formatNumber(jv.totalRevenue)}</span>
            </h3>

            <div className="divide-y divide-slate-100 text-xs">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="font-semibold text-slate-800">বহিরাগত গ্রাহক মাড়াই বিল</p>
                  <p className="text-[10px] text-slate-400">ড্রায়ার ও মিলিং চার্জ (বাহিরের পার্টি)</p>
                </div>
                <p className="font-mono font-bold text-slate-900">৳ {formatNumber(jv.totalOutsideRevenue)}</p>
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="font-semibold text-amber-900">নিজস্ব পার্টি মাড়াই বিল ({settings.partner1Name})</p>
                  <p className="text-[10px] text-slate-400">মালিকের নিজস্ব ব্যবসার ধান প্রসেসিং বিল</p>
                </div>
                <p className="font-mono font-bold text-amber-950">৳ {formatNumber(jv.totalOwnerSelfRevenue)}</p>
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="font-semibold text-slate-800">উপজাত বিক্রয় আয় (By-Products)</p>
                  <p className="text-[10px] text-slate-400">মিলের রাখা কুঁড়া ও ভূসি বিক্রয়</p>
                </div>
                <p className="font-mono font-bold text-slate-900">৳ {formatNumber(jv.totalByProductRevenue)}</p>
              </div>

              <div className="flex items-center justify-between py-2.5 font-bold bg-slate-50 px-2 rounded mt-1">
                <span className="text-slate-900">সর্বমোট মিল রাজস্ব:</span>
                <span className="text-emerald-800 font-mono font-black">৳ {formatNumber(jv.totalRevenue)}</span>
              </div>
            </div>
          </div>

          {/* Expense Breakdown */}
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="border-b border-rule pb-2 font-bold text-slate-900 flex items-center justify-between text-sm">
              <span>📉 মিল ব্যয় / খরচ বিবরণী</span>
              <span className="text-red-700 font-mono">৳ {formatNumber(jv.totalExpenses)}</span>
            </h3>

            <div className="divide-y divide-slate-100 text-xs">
              {Object.entries(jv.expensesByCategory).map(([cat, amt]) => (
                <div key={cat} className="flex items-center justify-between py-2">
                  <p className="font-semibold text-slate-800">{CATEGORY_NAMES[cat] || cat}</p>
                  <p className="font-mono font-bold text-slate-900">৳ {formatNumber(amt)}</p>
                </div>
              ))}

              <div className="flex items-center justify-between py-2.5 font-bold bg-slate-50 px-2 rounded mt-1">
                <span className="text-slate-900">সর্বমোট মিল খরচ:</span>
                <span className="text-red-800 font-mono font-black">৳ {formatNumber(jv.totalExpenses)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 60:40 Profit Sharing Cards */}
        <div className="mt-6 rounded-xl border border-brand-300 bg-brand-50/40 p-5">
          <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
            <span>🤝</span>
            <span>অংশীদারি লাভ বণ্টন (Profit Distribution)</span>
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-300 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                <span className="font-bold text-amber-950 text-sm">
                  {jv.partner1Name} ({jv.partner1SharePct}%)
                </span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  মালিক ও মূল পার্টনার
                </span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">নিট লাভের {jv.partner1SharePct}% অংশ:</span>
                  <span className="font-mono font-bold text-amber-900">৳ {formatNumber(jv.partner1ShareAmount)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-blue-300 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between border-b border-blue-100 pb-2">
                <span className="font-bold text-blue-950 text-sm">
                  {jv.partner2Name} ({jv.partner2SharePct}%)
                </span>
                <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">
                  অংশীদার (পার্টনার ২)
                </span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">নিট লাভের {jv.partner2SharePct}% অংশ:</span>
                  <span className="font-mono font-bold text-blue-900">৳ {formatNumber(jv.partner2ShareAmount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Partner Settlement Accounts */}
        <div className="mt-6">
          <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
            <span>⚖️</span>
            <span>পার্টনার সেটেলমেন্ট খতিয়ান (Partner Settlement Statement)</span>
          </h3>

          <div className="overflow-x-auto">
            <table className="table w-full text-xs border border-slate-200">
              <thead>
                <tr className="bg-slate-100 text-slate-800 border-b border-slate-300">
                  <th className="py-2.5">পার্টনারের নাম</th>
                  <th className="py-2.5">অংশ %</th>
                  <th className="num py-2.5">লাভের অংশ (+)</th>
                  <th className="num py-2.5">নিজের পকেট খরচ (+)</th>
                  <th className="num py-2.5">উত্তোলন / গৃহীত (-)</th>
                  <th className="num py-2.5">চূড়ান্ত পাওনা / দেনা (Net Settlement)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="hover:bg-slate-50 border-b border-slate-200">
                  <td className="py-2.5 font-bold text-amber-950">
                    {jv.partner1Name}
                    <span className="block text-[10px] text-amber-700">পার্টনার ১</span>
                  </td>
                  <td className="py-2.5 font-semibold">{jv.partner1SharePct}%</td>
                  <td className="num py-2.5 font-semibold text-slate-900">
                    ৳ {formatNumber(jv.partner1ShareAmount)}
                  </td>
                  <td className="num py-2.5 font-semibold text-amber-800">
                    ৳ {formatNumber(jv.partner1OutOfPocket)}
                  </td>
                  <td className="num py-2.5 font-semibold text-red-700">
                    - ৳ {formatNumber(jv.partner1Withdrawals)}
                  </td>
                  <td className={`num py-2.5 font-bold text-sm ${jv.partner1NetSettlement >= 0 ? "text-emerald-800" : "text-red-700"}`}>
                    ৳ {formatNumber(jv.partner1NetSettlement)}
                  </td>
                </tr>

                <tr className="hover:bg-slate-50 border-b border-slate-200">
                  <td className="py-2.5 font-bold text-blue-950">
                    {jv.partner2Name}
                    <span className="block text-[10px] text-blue-700">পার্টনার ২</span>
                  </td>
                  <td className="py-2.5 font-semibold">{jv.partner2SharePct}%</td>
                  <td className="num py-2.5 font-semibold text-slate-900">
                    ৳ {formatNumber(jv.partner2ShareAmount)}
                  </td>
                  <td className="num py-2.5 font-semibold text-blue-800">
                    ৳ {formatNumber(jv.partner2OutOfPocket)}
                  </td>
                  <td className="num py-2.5 font-semibold text-red-700">
                    - ৳ {formatNumber(jv.partner2Withdrawals)}
                  </td>
                  <td className={`num py-2.5 font-bold text-sm ${jv.partner2NetSettlement >= 0 ? "text-emerald-800" : "text-red-700"}`}>
                    ৳ {formatNumber(jv.partner2NetSettlement)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            * ফর্মুলা: চূড়ান্ত প্রাপ্য = লাভের অংশ (+) নিজের পকেট থেকে দেয়া মিল খরচ (+) - মিল থেকে নেওয়া উত্তোলন (-)
          </p>
        </div>

        {/* Footer Note */}
        <div className="mt-8 border-t border-rule pt-4 text-center text-xs text-slate-500">
          <p>{settings.invoiceFooterNote}</p>
        </div>

        {/* Signatures (Print Only) */}
        <div className="mt-20 hidden print:grid grid-cols-2 text-center text-xs text-slate-700">
          <div>
            <div className="mx-auto w-48 border-t border-slate-700 pt-1 font-semibold">
              {jv.partner1Name} (৬০%)
            </div>
          </div>
          <div>
            <div className="mx-auto w-48 border-t border-slate-700 pt-1 font-semibold">
              {jv.partner2Name} (৪০%)
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
