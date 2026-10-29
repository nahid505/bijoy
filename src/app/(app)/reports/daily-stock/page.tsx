import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, formatDate, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { FilterField } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { REPORT_ACCESS } from "@/lib/permissions";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { reportOpenFor } from "@/server/reports/registry";
import { dailyStock, type UnitTotals } from "@/server/reports/daily-stock";

export const metadata: Metadata = { title: "দৈনিক স্টক রিপোর্ট" };

const CELL = "border border-slate-300 px-2 py-1.5 print:border-slate-500 print:px-1.5 print:py-1";

/**
 * দৈনিক স্টক রিপোর্ট: per product for one day (and warehouse) — পূর্বের মজুদ, উৎপাদন / ক্রয়, বিক্রয় / ব্যবহার,
 * আজকের মজুদ = পূর্বের + উৎপাদন / ক্রয় − বিক্রয় / ব্যবহার — with column totals (per unit). The heading (company |
 * title | date) is the same on screen and on paper; print fits one ruled A4 page.
 */
export default async function DailyStockPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(REPORT_ACCESS.dailyStock);
  if (!reportOpenFor(ctx, "daily-stock")) redirect("/forbidden");
  const t = await getT();
  const p = await readParams(searchParams);
  const d = await dailyStock(ctx.business.id, { date: p.date, warehouseId: p.warehouseId });
  const wh = d.warehouse ? `&warehouseId=${encodeURIComponent(d.warehouse.id)}` : "";
  const exportHref = `/api/reports/daily-stock?date=${d.date}${wh}`;
  const q = (date: string) => `/reports/daily-stock?date=${date}${wh}`;
  const qty = (n: number, unit: string) => (n ? `${formatQty(n)} ${unit}` : <span className="text-slate-400">—</span>);
  const total = (tt: UnitTotals) => {
    const parts = Object.entries(tt);
    return parts.length ? parts.map(([u, n]) => <span key={u} className="block whitespace-nowrap">{formatQty(n)} {u}</span>) : "—";
  };
  const b = ctx.business;

  return (
    <>
      <section className="panel print-area daily-stock" id="daily-stock">
        {/* toolbar: filters and the buttons (not printed) */}
        <form key={`${d.date}|${d.warehouse?.id ?? ""}`} method="get" action="/reports/daily-stock" className="no-print flex flex-wrap items-end gap-2 border-b border-rule p-3">
          <FilterField label="তারিখ"><input type="date" id="date" name="date" defaultValue={d.date} className="input w-40" required /></FilterField>
          <FilterField label="গুদাম">
            <select id="warehouseId" name="warehouseId" defaultValue={d.warehouse?.id ?? ""} className="input w-48">
              <option value="">{t("সব গুদাম")}</option>
              {d.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </FilterField>
          <button type="submit" className="btn-primary">{t("দেখুন")}</button>
          <span className="flex gap-1">
            <Link prefetch={false} href={q(addDays(d.date, -1))} className="btn-ghost">← {t("আগের দিন")}</Link>
            <Link prefetch={false} href={q(addDays(d.date, 1))} className="btn-ghost">{t("পরের দিন")} →</Link>
          </span>
          <span className="ml-auto flex gap-2">
            <PrintButton label="প্রিন্ট / PDF" />
            <a href={`${exportHref}&format=xlsx`} className="btn-secondary" id="daily-stock-xlsx">⬇ Excel</a>
            <a href={exportHref} className="btn-secondary" id="daily-stock-csv">⬇ CSV</a>
          </span>
        </form>

        <div className="p-4 print:p-0">
          {/* heading: company | title | date — on screen and on paper */}
          <header className="mb-3 grid grid-cols-3 items-end gap-3 border-b-2 border-ink-800 pb-2" id="daily-stock-head">
            <div className="text-left">
              <p className="text-base font-bold text-ink-900 print:text-sm" data-keep-lang>{b.name}</p>
              {(b.address || b.mobile) && <p className="text-xs text-slate-500 print:text-[9px]" data-keep-lang>{[b.address, b.mobile].filter(Boolean).join(" · ")}</p>}
            </div>
            <div className="text-center">
              <h1 className="text-lg font-bold text-ink-900 print:text-base">{t("দৈনিক স্টক রিপোর্ট")}</h1>
              <p className="text-xs text-slate-500 print:text-[9px]">{d.warehouse ? t("গুদাম: {0}", { 0: d.warehouse.name }) : t("সব গুদাম")}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 print:text-[9px]">{t("তারিখ")}</p>
              <p className="text-base font-semibold text-ink-900 print:text-sm" id="daily-stock-date">{formatDate(d.date)}</p>
            </div>
          </header>

          {d.rows.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500" id="daily-stock-empty">{t("এই দিনে কোনো মজুদ বা লেনদেন নেই")}</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-sm print:text-[10px]" id="daily-stock-table">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-700 print:bg-white">
                  <tr>
                    <th className={`${CELL} w-12 text-center`}>{t("নং")}</th>
                    <th className={`${CELL} text-left`}>{t("পণ্যের নাম")}</th>
                    <th className={`${CELL} w-36 text-right`}>{t("পূর্বের মজুদ")}</th>
                    <th className={`${CELL} w-36 text-right`}>{t("উৎপাদন / ক্রয়")}</th>
                    <th className={`${CELL} w-36 text-right`}>{t("বিক্রয় / ব্যবহার")}</th>
                    <th className={`${CELL} w-36 text-right`}>{t("আজকের মজুদ")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-slate-50 print:break-inside-avoid">
                      <td className={`${CELL} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                      <td className={CELL}>
                        <Link prefetch={false} href={`/products/${r.id}`} className="text-ink-900 hover:underline print:no-underline">{r.name}</Link>
                        {r.code && <span className="ml-1 text-xs text-slate-400 print:text-[9px]">({r.code})</span>}
                      </td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.opening, r.unit)}</td>
                      <td className={`${CELL} text-right tabular-nums text-emerald-700 print:text-black`}>{qty(r.in, r.unit)}</td>
                      <td className={`${CELL} text-right tabular-nums text-red-700 print:text-black`}>{qty(r.out, r.unit)}</td>
                      <td className={`${CELL} text-right font-semibold tabular-nums ${r.closing < 0 ? "text-credit" : ""}`}>{formatQty(r.closing)} {r.unit}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold print:bg-white" id="daily-stock-totals">
                  <tr>
                    <td colSpan={2} className={`${CELL} border-t-2 border-t-slate-600 text-right`}>{t("মোট ({0} টি পণ্য)", { 0: toBnDigits(d.rows.length) })}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-600 text-right tabular-nums`}>{total(d.totals.opening)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-600 text-right tabular-nums`}>{total(d.totals.in)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-600 text-right tabular-nums`}>{total(d.totals.out)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-600 text-right tabular-nums`}>{total(d.totals.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500 print:text-[9px]">{t("আজকের মজুদ = পূর্বের মজুদ + উৎপাদন / ক্রয় − বিক্রয় / ব্যবহার। ভিন্ন ইউনিটের পরিমাণ যোগ না করে ইউনিট অনুযায়ী মোট দেখানো হয়েছে।")}</p>
          <div className="print-only mt-12">
            <div className="grid grid-cols-3 gap-8 text-center text-xs">
              {["স্টোর কিপার", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-ink-800 pt-1">{t(s)}</p>)}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
