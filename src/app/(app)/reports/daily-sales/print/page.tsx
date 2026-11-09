import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { featureForPath } from "@/lib/features";
import { formatMoney, formatQty, formatReportDateBangla, toBnDigits } from "@/lib/format";
import { AmountInWords } from "@/components/amount-words";
import { AutoPrint, PrintButton } from "@/components/forms";
import { PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { dailySales, quantityText } from "@/server/reports/daily-sales";
import { voucherScopeWhere } from "@/server/party-scope";

export const metadata: Metadata = { title: "ডেইলি বিক্রয় রিপোর্ট — প্রিন্ট" };

// ruled khata cells — crisp black borders and bold text for printing
const th = "border border-black px-2 py-1.5 font-bold text-black bg-slate-100 print:bg-slate-100";
const td = "border border-black px-2 py-1.5 font-semibold text-black";
const num = `${td} whitespace-nowrap text-right tabular-nums`;

export default async function DailySalesPrintPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("sales:view");
  const gate = featureForPath("/reports/daily-sales");
  if (gate && !ctx.features.includes(gate)) redirect(`/forbidden?feature=${gate}`);
  const p = await readParams(searchParams);
  const d = await dailySales(ctx.business.id, { date: p.date, scope: voucherScopeWhere(ctx) });
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);

  return (
    <div className="mx-auto max-w-5xl py-4 font-sans text-black print:p-0 print:m-0 print:max-w-none">
      <AutoPrint />
      
      {/* নো-প্রিন্ট কন্ট্রোল বার */}
      <div className="no-print mb-4 flex items-center justify-between border-b pb-3 px-2">
        <div className="flex items-center gap-2">
          <PrintButton label="🖨 প্রিন্ট / PDF" />
          <Link prefetch={false} href={`/reports/daily-sales?date=${d.date}`} className="btn-secondary">
            ← রিপোর্টে ফিরুন
          </Link>
        </div>
        <p className="text-sm font-medium text-slate-600">তারিখ: {formatReportDateBangla(d.date)}</p>
      </div>

      <div className="print-area space-y-4 p-4 print:p-0">
        <PrintHeader business={ctx.business} title="ডেইলি বিক্রয় রিপোর্ট" subtitle={formatReportDateBangla(d.date)} />

        <div className="overflow-x-auto print:overflow-visible">
          <table id="sales-table" className="w-full min-w-[46rem] border-collapse border border-black text-sm print:min-w-0">
            <thead className="bg-slate-100 print:bg-slate-100">
              <tr>
                <th scope="col" className={`${th} w-12 text-center`}>নম্বর</th>
                <th scope="col" className={`${th} text-left`}>পার্টির নাম</th>
                <th scope="col" className={`${th} text-left`}>পণ্যের নাম</th>
                <th scope="col" className={`${th} text-right`}>পরিমাণ</th>
                <th scope="col" className={`${th} text-right`}>দর</th>
                <th scope="col" className={`${th} text-right`}>টাকা</th>
                <th scope="col" className={`${th} text-left`}>নোট</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.length === 0 && <tr><td colSpan={7} className={`${td} py-3 text-center text-xs text-slate-500`}>এই দিনে কোনো বিক্রয় নেই</td></tr>}
              {d.lines.map((l, i) => (
                <tr key={`${l.voucherId}-${i}`} className="align-top">
                  <td className={`${td} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                  <td className={td}>
                    <span className="block font-medium">{l.party}</span>
                  </td>
                  <td className={td}>{l.product}</td>
                  <td className={num}>{formatQty(l.quantity)} {l.unit}</td>
                  <td className={num}>{money(l.rate)}</td>
                  <td className={num}>{money(l.amount)}{l.discount > 0 && <span className="block text-[10px] text-slate-500">ছাড় {money(l.discount)}</span>}</td>
                  <td className={`${td} text-xs`}>{l.note || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold total-row" id="sales-totals">
                <td colSpan={3} className={`${td} text-right`}>মোট পরিমাণ ও সর্বমোট বিক্রয় টাকা</td>
                <td className={`${td} text-right tabular-nums`}>{quantityText(d.quantityByUnit)}</td>
                <td className={td} />
                <td className={num}>{money(d.total)}</td>
                <td className={td} />
              </tr>
              {d.discount > 0 && <tr><td colSpan={5} className={`${td} text-right`}>(−) ভাউচারের ছাড়</td><td className={num}>{money(d.discount)}</td><td className={td} /></tr>}
              {d.vat > 0 && <tr><td colSpan={5} className={`${td} text-right`}>(+) ভ্যাট</td><td className={num}>{money(d.vat)}</td><td className={td} /></tr>}
              {(d.discount > 0 || d.vat > 0) && <tr className="font-semibold total-row"><td colSpan={5} className={`${td} text-right`}>নিট বিক্রয়</td><td className={num}>{money(d.net)}</td><td className={td} /></tr>}
            </tfoot>
          </table>
        </div>

        <div className="report-summary grid gap-2 rounded-lg border border-black bg-white p-3 text-sm sm:grid-cols-3 print:break-inside-avoid print:grid-cols-3 print:bg-white print:border-black print:text-black">
          <p>সর্বমোট বিক্রয়: <b id="net-total" className="tabular-nums font-bold text-black">{money(d.net)}</b></p>
          <p>নগদ আদায়: <b className="tabular-nums font-bold text-black">{money(d.collected)}</b></p>
          <p>বাকি: <b className="tabular-nums font-bold text-black">{money(d.due)}</b></p>
          <p className="sm:col-span-3 print:col-span-3"><b>কথায়:</b> <AmountInWords amount={d.net} /></p>
        </div>

        <div className="signature-section pt-10 print:break-inside-avoid">
          <div className="grid grid-cols-3 gap-8 text-center text-xs font-bold text-black">
            {["প্রস্তুতকারী", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-black pt-1">{s}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}
