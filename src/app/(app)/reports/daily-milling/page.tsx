import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, dayOrToday, dayRange, formatDate, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { FilterField, PageHeader, PrintHeader, StatCard } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { REPORT_ACCESS } from "@/lib/permissions";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { reportOpenFor } from "@/server/reports/registry";
import { dailyMilling, type MillQty } from "@/server/services/rice-mill";

export const metadata: Metadata = { title: "ডেইলি ধান ভাঙানো হিসাব" };

const CELL = "border border-slate-300 px-2 py-1.5 align-top print:border-slate-400 print:px-1 print:py-1";

/**
 * ডেইলি ধান ভাঙানো হিসাব: every milling batch (production entry: paddy in, rice and by-products out) of one day —
 * batch no. and date, paddy variety, bags and weight, the rice, কুঁড়া, খুদ and তুষ produced (kg / bags), the yield of
 * each against the paddy, and who entered it — with the day's totals. Print (A4 landscape), Excel and CSV.
 */
export default async function DailyMillingPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(REPORT_ACCESS.dailyMilling);
  if (!reportOpenFor(ctx, "daily-milling")) redirect("/forbidden");
  const t = await getT();
  const p = await readParams(searchParams);
  const date = dayOrToday(p.date);
  const d = await dailyMilling(ctx.business.id, dayRange(date, date));
  const exportHref = `/api/reports/daily-milling?date=${date}`;
  const pct = (n: number) => `${toBnDigits(n.toFixed(2))}%`;
  const bags = (b: number | null) => (b === null ? "" : `${toBnDigits(Number.isInteger(b) ? String(b) : b.toFixed(2))} ${t("বস্তা")}`);
  const qty = (q: MillQty) => q.kg ? (
    <>
      <span className="block whitespace-nowrap font-medium">{formatQty(q.kg)} {t("কেজি")}</span>
      {q.bags ? <span className="block text-xs text-slate-500 print:text-[9px]">{bags(q.bags)}</span> : null}
    </>
  ) : <span className="text-slate-400">—</span>;
  const yieldList = (y: typeof d.yields) => (
    <ul className="space-y-0.5 text-xs print:text-[9px]">
      <li><span className="text-slate-500">{t("চাল")}</span> <b className="tabular-nums">{pct(y.rice)}</b></li>
      <li><span className="text-slate-500">{t("কুঁড়া")}</span> <span className="tabular-nums">{pct(y.bran)}</span></li>
      <li><span className="text-slate-500">{t("খুদ")}</span> <span className="tabular-nums">{pct(y.broken)}</span></li>
      <li><span className="text-slate-500">{t("তুষ")}</span> <span className="tabular-nums">{pct(y.husk)}</span></li>
      <li><span className="text-slate-500">{t("প্রসেস লস")}</span> <span className="tabular-nums">{pct(y.loss)}</span></li>
    </ul>
  );
  const byProducts = d.totals.bran.kg + d.totals.broken.kg + d.totals.husk.kg;

  return (
    <>
      {/* landscape on paper: eleven columns */}
      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <div className="no-print">
        <PageHeader
          title="ডেইলি ধান ভাঙানো হিসাব"
          description="দিনের প্রতিটি মিলিং ব্যাচ — ধানের জাত, বস্তা ও পরিমাণ, উৎপাদিত চাল, কুঁড়া, খুদ ও তুষ, ফলন % ও অপারেটর"
          crumbs={[{ label: "অটো রাইস মিল ব্যবস্থাপনা" }, { label: "ডেইলি ধান ভাঙানো হিসাব" }]}
          actions={
            <>
              <PrintButton label="প্রিন্ট / PDF" />
              <a href={`${exportHref}&format=xlsx`} className="btn-secondary" id="milling-xlsx">⬇ Excel (XLSX)</a>
              <a href={exportHref} className="btn-secondary" id="milling-csv">⬇ CSV</a>
            </>
          }
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-4" id="milling-cards">
          <StatCard label="মোট ভাঙানো ধান" value={`${formatQty(d.totals.paddy.kg)} ${t("কেজি")}`} hint={`${toBnDigits(d.totals.paddy.mon.toFixed(2))} ${t("মণ")}${d.totals.paddy.bags ? ` · ${bags(d.totals.paddy.bags)}` : ""}`} />
          <StatCard label="মোট উৎপাদিত চাল" value={`${formatQty(d.totals.rice.kg)} ${t("কেজি")}`} hint={`${t("ফলন")} ${pct(d.yields.rice)}`} tone="green" />
          <StatCard label="মোট উপজাত (কুঁড়া, খুদ, তুষ)" value={`${formatQty(byProducts)} ${t("কেজি")}`} tone="blue" />
          <StatCard label="মিলিং ব্যাচ" value={toBnDigits(d.rows.length)} hint={`${t("প্রসেস লস")} ${pct(d.yields.loss)}`} />
        </div>
      </div>

      <section className="panel print-area">
        <form key={date} method="get" action="/reports/daily-milling" className="no-print flex flex-wrap items-end gap-2 border-b border-rule p-3">
          <FilterField label="তারিখ"><input type="date" id="date" name="date" defaultValue={date} className="input w-40" required /></FilterField>
          <button type="submit" className="btn-primary">{t("দেখুন")}</button>
          <span className="ml-auto flex gap-1">
            <Link prefetch={false} href={`/reports/daily-milling?date=${addDays(date, -1)}`} className="btn-ghost">← {t("আগের দিন")}</Link>
            <Link prefetch={false} href={`/reports/daily-milling?date=${addDays(date, 1)}`} className="btn-ghost">{t("পরের দিন")} →</Link>
          </span>
        </form>

        <div className="p-4 print:p-0">
          <PrintHeader business={ctx.business} title="ডেইলি ধান ভাঙানো হিসাব" subtitle={formatDate(date)} />
          {/* paper: the day's summary under the letterhead (the cards above are for the screen) */}
          <div className="print-only mb-3" id="milling-print-summary">
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              {[
                ["মোট ভাঙানো ধান", `${formatQty(d.totals.paddy.kg)} ${t("কেজি")} · ${toBnDigits(d.totals.paddy.mon.toFixed(2))} ${t("মণ")}`],
                ["মোট উৎপাদিত চাল", `${formatQty(d.totals.rice.kg)} ${t("কেজি")} · ${t("ফলন")} ${pct(d.yields.rice)}`],
                ["মোট উপজাত (কুঁড়া, খুদ, তুষ)", `${formatQty(byProducts)} ${t("কেজি")}`],
                ["মিলিং ব্যাচ", `${toBnDigits(d.rows.length)} · ${t("প্রসেস লস")} ${pct(d.yields.loss)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-slate-400 px-2 py-1">
                  <p className="text-slate-600">{t(label)}</p>
                  <p className="font-bold">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <h2 className="no-print mb-3 text-base font-semibold text-ink-900">{t("তারিখ:")} {formatDate(date)}</h2>
          {d.rows.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500" id="milling-empty">{t("এই দিনে কোনো মিলিং ব্যাচ নেই")}</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[1000px] border-collapse text-sm print:min-w-0 print:text-[10px]" id="milling-table">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-700 print:bg-white">
                  <tr>
                    <th rowSpan={2} className={`${CELL} w-10 text-center`}>{t("নং")}</th>
                    <th rowSpan={2} className={`${CELL} text-left`}>{t("মিলিং ব্যাচ নং ও তারিখ")}</th>
                    <th colSpan={3} className={`${CELL} bg-amber-50 text-center print:bg-white`}>{t("ভাঙানো ধান")}</th>
                    <th colSpan={4} className={`${CELL} bg-emerald-50 text-center print:bg-white`}>{t("উৎপাদিত পণ্য (Output)")}</th>
                    <th rowSpan={2} className={`${CELL} text-left`}>{t("উৎপাদন হার")}</th>
                    <th rowSpan={2} className={`${CELL} text-left`}>{t("অপারেটর / এন্ট্রিদাতা")}</th>
                  </tr>
                  <tr>
                    <th className={`${CELL} text-left`}>{t("ধানের জাত")}</th>
                    <th className={`${CELL} text-right`}>{t("বস্তা")}</th>
                    <th className={`${CELL} text-right`}>{t("পরিমাণ (কেজি / মণ)")}</th>
                    <th className={`${CELL} text-right`}>{t("মূল চাল")}</th>
                    <th className={`${CELL} text-right`}>{t("কুঁড়া / ব্র্যান")}</th>
                    <th className={`${CELL} text-right`}>{t("খুদ / ভাঙা চাল")}</th>
                    <th className={`${CELL} text-right`}>{t("তুষ / ভূসি")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <tr key={r.voucherId} className="hover:bg-slate-50 print:break-inside-avoid">
                      <td className={`${CELL} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                      <td className={CELL}>
                        <Link prefetch={false} href={`/production/${r.voucherId}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline print:text-black">{r.batchNo}</Link>
                        <span className="block text-xs text-slate-500 print:text-[9px]">{formatDate(r.date)}</span>
                      </td>
                      <td className={`${CELL} break-words`} data-keep-lang>{r.paddyNames}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{r.paddy.bags === null ? "—" : bags(r.paddy.bags) || "—"}</td>
                      <td className={`${CELL} text-right tabular-nums`}>
                        <span className="block whitespace-nowrap font-medium">{formatQty(r.paddy.kg)} {t("কেজি")}</span>
                        <span className="block text-xs text-slate-500 print:text-[9px]">{toBnDigits(r.paddy.mon.toFixed(2))} {t("মণ")}</span>
                      </td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.rice)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.bran)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.broken)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.husk)}</td>
                      <td className={CELL}>{yieldList(r.yields)}</td>
                      <td className={`${CELL} text-sm font-medium text-emerald-700 print:text-[10px] print:text-black`} data-keep-lang>{r.enteredBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold print:bg-white" id="milling-totals">
                  <tr>
                    <td colSpan={3} className={`${CELL} border-t-2 border-t-slate-500 text-right`}>{t("সারাদিনের মোট ({0} টি ব্যাচ)", { 0: toBnDigits(d.rows.length) })}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500 text-right tabular-nums`}>{d.totals.paddy.bags === null ? "—" : bags(d.totals.paddy.bags) || "—"}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500 text-right tabular-nums`}>
                      <span className="block whitespace-nowrap">{formatQty(d.totals.paddy.kg)} {t("কেজি")}</span>
                      <span className="block text-xs font-normal text-slate-500 print:text-[9px]">{toBnDigits(d.totals.paddy.mon.toFixed(2))} {t("মণ")}</span>
                    </td>
                    <td className={`${CELL} border-t-2 border-t-slate-500 text-right tabular-nums`}>{qty(d.totals.rice)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500 text-right tabular-nums`}>{qty(d.totals.bran)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500 text-right tabular-nums`}>{qty(d.totals.broken)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500 text-right tabular-nums`}>{qty(d.totals.husk)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500`}>{yieldList(d.yields)}</td>
                    <td className={`${CELL} border-t-2 border-t-slate-500`} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500 print:text-[9px]">{t("ফলন = উৎপাদিত পরিমাণ ÷ ভাঙানো ধান × ১০০; প্রসেস লস = ধান − সব উৎপাদন (ধুলা, আর্দ্রতা)। বস্তা: যে ইউনিটে এন্ট্রি হয়েছে, নইলে ব্যবসার বস্তা ইউনিট থেকে।")}</p>
          <div className="print-only mt-12">
            <div className="grid grid-cols-3 gap-8 text-center text-xs">
              {["অপারেটর", "মিল ম্যানেজার", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-ink-800 pt-1">{t(s)}</p>)}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
