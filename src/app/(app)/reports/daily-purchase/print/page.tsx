import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { featureForPath } from "@/lib/features";
import { formatMoney, formatQty, formatReportDateBangla, toBnDigits } from "@/lib/format";
import { AutoPrint, PrintButton } from "@/components/forms";
import { PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { dailyPurchase } from "@/server/reports/daily-purchase";
import { voucherScopeWhere } from "@/server/party-scope";

export const metadata: Metadata = { title: "ডেইলি ক্রয় রিপোর্ট — প্রিন্ট" };

// ruled khata cells — crisp black borders and bold text for printing
const th = "border border-black px-1.5 py-1 font-bold text-black bg-slate-100 print:bg-slate-100";
const td = "border border-black px-1.5 py-1 font-semibold text-black";
const num = `${td} whitespace-nowrap text-right tabular-nums`;

export default async function DailyPurchasePrintPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("purchases:view");
  const gate = featureForPath("/reports/daily-purchase");
  if (gate && !ctx.features.includes(gate)) redirect(`/forbidden?feature=${gate}`);
  const p = await readParams(searchParams);
  const d = await dailyPurchase(ctx.business.id, { date: p.date, scope: voucherScopeWhere(ctx) });
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const t = d.paddyTotals;

  return (
    <div className="mx-auto max-w-5xl py-4 font-sans text-black print:p-0 print:m-0 print:max-w-none">
      <AutoPrint />

      {/* নো-প্রিন্ট কন্ট্রোল বার */}
      <div className="no-print mb-4 flex items-center justify-between border-b pb-3 px-2">
        <div className="flex items-center gap-2">
          <PrintButton label="🖨 প্রিন্ট / PDF" />
          <Link prefetch={false} href={`/reports/daily-purchase?date=${d.date}`} className="btn-secondary">
            ← রিপোর্টে ফিরুন
          </Link>
        </div>
        <p className="text-sm font-medium text-slate-600">তারিখ: {formatReportDateBangla(d.date)}</p>
      </div>

      <div className="print-area space-y-6 p-4 print:p-0 print:space-y-4">
        <PrintHeader business={ctx.business} title="ডেইলি ক্রয় রিপোর্ট" subtitle={formatReportDateBangla(d.date)} />

        {/* ১. অন্যান্য ক্রয় */}
        <section aria-labelledby="sec-other" className="print:break-inside-avoid">
          <h3 id="sec-other" className="mb-1.5 text-sm font-bold text-black">১. ডেইলি ক্রয় রিপোর্ট (অন্যান্য ক্রয়)</h3>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[46rem] border-collapse border border-black text-sm print:min-w-0">
              <thead className="bg-slate-100 print:bg-slate-100">
                <tr>
                  <th scope="col" className={`${th} w-12 text-center`}>নম্বর</th>
                  <th scope="col" className={`${th} text-left`}>পার্টির নাম</th>
                  <th scope="col" className={`${th} text-left`}>পণ্যের নাম</th>
                  <th scope="col" className={`${th} text-right`}>পরিমাণ</th>
                  <th scope="col" className={`${th} text-right`}>দর</th>
                  <th scope="col" className={`${th} text-right`}>মোট টাকা</th>
                  <th scope="col" className={`${th} text-left`}>নোট</th>
                </tr>
              </thead>
              <tbody>
                {d.other.length === 0 && <tr><td colSpan={7} className={`${td} py-3 text-center text-xs text-slate-500`}>এই দিনে অন্য কোনো ক্রয় নেই</td></tr>}
                {d.other.map((l, i) => (
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
              <tfoot className="total-row report-summary">
                <tr className="font-bold">
                  <td colSpan={5} className={`${td} text-right`}>মোট টাকা</td>
                  <td className={num} id="other-total">{money(d.otherTotal)}</td>
                  <td className={td} />
                </tr>
                {(d.otherDiscount > 0 || d.otherVat > 0) && (
                  <>
                    {d.otherDiscount > 0 && <tr><td colSpan={5} className={`${td} text-right`}>(−) ভাউচারের ছাড়</td><td className={num}>{money(d.otherDiscount)}</td><td className={td} /></tr>}
                    {d.otherVat > 0 && <tr><td colSpan={5} className={`${td} text-right`}>(+) ভ্যাট</td><td className={num}>{money(d.otherVat)}</td><td className={td} /></tr>}
                    <tr className="font-semibold total-row"><td colSpan={5} className={`${td} text-right`}>নিট ক্রয়</td><td className={num}>{money(d.otherNet)}</td><td className={td} /></tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>
        </section>

        {/* ২. ধান ক্রয় */}
        <section aria-labelledby="sec-paddy" className="print:break-inside-avoid">
          <h3 id="sec-paddy" className="mb-1.5 text-sm font-bold text-black">২. ধান ক্রয় রিপোর্ট</h3>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[54rem] border-collapse border border-black text-sm print:min-w-0">
              <thead className="bg-slate-100 print:bg-slate-100">
                <tr>
                  <th scope="col" className={`${th} w-12 text-center`}>নম্বর</th>
                  <th scope="col" className={`${th} text-left`}>পার্টির নাম</th>
                  <th scope="col" className={`${th} text-left`}>পণ্যের নাম</th>
                  <th scope="col" className={`${th} text-right`}>বস্তার সংখ্যা</th>
                  <th scope="col" className={`${th} text-right`}>মোট স্কেল (কেজি)</th>
                  <th scope="col" className={`${th} text-right`}>ঢলতা (কেজি)</th>
                  <th scope="col" className={`${th} text-right`}>নীট স্কেল (কেজি)</th>
                  <th scope="col" className={`${th} text-right`}>মণ</th>
                  <th scope="col" className={`${th} text-right`}>দর (প্রতি মণ)</th>
                  <th scope="col" className={`${th} text-right`}>মোট টাকা</th>
                </tr>
              </thead>
              <tbody>
                {d.paddy.length === 0 && <tr><td colSpan={10} className={`${td} py-3 text-center text-xs text-slate-500`}>এই দিনে কোনো ধান ক্রয় নেই</td></tr>}
                {d.paddy.map((l, i) => (
                  <tr key={l.voucherId} className="align-top">
                    <td className={`${td} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                    <td className={td}>
                      <span className="block font-medium">{l.party}</span>
                    </td>
                    <td className={td}>{l.product}</td>
                    <td className={num}>{toBnDigits(l.bagCount)}</td>
                    <td className={num}>{formatQty(l.grossKg)}</td>
                    <td className={num}>{formatQty(l.dhaltaKg)}</td>
                    <td className={num}>{formatQty(l.netKg)}</td>
                    <td className={num}>{toBnDigits(l.mon.toFixed(2))}</td>
                    <td className={num}>{money(l.ratePerMon)}</td>
                    <td className={num}>{money(l.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="total-row report-summary">
                <tr className="font-bold" id="paddy-totals">
                  <td colSpan={3} className={`${td} text-right`}>মোট</td>
                  <td className={num}>{toBnDigits(t.bags)}</td>
                  <td className={num}>{formatQty(t.grossKg)}</td>
                  <td className={num}>{formatQty(t.dhaltaKg)}</td>
                  <td className={num}>{formatQty(t.netKg)}</td>
                  <td className={num}>{toBnDigits(t.mon.toFixed(2))}</td>
                  <td className={td} />
                  <td className={num}>{money(t.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 print:text-[10px] print:text-black">
            মোট বস্তা <b>{toBnDigits(t.bags)}</b> · মোট নীট ওজন <b>{formatQty(t.netKg)} কেজি</b> · মোট মণ <b>{toBnDigits(t.mon.toFixed(2))}</b> · সর্বমোট টাকা <b>{money(t.total)}</b>
          </p>
        </section>

        <div className="signature-section pt-10 print:break-inside-avoid">
          <div className="grid grid-cols-3 gap-8 text-center text-xs font-bold text-black">
            {["প্রস্তুতকারী", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-black pt-1">{s}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}
