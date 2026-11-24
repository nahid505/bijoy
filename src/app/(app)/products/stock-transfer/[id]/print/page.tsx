import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { formatDate, formatQty, toBn } from "@/lib/format";
import { AutoPrint, PrintButton } from "@/components/forms";
import { requireContext, requirePermission } from "@/server/auth";
import { getStockTransferForPrint } from "@/server/services/stock-transfer";

export const metadata: Metadata = {
  title: "মাল হস্তান্তর চালান প্রিন্ট",
};

export default async function StockTransferPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("inventory:view");
  const transfer = await getStockTransferForPrint(ctx.business.id, id);

  if (!transfer) notFound();

  const business = transfer.business;
  const totalQty = transfer.items.reduce((s, i) => s + num(i.quantity), 0);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
      <AutoPrint />

      {/* Screen toolbar (hidden on print) */}
      <div className="no-print mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-lg bg-white p-4 shadow-sm border border-rule">
        <div className="flex items-center gap-3">
          <Link
            href="/products/stock-transfer"
            className="btn-secondary text-xs inline-flex items-center gap-1 font-semibold"
          >
            ← ফিরে যান
          </Link>
          <span className="text-sm font-bold text-ink-900">
            চালান নং: <span className="text-brand-700">{transfer.transferNo}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <PrintButton label="🖨 চালান প্রিন্ট / PDF" className="btn-primary text-xs" />
        </div>
      </div>

      {/* Printable Sheet */}
      <div className="mx-auto max-w-4xl bg-white p-8 shadow-sm border border-slate-200 print:border-none print:shadow-none print:p-0">
        {/* Company Letterhead */}
        <div className="border-b-2 border-slate-900 pb-3 text-center">
          <h1 className="text-2xl font-extrabold text-slate-900">{business.name}</h1>
          <p className="text-xs text-slate-600 font-medium mt-0.5">
            {[business.address, business.mobile, business.binNumber ? `BIN: ${business.binNumber}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-3 inline-block rounded-md border border-slate-900 bg-slate-100 px-4 py-1 text-sm font-black tracking-wide text-slate-900">
            মাল হস্তান্তর চালান ও গেট পাস (STOCK TRANSFER CHALLAN)
          </div>
        </div>

        {/* Challan Info Meta Grid */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5 rounded-lg border border-slate-300 p-3 bg-slate-50/50">
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">চালান নং:</span>
              <span className="font-bold text-slate-900">{transfer.transferNo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">হস্তান্তর তারিখ:</span>
              <span className="font-semibold text-slate-900">{formatDate(transfer.date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">প্রস্তুতকারক:</span>
              <span className="font-medium text-slate-900">{transfer.createdBy?.name || "—"}</span>
            </div>
          </div>

          <div className="space-y-1.5 rounded-lg border border-slate-300 p-3 bg-slate-50/50">
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">প্রেরক গুদাম:</span>
              <span className="font-bold text-slate-900">{transfer.fromWarehouse.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">প্রাপক গুদাম:</span>
              <span className="font-bold text-slate-900">{transfer.toWarehouse.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">গাড়ির নম্বর:</span>
              <span className="font-semibold text-slate-900">{transfer.vehicleNo || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">চালকের নাম:</span>
              <span className="font-medium text-slate-900">{transfer.driverName || "—"}</span>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="mt-5 overflow-hidden rounded-lg border border-slate-900">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-900 bg-slate-100 font-bold text-slate-900">
                <th className="border-r border-slate-300 p-2 text-center w-12">ক্র.নং</th>
                <th className="border-r border-slate-300 p-2">পণ্যের বিবরণ</th>
                <th className="border-r border-slate-300 p-2 w-28">কোড</th>
                <th className="border-r border-slate-300 p-2 w-28">ব্যাচ নং</th>
                <th className="border-r border-slate-300 p-2 text-right w-32">পরিমাণ</th>
                <th className="p-2 w-20 text-center">একক</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {transfer.items.map((item, idx) => (
                <tr key={item.id} className="text-slate-800">
                  <td className="border-r border-slate-300 p-2 text-center font-medium">{toBn(idx + 1)}</td>
                  <td className="border-r border-slate-300 p-2 font-bold text-slate-900">
                    {item.product.name}
                  </td>
                  <td className="border-r border-slate-300 p-2 text-slate-600">
                    {item.product.code || "—"}
                  </td>
                  <td className="border-r border-slate-300 p-2 text-slate-600">
                    {item.batchNo || "—"}
                  </td>
                  <td className="border-r border-slate-300 p-2 text-right font-bold tabular-nums text-slate-900">
                    {formatQty(num(item.quantity))}
                  </td>
                  <td className="p-2 text-center font-medium text-slate-700">
                    {item.product.unit.name}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
                <td colSpan={4} className="border-r border-slate-300 p-2 text-right uppercase">
                  সর্বমোট পরিমাণ:
                </td>
                <td className="border-r border-slate-300 p-2 text-right font-black tabular-nums text-sm">
                  {formatQty(totalQty)}
                </td>
                <td className="p-2 text-center">আইটেম</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Notes */}
        {transfer.notes && (
          <div className="mt-4 rounded border border-slate-300 p-3 text-xs bg-slate-50">
            <span className="font-bold text-slate-900">মন্তব্য / বিশেষ দ্রষ্টব্য: </span>
            <span className="text-slate-700">{transfer.notes}</span>
          </div>
        )}

        {/* Signatures Section */}
        <div className="mt-16 grid grid-cols-4 gap-4 pt-4 text-center text-xs text-slate-800 print:mt-24">
          <div>
            <div className="border-t border-slate-800 pt-1.5 font-bold">
              প্রেরক গুদাম ইনচার্জ
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">স্বাক্ষর ও তারিখ</div>
          </div>
          <div>
            <div className="border-t border-slate-800 pt-1.5 font-bold">
              পরিবহনকারী / চালক
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">স্বাক্ষর ও তারিখ</div>
          </div>
          <div>
            <div className="border-t border-slate-800 pt-1.5 font-bold">
              প্রাপক গুদাম ইনচার্জ
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">স্বাক্ষর ও তারিখ</div>
          </div>
          <div>
            <div className="border-t border-slate-800 pt-1.5 font-bold">
              অনুমোদিত স্বাক্ষর
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">স্বত্বাধিকারী / কর্তৃপক্ষ</div>
          </div>
        </div>

        {/* Print Footer */}
        <div className="mt-10 border-t border-slate-200 pt-2 flex items-center justify-between text-[10px] text-slate-400">
          <span>বিজয় লেনদেন ইআরপি সিস্টেম</span>
          <span>প্রিন্ট সময়: {new Date().toLocaleString("bn-BD")}</span>
        </div>
      </div>
    </div>
  );
}
