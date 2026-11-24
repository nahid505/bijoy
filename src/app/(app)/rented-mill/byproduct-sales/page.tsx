import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  PrintButton,
  RentedMillTabs,
} from "../rented-mill-ui";
import { ByproductSaleClient } from "./byproduct-client";
import { ByproductSaleRowActions } from "../rented-mill-edit-modals";

export const metadata: Metadata = {
  title: "ভুষি ও কুঁড়া বিক্রয় - ভাড়া অটো রাইস মিল",
};

export default async function ByproductSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const filterType = sp.type || "";

  const sales = await prisma.rentedMillByproductSale.findMany({
    where: {
      AND: [
        { status: "APPROVED" },
        filterType ? { productType: filterType } : {},
        q
          ? {
              OR: [
                { invoiceNo: { contains: q } },
                { customerName: { contains: q } },
                { notes: { contains: q } },
              ],
            }
          : {},
      ],
    },
    orderBy: { date: "desc" },
  });

  const totalAmount = sales.reduce((s, x) => s + x.totalAmount, 0);
  const totalPaid = sales.reduce((s, x) => s + x.paidAmount, 0);
  const totalDue = sales.reduce((s, x) => s + x.dueAmount, 0);
  const totalQty = sales.reduce((s, x) => s + x.quantity, 0);

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      {/* Header and Action Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            ভুষি ও কুঁড়া বিক্রয়
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            মিলিং থেকে প্রাপ্ত ভুষি ও কুঁড়া বিক্রয় এবং সরাসরি মিলের আয়ে অন্তর্ভুক্তি
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ByproductSaleClient role={role} />
          <PrintButton label="বিক্রয় তালিকা প্রিন্ট" />
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট বিক্রয় মূল্য</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-ink-900">
            {formatBnCurrency(totalAmount)}
          </p>
          <p className="text-[11px] text-slate-500">
            মোট পরিমাণ: {toBn(totalQty.toFixed(0))} কেজি/একক
          </p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">নগদ প্রাপ্ত টাকা</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-emerald-700">
            {formatBnCurrency(totalPaid)}
          </p>
          <p className="text-[11px] text-slate-500">মিলের ক্যাশে জমা</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">বকেয়া বাকি</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-red-700">
            {formatBnCurrency(totalDue)}
          </p>
          <p className="text-[11px] text-slate-500">ক্রেতার নিকট পাওনা</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট চালান সংখ্যা</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-blue-900">
            {toBn(sales.length)} টি
          </p>
          <p className="text-[11px] text-slate-500">বিক্রয় রশিদ</p>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <form method="GET" className="flex flex-1 items-center gap-2 max-w-md">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="চালান নং, ক্রেতার নাম বা মন্তব্য খুঁজুন..."
            className="w-full rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-ink-900 focus:border-brand-500"
          />
          <button type="submit" className="btn-outline text-xs">
            সার্চ
          </button>
        </form>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-rule bg-slate-50/70 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-900">
            ভুষি ও কুঁড়া বিক্রয় তালিকা ({toBn(sales.length)} টি)
          </h2>
        </div>

        {sales.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            কোনো বিক্রয় রেকর্ড পাওয়া যায়নি। উপরে <b>&ldquo;নতুন ভুষি / কুঁড়া বিক্রয় এন্ট্রি&rdquo;</b> বাটনে ক্লিক করে বিক্রয় যোগ করুন।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-rule bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">চালান নং</th>
                  <th className="py-2.5 px-3 font-semibold">তারিখ</th>
                  <th className="py-2.5 px-3 font-semibold">ক্রেতার নাম</th>
                  <th className="py-2.5 px-3 font-semibold">পণ্য</th>
                  <th className="py-2.5 px-3 font-semibold text-right">পরিমাণ</th>
                  <th className="py-2.5 px-3 font-semibold text-right">দর</th>
                  <th className="py-2.5 px-3 font-semibold text-right">মোট টাকা</th>
                  <th className="py-2.5 px-3 font-semibold text-right">প্রাপ্ত টাকা</th>
                  <th className="py-2.5 px-3 font-semibold text-right">বাকি</th>
                  {role !== "PARTNER" && (
                    <th className="py-2.5 px-3 font-semibold text-center no-print">অ্যাকশন</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-brand-700">
                      {s.invoiceNo}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {getBengaliDateLabel(s.date)}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-ink-900">
                      {s.customerName}
                      {s.customerPhone && (
                        <span className="block text-[11px] text-slate-400">
                          {s.customerPhone}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                        {s.productType}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                      {toBn(s.quantity)} {s.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {formatBnCurrency(s.rate)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-ink-900">
                      {formatBnCurrency(s.totalAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                      {formatBnCurrency(s.paidAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-red-700">
                      {formatBnCurrency(s.dueAmount)}
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2.5 px-3 text-center no-print">
                        <ByproductSaleRowActions sale={s} role={role} compact={false} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
