import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { requirePermission } from "@/server/auth";
import { getBagReturnVoucher, getSupplierBagBalance } from "@/server/services/bag-tracking";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "বস্তা ফেরত চালান প্রিন্ট" };

export default async function BagReturnPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("auto_rice_mill:bag_return:view");
  const v = await getBagReturnVoucher(ctx.business.id, id);
  if (!v) notFound();

  const balance = await getSupplierBagBalance(ctx.business.id, v.supplierId);
  const b = v.business;
  const totalReturned = v.returnedJuteBags + v.returnedPlasticBags;

  return (
    <div className="mx-auto max-w-3xl py-4 font-sans text-ink-900">
      {/* নো-প্রিন্ট টুলবার */}
      <div className="no-print mb-4 flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <PrintButton label="🖨 চালান প্রিন্ট / PDF" />
          <Link prefetch={false} href={`/auto-rice-mill/bag-returns/${v.id}`} className="btn-secondary">
            ← চালানে ফিরুন
          </Link>
          <Link prefetch={false} href="/auto-rice-mill/bag-returns/new" className="btn-secondary">
            + নতুন ফেরত চালান
          </Link>
        </div>
      </div>

      {/* প্রিন্ট উপযোগী চালান পেপার */}
      <div className="rounded-lg border border-slate-300 bg-white p-6 shadow-sm print:border-none print:p-0 print:shadow-none">
        {/* হেডার */}
        <div className="border-b-2 border-slate-800 pb-3 text-center">
          <h1 className="text-2xl font-black text-slate-900">{b.name}</h1>
          {b.address && <p className="text-xs text-slate-600 mt-0.5">{b.address}</p>}
          {b.mobile && <p className="text-xs text-slate-600">ফোন: {b.mobile}</p>}
          <div className="mt-2 inline-block rounded-md bg-slate-900 px-4 py-1 text-sm font-bold text-white uppercase tracking-wider">
            খালি বস্তা ফেরত চালান
          </div>
        </div>

        {/* চালান ও সরবরাহকারী তথ্য */}
        <div className="mt-4 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3 text-xs sm:text-sm">
          <div>
            <p className="text-slate-500 text-xs">সরবরাহকারীর তথ্য:</p>
            <p className="font-bold text-slate-900 text-base">{v.supplier.name}</p>
            {v.supplier.mobile && <p className="text-slate-700">মোবাইল: {v.supplier.mobile}</p>}
            {v.supplier.address && <p className="text-slate-600">ঠিকানা: {v.supplier.address}</p>}
          </div>

          <div className="text-right">
            <p>
              <span className="text-slate-500">চালান নং:</span>{" "}
              <span className="font-mono font-bold text-slate-900 text-base">{v.voucherNo}</span>
            </p>
            <p>
              <span className="text-slate-500">তারিখ:</span>{" "}
              <span className="font-medium text-slate-900">{formatDate(v.date)}</span>
            </p>
            {v.vehicleNo && (
              <p>
                <span className="text-slate-500">গাড়ি নম্বর:</span>{" "}
                <span className="font-semibold text-slate-900">{v.vehicleNo}</span>
              </p>
            )}
            {v.driverName && (
              <p>
                <span className="text-slate-500">ড্রাইভার:</span>{" "}
                <span className="font-semibold text-slate-900">{v.driverName}</span>
              </p>
            )}
          </div>
        </div>

        {/* ফেরত বস্তার টেবিল */}
        <div className="mt-4">
          <table className="w-full border-collapse border border-slate-400 text-left text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-800">
                <th className="border border-slate-400 px-3 py-2 text-center w-12">ক্র:</th>
                <th className="border border-slate-400 px-3 py-2">খালি বস্তার বিবরণ</th>
                <th className="border border-slate-400 px-3 py-2 text-right w-36">ফেরত সংখ্যা (টি)</th>
                <th className="border border-slate-400 px-3 py-2 w-48">মন্তব্য</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-400 px-3 py-2.5 text-center">১</td>
                <td className="border border-slate-400 px-3 py-2.5 font-semibold text-slate-900">
                  চটের বস্তা (Jute Bag)
                </td>
                <td className="border border-slate-400 px-3 py-2.5 text-right font-bold text-base tabular-nums">
                  {toBnDigits(v.returnedJuteBags)}
                </td>
                <td className="border border-slate-400 px-3 py-2.5 text-xs text-slate-600">
                  {v.returnedJuteBags > 0 ? "খালি চটের বস্তা ফেরত" : "—"}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-400 px-3 py-2.5 text-center">২</td>
                <td className="border border-slate-400 px-3 py-2.5 font-semibold text-slate-900">
                  প্লাস্টিক বস্তা (Plastic Bag)
                </td>
                <td className="border border-slate-400 px-3 py-2.5 text-right font-bold text-base tabular-nums">
                  {toBnDigits(v.returnedPlasticBags)}
                </td>
                <td className="border border-slate-400 px-3 py-2.5 text-xs text-slate-600">
                  {v.returnedPlasticBags > 0 ? "খালি প্লাস্টিক বস্তা ফেরত" : "—"}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold text-slate-900">
                <td colSpan={2} className="border border-slate-400 px-3 py-2 text-right">
                  সর্বমোট ফেরত বস্তা:
                </td>
                <td className="border border-slate-400 px-3 py-2 text-right text-lg tabular-nums">
                  {toBnDigits(totalReturned)} টি
                </td>
                <td className="border border-slate-400 px-3 py-2 text-xs font-normal">
                  (চট: {toBnDigits(v.returnedJuteBags)} + প্লাস্টিক: {toBnDigits(v.returnedPlasticBags)})
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* নোট */}
        {v.note && (
          <div className="mt-3 text-xs text-slate-700">
            <span className="font-semibold">নোট:</span> {v.note}
          </div>
        )}

        {/* বর্তমান অবশিষ্ট পাওনা সামারি বক্স */}
        <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 p-2.5 text-xs">
          <p className="font-bold text-slate-800">
            📦 এ চালানের পর সরবরাহকারীর অবশিষ্ট বস্তা পাওনা হিসাব:
          </p>
          <div className="mt-1 flex flex-wrap gap-4 text-slate-700">
            <span>
              চটের বস্তা: <b>{toBnDigits(balance.dueJuteBags)}</b> টি
            </span>
            <span>·</span>
            <span>
              প্লাস্টিক বস্তা: <b>{toBnDigits(balance.duePlasticBags)}</b> টি
            </span>
            <span>·</span>
            <span className="font-bold text-slate-900">
              সর্বমোট পাওনা: <b>{toBnDigits(balance.dueTotalBags)}</b> টি
            </span>
          </div>
        </div>

        {/* স্বাক্ষর সেকশন */}
        <div className="mt-16 grid grid-cols-3 gap-6 text-center text-xs">
          <div>
            <div className="border-t border-slate-400 pt-1 font-semibold text-slate-800">
              মাল গ্রহণকারীর স্বাক্ষর
            </div>
            <p className="text-[10px] text-slate-400">সরবরাহকারী / প্রতিনিধি</p>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-1 font-semibold text-slate-800">
              ড্রাইভারের স্বাক্ষর
            </div>
            <p className="text-[10px] text-slate-400">{v.driverName ?? "বস্তা বহনকারী"}</p>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-1 font-semibold text-slate-800">
              অনুমোদিত স্বাক্ষর
            </div>
            <p className="text-[10px] text-slate-400">{b.name}</p>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-slate-400 print:block">
          চালানটি বিজয় লেনদেন অটো রাইস মিল সিস্টেম দ্বারা প্রিন্টকৃত
        </div>
      </div>
    </div>
  );
}
