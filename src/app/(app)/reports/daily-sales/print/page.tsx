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
import { dailySales, formatSalesQuantity, quantityText } from "@/server/reports/daily-sales";
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
                <th scope="col" className={`${th} text-left min-w-[12rem]`}>পার্টির নাম</th>
                <th scope="col" className={`${th} text-left min-w-[11rem]`}>পণ্যের নাম</th>
                <th scope="col" className={`${th} text-right min-w-[7.5rem]`}>পরিমাণ</th>
                <th scope="col" className={`${th} text-right w-20`}>দর</th>
                <th scope="col" className={`${th} text-right w-24`}>টাকা</th>
                <th scope="col" className={`${th} text-right w-28`}>মোট</th>
              </tr>
            </thead>
            {d.invoiceGroups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className={`${td} py-4 text-center text-xs text-slate-500`}>
                    এই দিনে কোনো বিক্রয় নেই
                  </td>
                </tr>
              </tbody>
            ) : (
              d.invoiceGroups.map((group, groupIdx) => {
                const rowCount = Math.max(group.items.length, 1);
                return (
                  <tbody
                    key={group.voucherId}
                    className="border-b-2 border-slate-700 print:border-b-2 print:border-black"
                  >
                    {group.items.length === 0 ? (
                      <tr className="align-middle">
                        <td className={`${td} text-center tabular-nums align-middle border-b-2 border-slate-700 print:border-b-2 print:border-black font-bold`}>
                          {toBnDigits(groupIdx + 1)}
                        </td>
                        <td className={`${td} align-middle border-b-2 border-slate-700 print:border-b-2 print:border-black`}>
                          <span className="block font-bold">{group.party}</span>
                          {group.partyAddress && (
                            <span className="block text-xs text-slate-600 print:text-black">{group.partyAddress}</span>
                          )}
                          <span className="block font-mono text-[11px] text-slate-600 print:text-black">
                            {group.voucherNo}
                          </span>
                        </td>
                        <td colSpan={4} className={`${td} text-center text-xs text-slate-500 border-b-2 border-slate-700 print:border-b-2 print:border-black`}>
                          কোনো পণ্যের বিবরণ নেই
                        </td>
                        <td className={`${num} align-middle font-bold text-base border-b-2 border-slate-700 print:border-b-2 print:border-black`}>
                          {money(group.totalAmount)}
                        </td>
                      </tr>
                    ) : (
                      group.items.map((item, itemIdx) => {
                        const isFirst = itemIdx === 0;
                        const isLast = itemIdx === group.items.length - 1;
                        const bottomBorderClass = isLast
                          ? "border-b-2 border-slate-700 print:border-b-2 print:border-black"
                          : "";

                        return (
                          <tr key={`${group.voucherId}-${itemIdx}`} className="align-top">
                            {isFirst && (
                              <td
                                rowSpan={rowCount}
                                className={`${td} w-12 text-center tabular-nums align-middle border-b-2 border-slate-700 print:border-b-2 print:border-black font-bold`}
                              >
                                {toBnDigits(groupIdx + 1)}
                              </td>
                            )}
                            {isFirst && (
                              <td
                                rowSpan={rowCount}
                                className={`${td} align-middle border-b-2 border-slate-700 print:border-b-2 print:border-black`}
                              >
                                <span className="block font-bold">{group.party}</span>
                                {group.partyAddress && (
                                  <span className="block text-xs text-slate-600 print:text-black">{group.partyAddress}</span>
                                )}
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="font-mono text-[11px] text-slate-600 print:text-black">
                                    {group.voucherNo}
                                  </span>
                                  {group.reference && (
                                    <span className="text-[11px] text-slate-500 print:text-black">
                                      ({group.reference})
                                    </span>
                                  )}
                                </div>
                              </td>
                            )}
                            <td className={`${td} ${bottomBorderClass}`}>
                              <span className="font-semibold">{item.product}</span>
                              {item.note && (
                                <span className="block text-[11px] font-normal text-slate-500 print:text-black">
                                  {item.note}
                                </span>
                              )}
                            </td>
                            <td className={`${num} ${bottomBorderClass}`}>
                              {formatSalesQuantity(item)}
                            </td>
                            <td className={`${num} ${bottomBorderClass}`}>
                              {money(item.rate)}
                            </td>
                            <td className={`${num} ${bottomBorderClass}`}>
                              <span>{money(item.amount)}</span>
                              {item.discount > 0 && (
                                <span className="block text-[10px] font-normal text-slate-500 print:text-black">
                                  ছাড় {money(item.discount)}
                                </span>
                              )}
                            </td>
                            {isFirst && (
                              <td
                                rowSpan={rowCount}
                                className={`${num} align-middle font-bold text-base border-b-2 border-slate-700 print:border-b-2 print:border-black`}
                              >
                                <span>{money(group.totalAmount)}</span>
                                {group.discount > 0 && (
                                  <span className="block text-[10px] font-normal text-slate-500 print:text-black">
                                    ছাড় {money(group.discount)}
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                );
              })
            )}
            <tfoot>
              <tr className="font-bold total-row bg-slate-50 print:bg-slate-50" id="sales-totals">
                <td colSpan={3} className={`${td} text-right`}>মোট পরিমাণ ও সর্বমোট বিক্রয় টাকা</td>
                <td className={`${td} text-right tabular-nums`}>
                  {d.totalBags > 0 ? (
                    <div>
                      <span>{toBnDigits(d.totalBags)} বস্তা</span>
                      <span className="block text-[11px] font-normal text-slate-500 print:text-black">
                        ({quantityText(d.quantityByUnit)})
                      </span>
                    </div>
                  ) : (
                    quantityText(d.quantityByUnit)
                  )}
                </td>
                <td className={td} />
                <td className={num}>{money(d.total)}</td>
                <td className={`${num} font-bold text-base`}>{money(d.net)}</td>
              </tr>
              {d.discount > 0 && (
                <tr>
                  <td colSpan={6} className={`${td} text-right`}>(−) ভাউচারের মোট ছাড়</td>
                  <td className={num}>{money(d.discount)}</td>
                </tr>
              )}
              {d.vat > 0 && (
                <tr>
                  <td colSpan={6} className={`${td} text-right`}>(+) মোট ভ্যাট</td>
                  <td className={num}>{money(d.vat)}</td>
                </tr>
              )}
              {(d.discount > 0 || d.vat > 0) && (
                <tr className="font-semibold total-row bg-slate-50 print:bg-slate-50">
                  <td colSpan={6} className={`${td} text-right`}>নিট বিক্রয়</td>
                  <td className={`${num} font-bold text-base`}>{money(d.net)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        <div className="report-summary grid gap-3 rounded-lg border border-black bg-white p-3.5 text-sm sm:grid-cols-4 print:break-inside-avoid print:grid-cols-4 print:bg-white print:border-black print:text-black">
          <div>
            <span className="block text-xs text-slate-600 print:text-black">মোট চালান ও বস্তা</span>
            <p className="mt-0.5 text-base font-bold text-black">
              {toBnDigits(d.invoices)} টি চালান
              {d.totalBags > 0 && (
                <span className="block text-xs font-semibold text-slate-700 print:text-black">
                  মোট {toBnDigits(d.totalBags)} বস্তা
                </span>
              )}
            </p>
          </div>
          <div>
            <span className="block text-xs text-slate-600 print:text-black">সর্বমোট বিক্রয়</span>
            <p id="net-total" className="mt-0.5 text-base font-bold text-black tabular-nums">{money(d.net)}</p>
          </div>
          <div>
            <span className="block text-xs text-slate-600 print:text-black">নগদ আদায়</span>
            <p className="mt-0.5 text-base font-bold text-black tabular-nums">{money(d.collected)}</p>
          </div>
          <div>
            <span className="block text-xs text-slate-600 print:text-black">বাকি</span>
            <p className="mt-0.5 text-base font-bold text-black tabular-nums">{money(d.due)}</p>
          </div>
          <p className="sm:col-span-4 print:col-span-4 border-t border-slate-300 print:border-black pt-2 text-xs">
            <b className="font-bold">কথায়:</b> <AmountInWords amount={d.net} />
          </p>
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
