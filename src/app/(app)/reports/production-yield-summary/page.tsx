import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { FilterField, PageHeader, PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { reportOpenFor } from "@/server/reports/registry";
import { productionYieldSummary } from "@/server/reports/production-yield-summary";

export const metadata: Metadata = { title: "উৎপাদন ও ফলন সারসংক্ষেপ রিপোর্ট" };

const CELL = "border border-slate-300 px-2.5 py-1.5 text-xs sm:text-sm print:border-slate-400 print:px-1.5 print:py-1 print:text-[10px]";
const TH = "border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 print:bg-slate-100 print:border-slate-400 print:px-1.5 print:py-1 print:text-[10px]";

export default async function ProductionYieldSummaryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("reports:view");
  if (!reportOpenFor(ctx, "production-yield-summary")) redirect("/forbidden");
  const t = await getT();
  const p = await readParams(searchParams);

  const data = await productionYieldSummary(ctx.business.id, {
    from_date: p.from_date ?? p.from,
    to_date: p.to_date ?? p.to,
    yield_base: p.yield_base ?? p.yield_standard,
  });

  const cur = ctx.business.currencySymbol;
  const exportHref = `/api/reports/production-yield-summary?from_date=${data.fromDate}&to_date=${data.toDate}&yield_base=${data.yieldBase}`;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-area { border: none !important; box-shadow: none !important; padding: 0 !important; }
        }
      `}</style>

      {/* Screen Header */}
      <div className="no-print">
        <PageHeader
          title="উৎপাদন ও ফলন সারসংক্ষেপ রিপোর্ট"
          description="কাঁচামাল ক্রয়, মিলিং প্রসেসিং, ফলন বিশ্লেষণ ও তৈরি পণ্য বিক্রয়ের সমন্বিত সারসংক্ষেপ"
          crumbs={[{ label: "রিপোর্ট", href: "/reports" }, { label: "উৎপাদন ও ফলন রিপোর্ট" }]}
          actions={
            <>
              <PrintButton label="প্রিন্ট / PDF" />
              <a href={`${exportHref}&format=xlsx`} className="btn-secondary" id="export-xlsx">
                ⬇ Excel
              </a>
              <a href={exportHref} className="btn-secondary" id="export-csv">
                ⬇ CSV
              </a>
            </>
          }
        />
      </div>

      <div className="space-y-4 print:space-y-3">
        {/* Filter Toolbar (Screen Only) */}
        <section className="panel no-print">
          <form
            key={`${data.fromDate}|${data.toDate}|${data.yieldBase}`}
            method="get"
            action="/reports/production-yield-summary"
            className="flex flex-wrap items-end gap-2.5 p-3"
          >
            <FilterField label="শুরুর তারিখ">
              <input
                type="date"
                id="from_date"
                name="from_date"
                defaultValue={data.fromDate}
                className="input w-36 sm:w-40"
                required
              />
            </FilterField>
            <FilterField label="শেষের তারিখ">
              <input
                type="date"
                id="to_date"
                name="to_date"
                defaultValue={data.toDate}
                className="input w-36 sm:w-40"
                required
              />
            </FilterField>
            <FilterField label="ফলনের স্ট্যান্ডার্ড (বস্তা)">
              <select
                id="yield_base"
                name="yield_base"
                defaultValue={String(data.yieldBase)}
                className="input w-36 sm:w-44 font-medium"
              >
                <option value="75">৭৫ কেজি (75 KG)</option>
                <option value="80">৮০ কেজি (80 KG)</option>
              </select>
            </FilterField>
            <button type="submit" className="btn-primary">
              {t("দেখুন")}
            </button>
            <Link
              prefetch={false}
              href="/reports/production-yield-summary"
              className="btn-ghost"
            >
              {t("রিসেট")}
            </Link>
          </form>
        </section>

        {/* Print Letterhead */}
        <div className="print-only">
          <PrintHeader
            business={ctx.business}
            title="উৎপাদন ও ফলন সারসংক্ষেপ রিপোর্ট"
            subtitle={`${formatDate(data.fromDate)} হতে ${formatDate(data.toDate)} · ফলন স্ট্যান্ডার্ড: ${toBnDigits(data.yieldBase)} কেজি`}
          />
        </div>

        {/* Top 4 Summary Cards */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3.5" id="summary-cards">
          {/* Card 1: মোট কাঁচামাল ক্রয় */}
          <div className="panel px-3.5 py-3 border-l-4 border-l-slate-600 bg-white shadow-2xs">
            <p className="text-[11px] sm:text-xs font-semibold text-slate-600 uppercase tracking-wide">
              {t("১. মোট কাঁচামাল ক্রয়")}
            </p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-ink-900 leading-tight">
              {toBnDigits(data.cards.rawPurchased.mon.toFixed(2))} {t("মণ")}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">
              {formatQty(data.cards.rawPurchased.kg)} {t("কেজি")}
            </p>
            <p className="mt-1 text-xs font-semibold text-emerald-700 tabular-nums">
              {t("মূল্য:")} {formatMoney(data.cards.rawPurchased.cost, cur)}
            </p>
          </div>

          {/* Card 2: মোট কাঁচামাল প্রক্রিয়াজাত/ব্যবহৃত */}
          <div className="panel px-3.5 py-3 border-l-4 border-l-blue-600 bg-white shadow-2xs">
            <p className="text-[11px] sm:text-xs font-semibold text-blue-800 uppercase tracking-wide">
              {t("২. মোট প্রক্রিয়াজাত/ব্যবহৃত")}
            </p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-blue-900 leading-tight">
              {formatQty(data.cards.rawProcessed.kg)} {t("কেজি")}
            </p>
            <p className="mt-0.5 text-xs text-blue-700 font-medium">
              {toBnDigits(data.cards.rawProcessed.mon.toFixed(2))} {t("মণ ভাঙানো হয়েছে")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("মিলিংয়ে চাল ও উপজাত উৎপাদন")}
            </p>
          </div>

          {/* Card 3: গড় ফলন (Yield Rate) */}
          <div className="panel px-3.5 py-3 border-l-4 border-l-emerald-600 bg-emerald-50/30 shadow-2xs">
            <p className="text-[11px] sm:text-xs font-semibold text-emerald-800 uppercase tracking-wide">
              {t("৩. গড় ফলন (Yield Rate)")}
            </p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-emerald-800 leading-tight">
              {toBnDigits(data.cards.averageYield.yieldPerBag.toFixed(2))} {t("কেজি")}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700 font-bold tabular-nums">
              ({toBnDigits(data.cards.averageYield.yieldPct.toFixed(2))}%)
            </p>
            <p className="mt-1 text-xs text-slate-500">
              প্রতি {toBnDigits(data.yieldBase)} কেজিতে ফলন
            </p>
          </div>

          {/* Card 4: মোট বিক্রয় */}
          <div className="panel px-3.5 py-3 border-l-4 border-l-amber-600 bg-white shadow-2xs">
            <p className="text-[11px] sm:text-xs font-semibold text-amber-800 uppercase tracking-wide">
              {t("৪. মোট বিক্রয়")}
            </p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-amber-900 leading-tight">
              {formatMoney(data.cards.finishedSold.amount, cur)}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 font-medium tabular-nums">
              {formatQty(data.cards.finishedSold.kg)} {t("কেজি")}
              {data.cards.finishedSold.bags ? ` · ${toBnDigits(data.cards.finishedSold.bags.toFixed(1))} ${t("বস্তা")}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("চাল ও উপজাত বিক্রয়")}
            </p>
          </div>
        </div>

        {/* Section A: কাঁচামাল ক্রয় ও ব্যবহার */}
        <section className="panel print:border print:border-slate-300">
          <div className="flex items-center justify-between border-b border-rule bg-slate-50 px-3.5 py-2.5 print:bg-white print:py-1">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white print:hidden">
                ক
              </span>
              <h2 className="text-sm sm:text-base font-bold text-ink-900">
                {t("সেকশন ক: কাঁচামাল ক্রয় ও ব্যবহার (Raw Material Section)")}
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {toBnDigits(data.sectionA.rows.length)} {t("টি এন্ট্রি")}
            </span>
          </div>

          {data.sectionA.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {t("নির্বাচিত সময়ের মধ্যে কোনো ধান ক্রয় বা ব্যবহার হয়নি")}
            </p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-left" id="section-a-table">
                <thead>
                  <tr>
                    <th className={`${TH} w-24 text-center`}>{t("তারিখ")}</th>
                    <th className={`${TH} text-left`}>{t("ধান/কাঁচামালের বিবরণ/লট")}</th>
                    <th className={`${TH} text-right`}>{t("ক্রয়ের পরিমাণ (কেজি/মণ)")}</th>
                    <th className={`${TH} text-right`}>{t("মোট ক্রয়ের মূল্য (৳)")}</th>
                    <th className={`${TH} text-right`}>{t("মিলিংয়ে ব্যবহৃত পরিমাণ (কেজি)")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sectionA.rows.map((r, i) => (
                    <tr key={`${r.voucherId}-${i}`} className="hover:bg-slate-50 print:break-inside-avoid">
                      <td className={`${CELL} text-center tabular-nums whitespace-nowrap`}>
                        {formatDate(r.date)}
                      </td>
                      <td className={`${CELL} break-words`}>
                        {r.voucherId ? (
                          <Link
                            prefetch={false}
                            href={`/vouchers/v/${r.voucherId}`}
                            className="font-medium text-brand-700 hover:underline print:text-black"
                          >
                            {r.lotDescription}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-700">{r.lotDescription}</span>
                        )}
                        {r.statusBadge && (
                          <span className="ml-2 inline-block rounded bg-slate-100 px-1.5 py-0.2 text-[10px] text-slate-600 print:hidden font-medium">
                            {r.statusBadge}
                          </span>
                        )}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                        {r.purchaseKg > 0 ? (
                          <>
                            <span className="font-semibold text-ink-900">{formatQty(r.purchaseKg)} {t("কেজি")}</span>
                            <span className="block text-[11px] text-slate-500 print:text-[9px]">
                              {toBnDigits(r.purchaseMon.toFixed(2))} {t("মণ")}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                        {r.purchaseCost > 0 ? (
                          <span className="font-semibold text-emerald-800">{formatMoney(r.purchaseCost, cur)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                        {r.milledKg > 0 ? (
                          <>
                            <span className="font-semibold text-blue-900">{formatQty(r.milledKg)} {t("কেজি")}</span>
                            <span className="block text-[11px] text-slate-500 print:text-[9px]">
                              {toBnDigits((r.milledKg / 40).toFixed(2))} {t("মণ")}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400 font-normal">০ {t("কেজি")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold print:bg-white border-t-2 border-t-slate-500">
                  <tr>
                    <td colSpan={2} className={`${CELL} text-right font-bold`}>
                      {t("সর্বমোট কাঁচামাল")}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                      <span className="font-bold text-ink-900">{formatQty(data.sectionA.totals.purchaseKg)} {t("কেজি")}</span>
                      <span className="block text-[11px] font-normal text-slate-600 print:text-[9px]">
                        {toBnDigits(data.sectionA.totals.purchaseMon.toFixed(2))} {t("মণ")}
                      </span>
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap text-emerald-800`}>
                      {formatMoney(data.sectionA.totals.purchaseCost, cur)}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap text-blue-900`}>
                      <span className="font-bold">{formatQty(data.sectionA.totals.milledKg)} {t("কেজি")}</span>
                      <span className="block text-[11px] font-normal text-slate-600 print:text-[9px]">
                        {toBnDigits(data.sectionA.totals.milledMon.toFixed(2))} {t("মণ")}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Section B: উৎপাদন ও ফলন বিশ্লেষণ */}
        <section className="panel print:border print:border-slate-300">
          <div className="flex items-center justify-between border-b border-rule bg-slate-50 px-3.5 py-2.5 print:bg-white print:py-1">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white print:hidden">
                খ
              </span>
              <h2 className="text-sm sm:text-base font-bold text-ink-900">
                {t("সেকশন খ: উৎপাদন ও ফলন বিশ্লেষণ (Production & Yield Analysis)")}
              </h2>
            </div>
            <span className="text-xs text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 print:border-none print:p-0">
              {t("স্ট্যান্ডার্ড বেস:")} {toBnDigits(data.yieldBase)} {t("কেজি / বস্তা")}
            </span>
          </div>

          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-left" id="section-b-table">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>{t("উৎপাদিত পণ্যের নাম")}</th>
                  <th className={`${TH} text-right`}>{t("মোট পরিমাণ (কেজি/বস্তা)")}</th>
                  <th className={`${TH} text-right`}>{t("উৎপাদনের অনুপাত (%)")}</th>
                  <th className={`${TH} text-right`}>
                    {t("প্রতি {0} কেজিতে প্রাপ্তি (কেজি)", { 0: toBnDigits(data.yieldBase) })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sectionB.rows.map((r) => {
                  const isRice = r.kind === "rice";
                  const isLoss = r.kind === "loss";
                  return (
                    <tr
                      key={r.kind}
                      className={`hover:bg-slate-50 print:break-inside-avoid ${
                        isRice ? "bg-emerald-50/40 font-medium" : isLoss ? "text-slate-500 italic" : ""
                      }`}
                    >
                      <td className={`${CELL} font-medium`}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isRice
                                ? "bg-emerald-600"
                                : r.kind === "bran"
                                ? "bg-amber-600"
                                : r.kind === "broken"
                                ? "bg-blue-600"
                                : r.kind === "husk"
                                ? "bg-yellow-700"
                                : "bg-slate-400"
                            }`}
                          />
                          <span>{t(r.name)}</span>
                        </div>
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                        <span className="font-semibold text-ink-900">{formatQty(r.totalKg)} {t("কেজি")}</span>
                        {r.totalBags !== null && r.totalBags > 0 && (
                          <span className="block text-[11px] text-slate-500 print:text-[9px]">
                            {toBnDigits(r.totalBags.toFixed(1))} {t("বস্তা")}
                          </span>
                        )}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap font-medium`}>
                        <span className={isRice ? "font-bold text-emerald-800" : ""}>
                          {toBnDigits(r.ratioPct.toFixed(2))}%
                        </span>
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap font-semibold`}>
                        <span className={isRice ? "font-bold text-emerald-800 text-sm sm:text-base" : ""}>
                          {toBnDigits(r.perBagKg.toFixed(2))} {t("কেজি")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 font-bold print:bg-white border-t-2 border-t-slate-500">
                <tr>
                  <td className={`${CELL} font-bold`}>{t("সর্বমোট উৎপাদন ও ফলন")}</td>
                  <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                    <span className="font-bold text-ink-900">{formatQty(data.sectionB.totals.totalKg)} {t("কেজি")}</span>
                    {data.sectionB.totals.totalBags !== null && data.sectionB.totals.totalBags > 0 && (
                      <span className="block text-[11px] font-normal text-slate-600 print:text-[9px]">
                        {toBnDigits(data.sectionB.totals.totalBags.toFixed(1))} {t("বস্তা")}
                      </span>
                    )}
                  </td>
                  <td className={`${CELL} text-right tabular-nums whitespace-nowrap font-bold text-ink-900`}>
                    {toBnDigits(data.sectionB.totals.ratioPct.toFixed(2))}%
                  </td>
                  <td className={`${CELL} text-right tabular-nums whitespace-nowrap font-bold text-emerald-800`}>
                    {toBnDigits(data.sectionB.totals.perBagKg.toFixed(2))} {t("কেজি")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* Section C: বিক্রয় ও আর্থিক সারসংক্ষেপ */}
        <section className="panel print:border print:border-slate-300">
          <div className="flex items-center justify-between border-b border-rule bg-slate-50 px-3.5 py-2.5 print:bg-white print:py-1">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-white print:hidden">
                গ
              </span>
              <h2 className="text-sm sm:text-base font-bold text-ink-900">
                {t("সেকশন গ: বিক্রয় ও আর্থিক সারসংক্ষেপ (Sales & Financial Summary)")}
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {toBnDigits(data.sectionC.rows.length)} {t("টি পণ্য বিক্রয়")}
            </span>
          </div>

          {data.sectionC.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {t("নির্বাচিত সময়ের মধ্যে কোনো পণ্য বিক্রয় হয়নি")}
            </p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-left" id="section-c-table">
                <thead>
                  <tr>
                    <th className={`${TH} text-left`}>{t("বিক্রিত পণ্য")}</th>
                    <th className={`${TH} text-right`}>{t("পরিমাণ (বস্তা/কেজি)")}</th>
                    <th className={`${TH} text-right`}>{t("গড় দর (৳)")}</th>
                    <th className={`${TH} text-right`}>{t("মোট বিক্রয় মূল্য (৳)")}</th>
                    <th className={`${TH} text-right`}>{t("নগদ প্রাপ্তি")}</th>
                    <th className={`${TH} text-right`}>{t("বকেয়া")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sectionC.rows.map((r) => (
                    <tr key={r.productId} className="hover:bg-slate-50 print:break-inside-avoid">
                      <td className={`${CELL} font-medium text-ink-900`}>
                        {r.productName}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                        <span className="font-semibold text-ink-900">{formatQty(r.totalKg)} {t("কেজি")}</span>
                        {r.totalBags !== null && r.totalBags > 0 && (
                          <span className="block text-[11px] text-slate-500 print:text-[9px]">
                            {toBnDigits(r.totalBags.toFixed(1))} {t("বস্তা")}
                          </span>
                        )}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                        {formatMoney(r.avgRate, cur)} / {t("কেজি")}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap font-bold text-ink-900`}>
                        {formatMoney(r.totalAmount, cur)}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap text-emerald-800 font-semibold`}>
                        {formatMoney(r.totalCollected, cur)}
                      </td>
                      <td className={`${CELL} text-right tabular-nums whitespace-nowrap text-credit font-semibold`}>
                        {formatMoney(r.totalDue, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold print:bg-white border-t-2 border-t-slate-500">
                  <tr>
                    <td className={`${CELL} font-bold`}>{t("সর্বমোট বিক্রয়")}</td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                      <span className="font-bold text-ink-900">{formatQty(data.sectionC.totals.totalKg)} {t("কেজি")}</span>
                      {data.sectionC.totals.totalBags !== null && data.sectionC.totals.totalBags > 0 && (
                        <span className="block text-[11px] font-normal text-slate-600 print:text-[9px]">
                          {toBnDigits(data.sectionC.totals.totalBags.toFixed(1))} {t("বস্তা")}
                        </span>
                      )}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>
                      {formatMoney(data.sectionC.totals.avgRate, cur)} / {t("কেজি")}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap font-bold text-ink-900`}>
                      {formatMoney(data.sectionC.totals.totalAmount, cur)}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap text-emerald-800`}>
                      {formatMoney(data.sectionC.totals.totalCollected, cur)}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap text-credit`}>
                      {formatMoney(data.sectionC.totals.totalDue, cur)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Footer Note */}
        <p className="text-xs text-slate-500 print:text-[9px] print:mt-1">
          {t("* দ্রষ্টব্য: ফলনের হার = (মোট উৎপাদিত চাল (কেজি) × নির্ধারিত বস্তার কেজি ({0} কেজি)) ÷ মোট ভাঙানো ধান (কেজি)। প্রসেস লস আর্দ্রতা ও ধুলাবালির স্বাভাবিক ঘাটতি নির্দেশ করে।", { 0: toBnDigits(data.yieldBase) })}
        </p>

        {/* Print Signatures */}
        <div className="print-only mt-10 pt-4">
          <div className="grid grid-cols-3 gap-8 text-center text-xs">
            {["হিসাবরক্ষক", "উৎপাদন ব্যবস্থাপক", "মালিক / ব্যবস্থাপনা পরিচালক"].map((s) => (
              <div key={s} className="pt-2">
                <p className="border-t border-slate-700 pt-1 font-semibold">{t(s)}</p>
                <p className="text-[10px] text-slate-500">স্বাক্ষর ও সিল</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
