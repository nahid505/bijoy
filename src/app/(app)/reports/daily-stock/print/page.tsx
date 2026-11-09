import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatQty, formatReportDateBangla, toBnDigits } from "@/lib/format";
import { AutoPrint, PrintButton } from "@/components/forms";
import { requirePermission } from "@/server/auth";
import { REPORT_ACCESS } from "@/lib/permissions";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { reportOpenFor } from "@/server/reports/registry";
import { dailyStock, type UnitTotals } from "@/server/reports/daily-stock";

export const metadata: Metadata = { title: "দৈনিক স্টক রিপোর্ট — প্রিন্ট" };

const CELL = "border border-black px-2 py-1.5 font-semibold text-black print:px-1.5 print:py-1";

export default async function DailyStockPrintPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(REPORT_ACCESS.dailyStock);
  if (!reportOpenFor(ctx, "daily-stock")) redirect("/forbidden");
  const t = await getT();
  const p = await readParams(searchParams);
  const d = await dailyStock(ctx.business.id, { date: p.date, warehouseId: p.warehouseId });
  const b = ctx.business;
  const wh = d.warehouse ? `&warehouseId=${encodeURIComponent(d.warehouse.id)}` : "";

  const qty = (n: number, unit: string) => (n ? `${formatQty(n)} ${unit}` : <span className="text-slate-400">—</span>);
  const total = (tt: UnitTotals) => {
    const parts = Object.entries(tt);
    return parts.length ? parts.map(([u, n]) => <span key={u} className="block whitespace-nowrap">{formatQty(n)} {u}</span>) : "—";
  };

  return (
    <div className="mx-auto max-w-5xl py-4 font-sans text-black print:p-0 print:m-0 print:max-w-none">
      <AutoPrint />

      {/* নো-প্রিন্ট কন্ট্রোল বার */}
      <div className="no-print mb-4 flex items-center justify-between border-b pb-3 px-2">
        <div className="flex items-center gap-2">
          <PrintButton label="🖨 প্রিন্ট / PDF" />
          <Link prefetch={false} href={`/reports/daily-stock?date=${d.date}${wh}`} className="btn-secondary">
            ← রিপোর্টে ফিরুন
          </Link>
        </div>
        <p className="text-sm font-medium text-slate-600">তারিখ: {formatReportDateBangla(d.date)}</p>
      </div>

      <div className="print-area p-4 print:p-0">
        <header className="report-header mb-3 grid grid-cols-3 items-end gap-3 border-b-2 border-black pb-2 text-black" id="daily-stock-head">
          <div className="text-left">
            <h1 className="text-base font-extrabold text-black" data-keep-lang>{b.name}</h1>
            {(b.address || b.mobile) && <p className="text-xs font-semibold text-black" data-keep-lang>{[b.address, b.mobile].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-extrabold text-black">{t("দৈনিক স্টক রিপোর্ট")}</h2>
            <p className="text-xs font-semibold text-black">{d.warehouse ? t("গুদাম: {0}", { 0: d.warehouse.name }) : t("সব গুদাম")}</p>
          </div>
          <div className="text-right">
            <p className="report-date text-base font-bold text-black" id="daily-stock-date">{formatReportDateBangla(d.date)}</p>
          </div>
        </header>

        {d.rows.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500" id="daily-stock-empty">{t("এই দিনে কোনো মজুদ বা লেনদেন নেই")}</p>
        ) : (
          <div className="overflow-x-auto relative print:overflow-visible">
            <table className="w-full border-collapse border border-black text-sm" id="daily-stock-table">
              <thead className="bg-slate-100 text-xs font-bold text-black print:bg-slate-100">
                <tr>
                  <th className={`${CELL} w-10 text-center`}>{t("নং")}</th>
                  <th className={`${CELL} text-left`}>{t("পণ্যের নাম")}</th>
                  <th className={`${CELL} w-36 text-right`}>{t("পূর্বের মজুদ")}</th>
                  <th className={`${CELL} w-36 text-right`}>{t("উৎপাদন / ক্রয়")}</th>
                  <th className={`${CELL} w-36 text-right`}>{t("বিক্রয় / ব্যবহার")}</th>
                  <th className={`${CELL} w-36 text-right`}>{t("আজকের মজুদ")}</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={r.id} className="print:break-inside-avoid">
                    <td className={`${CELL} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                    <td className={CELL}>
                      <span className="font-semibold text-black">{r.name}</span>
                      {r.code && <span className="ml-1 text-xs text-slate-600 print:text-[9px] print:text-black">({r.code})</span>}
                    </td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{qty(r.opening, r.unit)}</td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap print:text-black`}>{qty(r.in, r.unit)}</td>
                    <td className={`${CELL} text-right tabular-nums whitespace-nowrap print:text-black`}>{qty(r.out, r.unit)}</td>
                    <td className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap print:text-black`}>{formatQty(r.closing)} {r.unit}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-bold total-row report-summary print:bg-white text-black" id="daily-stock-totals">
                <tr>
                  <td className={`${CELL} border-r-0 border-t-2 border-t-black`} />
                  <td className={`${CELL} border-l-0 border-t-2 border-t-black text-right text-black font-bold`}>
                    {t("মোট ({0} টি পণ্য)", { 0: toBnDigits(d.rows.length) })}
                  </td>
                  <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums whitespace-nowrap text-black font-bold`}>{total(d.totals.opening)}</td>
                  <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums whitespace-nowrap text-black font-bold`}>{total(d.totals.in)}</td>
                  <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums whitespace-nowrap text-black font-bold`}>{total(d.totals.out)}</td>
                  <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums whitespace-nowrap text-black font-bold`}>{total(d.totals.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-600 print:text-[10px] print:text-black">{t("আজকের মজুদ = পূর্বের মজুদ + উৎপাদন / ক্রয় − বিক্রয় / ব্যবহার। ভিন্ন ইউনিটের পরিমাণ যোগ না করে ইউনিট অনুযায়ী মোট দেখানো হয়েছে।")}</p>
        
        <div className="signature-section mt-12 print:break-inside-avoid">
          <div className="grid grid-cols-3 gap-8 text-center text-xs font-bold text-black">
            {["স্টোর কিপার", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-black pt-1">{t(s)}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}
