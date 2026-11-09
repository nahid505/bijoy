import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dayOrToday, dayRange, formatDate, formatQty, formatReportDateBangla, toBnDigits } from "@/lib/format";
import { AutoPrint, PrintButton } from "@/components/forms";
import { PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { REPORT_ACCESS } from "@/lib/permissions";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { reportOpenFor } from "@/server/reports/registry";
import { dailyMilling, type MillQty } from "@/server/services/rice-mill";

export const metadata: Metadata = { title: "ডেইলি ধান ভাঙানো হিসাব — প্রিন্ট" };

const CELL = "border border-black px-2 py-1.5 align-top font-semibold text-black print:px-1 print:py-1";

export default async function DailyMillingPrintPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(REPORT_ACCESS.dailyMilling);
  if (!reportOpenFor(ctx, "daily-milling")) redirect("/forbidden");
  const t = await getT();
  const p = await readParams(searchParams);
  const date = dayOrToday(p.date);
  const d = await dailyMilling(ctx.business.id, dayRange(date, date));
  const pct = (n: number) => `${toBnDigits(n.toFixed(2))}%`;
  const bags = (b: number | null) => (b === null ? "" : `${toBnDigits(Number.isInteger(b) ? String(b) : b.toFixed(2))} ${t("বস্তা")}`);
  const qty = (q: MillQty) => q.kg ? (
    <>
      <span className="block whitespace-nowrap font-medium">{formatQty(q.kg)} {t("কেজি")}</span>
      {q.bags ? <span className="block text-xs print:text-[10px] print:text-black">{bags(q.bags)}</span> : null}
    </>
  ) : <span className="text-slate-400">—</span>;
  const yieldList = (y: typeof d.yields) => (
    <ul className="space-y-0.5 text-xs print:text-[10px]">
      <li><span className="text-black">{t("চাল")}</span> <b className="tabular-nums">{pct(y.rice)}</b></li>
      <li><span className="text-black">{t("কুঁড়া")}</span> <span className="tabular-nums">{pct(y.bran)}</span></li>
      <li><span className="text-black">{t("খুদ")}</span> <span className="tabular-nums">{pct(y.broken)}</span></li>
      <li><span className="text-black">{t("তুষ")}</span> <span className="tabular-nums">{pct(y.husk)}</span></li>
      <li><span className="text-black">{t("প্রসেস লস")}</span> <span className="tabular-nums">{pct(y.loss)}</span></li>
    </ul>
  );
  const byProducts = d.totals.bran.kg + d.totals.broken.kg + d.totals.husk.kg;

  return (
    <>
      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <div className="mx-auto max-w-6xl py-4 font-sans text-black print:p-0 print:m-0 print:max-w-none">
        <AutoPrint />

        {/* নো-প্রিন্ট কন্ট্রোল বার */}
        <div className="no-print mb-4 flex items-center justify-between border-b pb-3 px-2">
          <div className="flex items-center gap-2">
            <PrintButton label="🖨 প্রিন্ট / PDF" />
            <Link prefetch={false} href={`/reports/daily-milling?date=${date}`} className="btn-secondary">
              ← রিপোর্টে ফিরুন
            </Link>
          </div>
          <p className="text-sm font-medium text-slate-600">তারিখ: {formatReportDateBangla(date)}</p>
        </div>

        <div className="print-area p-4 print:p-0">
          <PrintHeader business={ctx.business} title="ডেইলি ধান ভাঙানো হিসাব" subtitle={formatReportDateBangla(date)} />

          <div className="mb-3" id="milling-print-summary">
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              {[
                ["মোট ভাঙানো ধান", `${formatQty(d.totals.paddy.kg)} ${t("কেজি")} · ${toBnDigits(d.totals.paddy.mon.toFixed(2))} ${t("মণ")}`],
                ["মোট উৎপাদিত চাল", `${formatQty(d.totals.rice.kg)} ${t("কেজি")} · ${t("ফলন")} ${pct(d.yields.rice)}`],
                ["মোট উপজাত (কুঁড়া, খুদ, তুষ)", `${formatQty(byProducts)} ${t("কেজি")}`],
                ["মিলিং ব্যাচ", `${toBnDigits(d.rows.length)} · ${t("প্রসেস লস")} ${pct(d.yields.loss)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-black px-2 py-1 font-semibold text-black">
                  <p className="text-black">{t(label)}</p>
                  <p className="font-bold">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {d.rows.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500" id="milling-empty">{t("এই দিনে কোনো মিলিং ব্যাচ নেই")}</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[1000px] border-collapse border border-black text-sm print:min-w-0" id="milling-table">
                <thead className="bg-slate-100 text-xs font-bold text-black print:bg-slate-100">
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
                    <tr key={r.voucherId} className="print:break-inside-avoid">
                      <td className={`${CELL} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                      <td className={CELL}>
                        <span className="font-mono text-xs font-semibold text-black">{r.batchNo}</span>
                        <span className="block text-xs print:text-[10px] print:text-black">{formatDate(r.date)}</span>
                      </td>
                      <td className={`${CELL} break-words`} data-keep-lang>{r.paddyNames}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{r.paddy.bags === null ? "—" : bags(r.paddy.bags) || "—"}</td>
                      <td className={`${CELL} text-right tabular-nums`}>
                        <span className="block whitespace-nowrap font-medium">{formatQty(r.paddy.kg)} {t("কেজি")}</span>
                        <span className="block text-xs print:text-[10px] print:text-black">{toBnDigits(r.paddy.mon.toFixed(2))} {t("মণ")}</span>
                      </td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.rice)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.bran)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.broken)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{qty(r.husk)}</td>
                      <td className={CELL}>{yieldList(r.yields)}</td>
                      <td className={`${CELL} text-sm font-medium text-black print:text-[10px] print:text-black`} data-keep-lang>{r.enteredBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 font-bold total-row report-summary print:bg-white text-black" id="milling-totals">
                  <tr>
                    <td colSpan={3} className={`${CELL} border-t-2 border-t-black text-right`}>{t("সারাদিনের মোট ({0} টি ব্যাচ)", { 0: toBnDigits(d.rows.length) })}</td>
                    <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums`}>{d.totals.paddy.bags === null ? "—" : bags(d.totals.paddy.bags) || "—"}</td>
                    <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums`}>
                      <span className="block whitespace-nowrap">{formatQty(d.totals.paddy.kg)} {t("কেজি")}</span>
                      <span className="block text-xs font-normal text-slate-600 print:text-[10px] print:text-black">{toBnDigits(d.totals.paddy.mon.toFixed(2))} {t("মণ")}</span>
                    </td>
                    <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums`}>{qty(d.totals.rice)}</td>
                    <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums`}>{qty(d.totals.bran)}</td>
                    <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums`}>{qty(d.totals.broken)}</td>
                    <td className={`${CELL} border-t-2 border-t-black text-right tabular-nums`}>{qty(d.totals.husk)}</td>
                    <td className={`${CELL} border-t-2 border-t-black`}>{yieldList(d.yields)}</td>
                    <td className={`${CELL} border-t-2 border-t-black`} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500 print:text-[10px] print:text-black">{t("ফলন = উৎপাদিত পরিমাণ ÷ ভাঙানো ধান × ১০০; প্রসেস লস = ধান − সব উৎপাদন (ধুলা, আর্দ্রতা)। বস্তা: যে ইউনিটে এন্ট্রি হয়েছে, নইলে ব্যবসার বস্তা ইউনিট থেকে।")}</p>
          
          <div className="signature-section mt-12 print:break-inside-avoid">
            <div className="grid grid-cols-3 gap-8 text-center text-xs font-bold text-black">
              {["অপারেটর", "মিল ম্যানেজার", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-black pt-1">{t(s)}</p>)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
