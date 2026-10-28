import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { featureForPath } from "@/lib/features";
import { addDays, formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { AmountInWords } from "@/components/amount-words";
import { PrintButton } from "@/components/forms";
import { FilterField, PageHeader, PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { dailyPurchase } from "@/server/reports/daily-purchase";
import { voucherScopeWhere } from "@/server/party-scope";

export const metadata: Metadata = { title: "ডেইলি ক্রয় রিপোর্ট" };

// ruled khata cells
const th = "border border-ink-800 px-1.5 py-1 font-semibold";
const td = "border border-ink-800 px-1.5 py-1";
const num = `${td} whitespace-nowrap text-right tabular-nums`; // figures never wrap (৳ stays with the amount)

export default async function DailyPurchasePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("purchases:view");
  const gate = featureForPath("/reports/daily-purchase");
  if (gate && !ctx.features.includes(gate)) redirect(`/forbidden?feature=${gate}`);
  const p = await readParams(searchParams);
  const d = await dailyPurchase(ctx.business.id, { date: p.date, scope: voucherScopeWhere(ctx) });
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const exportHref = `/api/reports/daily-purchase?date=${d.date}`;
  const t = d.paddyTotals;

  return (
    <>
      {/* the printed sheet has its own header (PrintHeader) */}
      <div className="no-print">
        <PageHeader
          title="ডেইলি ক্রয় রিপোর্ট"
          description="নির্দিষ্ট দিনের অন্যান্য ক্রয় ও ধান ক্রয় — খাতার মতো দুই সেকশনে"
          crumbs={[{ label: "রিপোর্ট", href: "/reports" }, { label: "ডেইলি ক্রয় রিপোর্ট" }]}
          actions={
            <>
              <PrintButton label="প্রিন্ট / PDF" />
              <a href={`${exportHref}&format=xlsx`} className="btn-secondary">⬇ Excel (XLSX)</a>
              <a href={exportHref} className="btn-secondary">⬇ CSV</a>
            </>
          }
        />
      </div>
      <section className="panel print-area">
        <form key={d.date} method="get" action="/reports/daily-purchase" className="no-print flex flex-wrap items-end gap-2 border-b border-rule p-3">
          <FilterField label="তারিখ">
            <input type="date" id="date" name="date" defaultValue={d.date} className="input w-40" required />
          </FilterField>
          <button type="submit" className="btn-primary">দেখুন</button>
          <span className="ml-auto flex gap-1">
            <Link prefetch={false} href={`/reports/daily-purchase?date=${addDays(d.date, -1)}`} className="btn-ghost">← আগের দিন</Link>
            <Link prefetch={false} href={`/reports/daily-purchase?date=${addDays(d.date, 1)}`} className="btn-ghost">পরের দিন →</Link>
          </span>
        </form>

        <div className="space-y-6 p-4 print:space-y-5">
          <PrintHeader business={ctx.business} title="ডেইলি ক্রয় রিপোর্ট" subtitle={formatDate(d.date)} />
          <h2 className="no-print text-base font-semibold text-ink-900">তারিখ: {formatDate(d.date)}</h2>

          {/* ১. অন্যান্য ক্রয় */}
          <section aria-labelledby="sec-other" className="print:break-inside-avoid">
            <h3 id="sec-other" className="mb-1.5 text-sm font-bold text-ink-900">১. ডেইলি ক্রয় রিপোর্ট (অন্যান্য ক্রয়)</h3>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[46rem] border-collapse border border-ink-800 text-sm print:min-w-0 print:text-[10px]">
                <thead className="bg-ink-50 print:bg-white">
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
                        <span className="block">{l.party}</span>
                        <Link prefetch={false} href={`/vouchers/v/${l.voucherId}`} className="block text-xs text-brand-700 hover:underline print:text-[9px] print:text-black print:no-underline">{l.voucherNo}</Link>
                      </td>
                      <td className={td}>{l.product}</td>
                      <td className={num}>{formatQty(l.quantity)} {l.unit}</td>
                      <td className={num}>{money(l.rate)}</td>
                      <td className={num}>{money(l.amount)}{l.discount > 0 && <span className="block text-[10px] text-slate-500">ছাড় {money(l.discount)}</span>}</td>
                      <td className={`${td} text-xs print:text-[9px]`}>{l.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={5} className={`${td} text-right`}>মোট টাকা</td>
                    <td className={num} id="other-total">{money(d.otherTotal)}</td>
                    <td className={td} />
                  </tr>
                  {(d.otherDiscount > 0 || d.otherVat > 0) && (
                    <>
                      {d.otherDiscount > 0 && <tr><td colSpan={5} className={`${td} text-right`}>(−) ভাউচারের ছাড়</td><td className={num}>{money(d.otherDiscount)}</td><td className={td} /></tr>}
                      {d.otherVat > 0 && <tr><td colSpan={5} className={`${td} text-right`}>(+) ভ্যাট</td><td className={num}>{money(d.otherVat)}</td><td className={td} /></tr>}
                      <tr className="font-semibold"><td colSpan={5} className={`${td} text-right`}>নিট ক্রয়</td><td className={num}>{money(d.otherNet)}</td><td className={td} /></tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>
          </section>

          {/* ২. ধান ক্রয় */}
          <section aria-labelledby="sec-paddy" className="print:break-inside-avoid">
            <h3 id="sec-paddy" className="mb-1.5 text-sm font-bold text-ink-900">২. ধান ক্রয় রিপোর্ট</h3>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[54rem] border-collapse border border-ink-800 text-sm print:min-w-0 print:text-[10px]">
                <thead className="bg-ink-50 print:bg-white">
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
                        <span className="block">{l.party}</span>
                        <span className="block text-xs text-slate-500 print:text-[9px]">
                          <Link prefetch={false} href={`/vouchers/v/${l.voucherId}`} className="text-brand-700 hover:underline print:text-black print:no-underline">{l.voucherNo}</Link>{l.notes ? ` · ${l.notes}` : ""}
                        </span>
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
                <tfoot>
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
            <p className="mt-1.5 text-xs text-slate-600">
              মোট বস্তা <b>{toBnDigits(t.bags)}</b> · মোট নীট ওজন <b>{formatQty(t.netKg)} কেজি</b> · মোট মণ <b>{toBnDigits(t.mon.toFixed(2))}</b> · সর্বমোট টাকা <b>{money(t.total)}</b>
            </p>
          </section>

          <div className="rounded-lg border border-rule bg-ink-50 p-3 text-sm print:break-inside-avoid print:bg-white">
            <p>
              অন্যান্য ক্রয় <b className="tabular-nums">{money(d.otherNet)}</b> + ধান ক্রয় <b className="tabular-nums">{money(t.total)}</b> = <b>দিনের সর্বমোট ক্রয়: <span id="grand-total" className="tabular-nums">{money(d.grandTotal)}</span></b>
            </p>
            <p className="mt-1"><b>কথায়:</b> <AmountInWords amount={d.grandTotal} /></p>
          </div>

          <div className="print-only pt-10">
            <div className="grid grid-cols-3 gap-8 text-center text-xs">
              {["প্রস্তুতকারী", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-ink-800 pt-1">{s}</p>)}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
