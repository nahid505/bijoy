"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSettlementAction,
  deleteSettlementAction,
} from "@/server/actions/rented-mill";
import type {
  RentedMillRole,
  RentedMillSettingsData,
  RentedMillSettlementRecord,
} from "@/lib/rented-mill-types";
import { formatBnCurrency, toBn, getBengaliDateLabel } from "@/lib/format";

interface UnsettledData {
  totalMillingIncome: number;
  totalByproductIncome: number;
  totalIncome: number;
  totalRentExpense: number;
  totalOtherExpense: number;
  totalExpense: number;
  netProfit: number;
  partner1Amount: number;
  partner2Amount: number;
  paddyReceiptCount: number;
  billsCount: number;
  byproductSaleCount: number;
  expenseCount: number;
  expensesByCategory: Record<string, number>;
  partnerFundSummary?: {
    partner1: {
      deposit: number;
      withdraw: number;
      net: number;
      finalAmount: number;
    };
    partner2: {
      deposit: number;
      withdraw: number;
      net: number;
      finalAmount: number;
    };
  };
}

export function ProfitSettlementClient({
  role,
  fromDate,
  toDate,
  lastSettledDate,
  settings,
  unsettledData,
  settlements,
}: {
  role: RentedMillRole;
  fromDate: string;
  toDate: string;
  lastSettledDate: string | null;
  settings: RentedMillSettingsData;
  unsettledData: UnsettledData;
  settlements: RentedMillSettlementRecord[];
}) {
  const router = useRouter();

  // Filter dates
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);

  // Settlement Form State
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Print Voucher Modal
  const [selectedVoucher, setSelectedVoucher] = useState<RentedMillSettlementRecord | null>(null);

  // Quick Date Selectors
  function setQuickRange(type: "current_month" | "last_month" | "since_last") {
    const today = new Date();
    if (type === "current_month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      const end = today.toISOString().split("T")[0];
      setFrom(start);
      setTo(end);
      router.push(`/rented-mill/profit-settlement?from=${start}&to=${end}`);
    } else if (type === "last_month") {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        .toISOString()
        .split("T")[0];
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
        .toISOString()
        .split("T")[0];
      setFrom(start);
      setTo(end);
      router.push(`/rented-mill/profit-settlement?from=${start}&to=${end}`);
    } else if (type === "since_last") {
      let start = "";
      if (lastSettledDate) {
        const d = new Date(lastSettledDate);
        d.setDate(d.getDate() + 1);
        start = d.toISOString().split("T")[0];
      } else {
        start = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString()
          .split("T")[0];
      }
      const end = today.toISOString().split("T")[0];
      setFrom(start);
      setTo(end);
      router.push(`/rented-mill/profit-settlement?from=${start}&to=${end}`);
    }
  }

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/rented-mill/profit-settlement?from=${from}&to=${to}`);
  }

  async function handleSettleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMsg(null);

    const fd = new FormData();
    fd.append("fromDate", from);
    fd.append("toDate", to);
    fd.append("notes", notes);

    try {
      const res = await createSettlementAction(fd);
      setStatusMsg({ ok: true, text: res.message });
      setShowSettleModal(false);
      setNotes("");
      router.refresh();
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err.message || "নিষ্পত্তি সম্পন্ন করতে সমস্যা হয়েছে।" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteSettlement(id: string, sNo: string) {
    if (
      !confirm(
        `আপনি কি নিশ্চিত ${sNo} নং নিষ্পত্তি রেকর্ডটি বাতিল করতে চান? এতে সংশ্লিষ্ট সকল লেনদেন পুনরায় অনিষ্পত্তিকৃত অবস্থায় ফেরত যাবে।`
      )
    ) {
      return;
    }
    try {
      const res = await deleteSettlementAction(id);
      setStatusMsg({ ok: true, text: res.message });
      router.refresh();
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err.message || "বাতিল করতে সমস্যা হয়েছে।" });
    }
  }

  const isProfit = unsettledData.netProfit >= 0;
  const totalEntriesCount =
    unsettledData.paddyReceiptCount +
    unsettledData.billsCount +
    unsettledData.byproductSaleCount +
    unsettledData.expenseCount;

  return (
    <div className="space-y-6">
      {/* Date Filter & Quick Range Buttons */}
      <div className="rounded-xl border border-rule bg-white p-4 shadow-2xs no-print">
        <form
          onSubmit={handleFilterSubmit}
          className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700">তারিখ সীমা:</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs font-semibold text-ink-900"
              />
              <span className="text-xs text-slate-400">হতে</span>
              <input
                type="date"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs font-semibold text-ink-900"
              />
            </div>
            <button type="submit" className="btn-primary text-xs font-semibold px-3 py-1.5">
              হিসাব দেখুন
            </button>
          </div>

          {/* Quick Shortcuts */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQuickRange("current_month")}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700"
            >
              চলতি মাস
            </button>
            <button
              type="button"
              onClick={() => setQuickRange("last_month")}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700"
            >
              গত মাস
            </button>
            <button
              type="button"
              onClick={() => setQuickRange("since_last")}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100"
            >
              {lastSettledDate ? "সর্বশেষ নিষ্পত্তির পর হতে আজ" : "শুরু হতে আজ"}
            </button>
          </div>
        </form>
      </div>

      {statusMsg && (
        <div
          className={`rounded-xl p-4 text-xs font-bold ${
            statusMsg.ok
              ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
              : "bg-red-50 text-red-800 border border-red-300"
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Calculator Results: Big Profit / Loss Result Card */}
      <div
        className={`rounded-2xl border-2 p-5 sm:p-6 shadow-sm transition ${
          isProfit
            ? "border-emerald-400 bg-gradient-to-br from-emerald-50/90 to-emerald-100/40"
            : "border-red-400 bg-gradient-to-br from-red-50/90 to-red-100/40"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4 border-black/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{isProfit ? "🎉" : "⚠️"}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-wider ${
                  isProfit
                    ? "bg-emerald-600 text-white"
                    : "bg-red-600 text-white"
                }`}
              >
                {isProfit ? "নিট লাভ (Net Profit)" : "নিট লোকসান (Net Loss)"}
              </span>
              <span className="text-xs text-slate-600 font-semibold">
                (অনিষ্পত্তিকৃত লেনদেন)
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-ink-950 mt-2">
              {formatBnCurrency(Math.abs(unsettledData.netProfit))}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              নির্বাচিত মেয়াদ: <b>{toBn(from)}</b> হতে <b>{toBn(to)}</b> (মোট {toBn(totalEntriesCount)} টি অনুমোদিত এন্ট্রি)
            </p>
          </div>

          {/* Settle Period Action Button */}
          {role === "SUPER_ADMIN" && (
            <div>
              <button
                type="button"
                onClick={() => setShowSettleModal(true)}
                disabled={totalEntriesCount === 0}
                className="btn-primary text-xs sm:text-sm font-bold px-4 py-2.5 shadow-md flex items-center gap-1.5"
              >
                <span>⚖️</span>
                <span>এই মেয়াদের লাভ/লস বণ্টন চূড়ান্ত করুন</span>
              </button>
              {totalEntriesCount === 0 && (
                <p className="text-[10px] text-slate-500 mt-1 text-right">
                  নির্বাচিত মেয়াদে কোনো অনিষ্পত্তিকৃত এন্ট্রি নেই
                </p>
              )}
            </div>
          )}
        </div>

        {/* 50:50 Partner Breakdown Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
          {/* Partner 1 (Nahid Hasan) */}
          <div className="rounded-xl border border-black/10 bg-white/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
              <span>{settings.partner1Name} (মালিক)</span>
              <span className="rounded bg-brand-50 text-brand-700 px-2 py-0.5 font-bold">
                {toBn(settings.partner1Share)}% অংশ
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {isProfit ? "ব্যবসায়িক লভ্যাংশ (৫০%):" : "লোকসানের দায়ভার (৫০%):"}
            </p>
            <p
              className={`text-xl sm:text-2xl font-black mt-1 ${
                isProfit ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {formatBnCurrency(Math.abs(unsettledData.partner1Amount))}
            </p>

            {unsettledData.partnerFundSummary && (
              <div className="mt-3 pt-3 border-t border-slate-200/80 text-[11px] space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  মূলধন ও তহবিল রেফারেন্স (এই মেয়াদে)
                </span>
                <div className="flex items-center justify-between text-slate-600 font-medium">
                  <span>মেয়াদে মূলধন জমা:</span>
                  <span className="font-bold text-emerald-700">+{formatBnCurrency(unsettledData.partnerFundSummary.partner1.deposit)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600 font-medium">
                  <span>মেয়াদে টাকা উত্তোলন:</span>
                  <span className="font-bold text-red-600">-{formatBnCurrency(unsettledData.partnerFundSummary.partner1.withdraw)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-700 font-medium pt-1 border-t border-dashed border-slate-200">
                  <span>তহবিল স্থিতি (জমা - উত্তোলন):</span>
                  <span className={`font-bold ${unsettledData.partnerFundSummary.partner1.net >= 0 ? "text-emerald-800" : "text-amber-700"}`}>
                    {unsettledData.partnerFundSummary.partner1.net >= 0 ? "+" : ""}{formatBnCurrency(unsettledData.partnerFundSummary.partner1.net)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-ink-900 font-bold pt-1.5 border-t border-slate-200 bg-slate-50 -mx-2 px-2 py-1 rounded">
                  <span>চূড়ান্ত সমন্বিত প্রাপ্যতা / হিসাব:</span>
                  <span className={`font-black text-sm ${unsettledData.partnerFundSummary.partner1.finalAmount >= 0 ? "text-emerald-800" : "text-red-700"}`}>
                    {formatBnCurrency(unsettledData.partnerFundSummary.partner1.finalAmount)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Partner 2 */}
          <div className="rounded-xl border border-black/10 bg-white/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
              <span>{settings.partner2Name} (অংশীদার)</span>
              <span className="rounded bg-blue-50 text-blue-700 px-2 py-0.5 font-bold">
                {toBn(settings.partner2Share)}% অংশ
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {isProfit ? "ব্যবসায়িক লভ্যাংশ (৫০%):" : "লোকসানের দায়ভার (৫০%):"}
            </p>
            <p
              className={`text-xl sm:text-2xl font-black mt-1 ${
                isProfit ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {formatBnCurrency(Math.abs(unsettledData.partner2Amount))}
            </p>

            {unsettledData.partnerFundSummary && (
              <div className="mt-3 pt-3 border-t border-slate-200/80 text-[11px] space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  মূলধন ও তহবিল রেফারেন্স (এই মেয়াদে)
                </span>
                <div className="flex items-center justify-between text-slate-600 font-medium">
                  <span>মেয়াদে মূলধন জমা:</span>
                  <span className="font-bold text-emerald-700">+{formatBnCurrency(unsettledData.partnerFundSummary.partner2.deposit)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600 font-medium">
                  <span>মেয়াদে টাকা উত্তোলন:</span>
                  <span className="font-bold text-red-600">-{formatBnCurrency(unsettledData.partnerFundSummary.partner2.withdraw)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-700 font-medium pt-1 border-t border-dashed border-slate-200">
                  <span>তহবিল স্থিতি (জমা - উত্তোলন):</span>
                  <span className={`font-bold ${unsettledData.partnerFundSummary.partner2.net >= 0 ? "text-emerald-800" : "text-amber-700"}`}>
                    {unsettledData.partnerFundSummary.partner2.net >= 0 ? "+" : ""}{formatBnCurrency(unsettledData.partnerFundSummary.partner2.net)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-ink-900 font-bold pt-1.5 border-t border-slate-200 bg-slate-50 -mx-2 px-2 py-1 rounded">
                  <span>চূড়ান্ত সমন্বিত প্রাপ্যতা / হিসাব:</span>
                  <span className={`font-black text-sm ${unsettledData.partnerFundSummary.partner2.finalAmount >= 0 ? "text-emerald-800" : "text-red-700"}`}>
                    {formatBnCurrency(unsettledData.partnerFundSummary.partner2.finalAmount)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Financial Flow Breakdown Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-black/10 text-xs">
          {/* আয়সমূহ */}
          <div className="rounded-xl bg-white/80 p-3.5 border border-emerald-200">
            <h4 className="font-bold text-emerald-900 border-b border-emerald-100 pb-1 mb-2">
              আয়ের বিস্তারিত খাতসমূহ (মোট: {formatBnCurrency(unsettledData.totalIncome)})
            </h4>
            <div className="space-y-1.5 text-slate-700">
              <div className="flex justify-between">
                <span>ধান ছাটাই বিল বাবদ আয়:</span>
                <b>{formatBnCurrency(unsettledData.totalMillingIncome)}</b>
              </div>
              <div className="flex justify-between">
                <span>ভুষি ও কুঁড়া বিক্রয় আয়:</span>
                <b>{formatBnCurrency(unsettledData.totalByproductIncome)}</b>
              </div>
            </div>
          </div>

          {/* ব্যয়সমূহ */}
          <div className="rounded-xl bg-white/80 p-3.5 border border-amber-200">
            <h4 className="font-bold text-amber-900 border-b border-amber-100 pb-1 mb-2">
              ব্যয়ের বিস্তারিত খাতসমূহ (মোট: {formatBnCurrency(unsettledData.totalExpense)})
            </h4>
            <div className="space-y-1.5 text-slate-700">
              <div className="flex justify-between">
                <span>মিল ভাড়া বাবদ ব্যয়:</span>
                <b>{formatBnCurrency(unsettledData.totalRentExpense)}</b>
              </div>
              <div className="flex justify-between">
                <span>অন্যান্য পরিচালনা ব্যয় (লেবার, বিদ্যুৎ, বেতন):</span>
                <b>{formatBnCurrency(unsettledData.totalOtherExpense)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* পূর্ববর্তী লাভ-ক্ষতি নিষ্পত্তির তালিকা (Settlement History) */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden mt-8">
        <div className="border-b border-rule bg-slate-50/70 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-ink-900">
              পূর্ববর্তী লাভ-ক্ষতি নিষ্পত্তির ইতিহাস (Settlement History)
            </h2>
            <p className="text-xs text-slate-500">
              অতীতে চূড়ান্ত নিষ্পত্তিকৃত মেয়াদের লাভ-ক্ষতি ও ৫০:৫০ বণ্টনের স্থায়ী রেকর্ড
            </p>
          </div>
          <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-bold text-slate-700">
            {toBn(settlements.length)} টি
          </span>
        </div>

        {settlements.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            এখনও পর্যন্ত কোনো মেয়াদের লাভ-ক্ষতি চূড়ান্ত নিষ্পত্তি করা হয়নি। উপরের ক্যালকুলেটর থেকে মেয়াদের লাভ/লস হিসাব করে <b>&ldquo;এই মেয়াদের লাভ/লস বণ্টন চূড়ান্ত করুন&rdquo;</b> বাটনে ক্লিক করুন।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-rule bg-slate-100 text-slate-700 font-bold">
                  <th className="py-2.5 px-3">ভাউচার নং</th>
                  <th className="py-2.5 px-3">নিষ্পত্তির মেয়াদ</th>
                  <th className="py-2.5 px-3 text-right">মোট আয়</th>
                  <th className="py-2.5 px-3 text-right">মোট ব্যয়</th>
                  <th className="py-2.5 px-3 text-right">নিট ফলাফল</th>
                  <th className="py-2.5 px-3 text-right">{settings.partner1Name} (৫০%)</th>
                  <th className="py-2.5 px-3 text-right">{settings.partner2Name} (৫০%)</th>
                  <th className="py-2.5 px-3">নোট / বিবরণ</th>
                  <th className="py-2.5 px-3 text-center no-print">ভাউচার প্রিন্ট</th>
                  {role === "SUPER_ADMIN" && (
                    <th className="py-2.5 px-3 text-center no-print w-10">বাতিল</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map((s) => {
                  const isSProfit = s.netProfit >= 0;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono font-bold text-brand-700">
                        {s.settlementNo}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        <div>
                          {getBengaliDateLabel(new Date(s.fromDate))} হতে
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {getBengaliDateLabel(new Date(s.toDate))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-800">
                        {formatBnCurrency(s.totalIncome)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-amber-800">
                        {formatBnCurrency(s.totalExpense)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-black ${
                            isSProfit ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {isSProfit ? "লাভ " : "লোকসান "}
                          {formatBnCurrency(Math.abs(s.netProfit))}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-ink-900">
                        {formatBnCurrency(Math.abs(s.partner1Amount))}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-ink-900">
                        {formatBnCurrency(Math.abs(s.partner2Amount))}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                        {s.notes || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-center no-print">
                        <button
                          type="button"
                          onClick={() => setSelectedVoucher(s)}
                          className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-100"
                        >
                          ভাউচার প্রিন্ট 🖨️
                        </button>
                      </td>
                      {role === "SUPER_ADMIN" && (
                        <td className="py-2.5 px-3 text-center no-print">
                          <button
                            type="button"
                            onClick={() => handleDeleteSettlement(s.id, s.settlementNo)}
                            title="নিষ্পত্তি বাতিল করুন"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Settle Period Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSettleConfirm}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base sm:text-lg font-bold text-ink-900 flex items-center gap-2">
                <span>⚖️</span>
                <span>লাভ-ক্ষতি ও ৫০:৫০ বণ্টন চূড়ান্ত নিষ্পত্তি</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSettleModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                <p className="font-bold">⚠️ সতর্কবার্তা:</p>
                <p className="mt-0.5">
                  আপনি <b>{toBn(from)}</b> হতে <b>{toBn(to)}</b> তারিখের হিসাব চূড়ান্তভাবে ক্লোজ করতে যাচ্ছেন। এটি সম্পন্ন হলে এই মেয়াদের অনুমোদিত সকল এন্ট্রি &ldquo;নিষ্পত্তিকৃত (Settled)&rdquo; হিসেবে চিহ্নিত হবে এবং পরবর্তী মেয়াদের হিসাবে আর পুনরায় আসবে না।
                </p>
              </div>

              <div className="space-y-2 rounded-lg bg-slate-50 p-3.5 text-xs text-ink-900 border border-rule">
                <div className="flex justify-between">
                  <span>সর্বমোট আয়:</span>
                  <span className="font-bold text-emerald-800">
                    {formatBnCurrency(unsettledData.totalIncome)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>সর্বমোট ব্যয়:</span>
                  <span className="font-bold text-amber-800">
                    {formatBnCurrency(unsettledData.totalExpense)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200 text-sm">
                  <span className="font-bold">
                    {isProfit ? "চূড়ান্ত নিট লাভ:" : "চূড়ান্ত নিট লোকসান:"}
                  </span>
                  <span
                    className={`font-black ${
                      isProfit ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {formatBnCurrency(Math.abs(unsettledData.netProfit))}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t text-[11px]">
                  <div className="rounded bg-white p-2 border">
                    <span>{settings.partner1Name} (৫০%):</span>
                    <p className="font-black text-ink-900 mt-0.5">
                      {formatBnCurrency(Math.abs(unsettledData.partner1Amount))}
                    </p>
                    {unsettledData.partnerFundSummary && (
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        তহবিল সমন্বয়সহ: <b>{formatBnCurrency(unsettledData.partnerFundSummary.partner1.finalAmount)}</b>
                      </span>
                    )}
                  </div>
                  <div className="rounded bg-white p-2 border">
                    <span>{settings.partner2Name} (৫০%):</span>
                    <p className="font-black text-ink-900 mt-0.5">
                      {formatBnCurrency(Math.abs(unsettledData.partner2Amount))}
                    </p>
                    {unsettledData.partnerFundSummary && (
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        তহবিল সমন্বয়সহ: <b>{formatBnCurrency(unsettledData.partnerFundSummary.partner2.finalAmount)}</b>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  মন্তব্য / নিষ্পত্তির বিবরণ (ঐচ্ছিক)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="যেমন: নগদ টাকা ভাগ করে দেওয়া হলো / ব্যাংক ট্রান্সফার সম্পন্ন..."
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setShowSettleModal(false)}
                className="btn-outline text-xs"
                disabled={isSubmitting}
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary text-xs font-semibold px-4 py-2"
              >
                {isSubmitting ? "নিষ্পত্তি হচ্ছে..." : "চূড়ান্ত নিশ্চিত করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Printable Voucher Modal */}
      {selectedVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:p-0">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl print:max-h-none print:overflow-visible print:shadow-none print:w-full print:m-0 print:p-0 print:rounded-none">
            {/* Action Bar (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4 no-print">
              <h3 className="font-bold text-ink-900 text-sm">
                নিষ্পত্তি ভাউচার প্রিভিউ ({selectedVoucher.settlementNo})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn-primary text-xs flex items-center gap-1"
                >
                  <span>🖨️</span> প্রিন্ট করুন (A4)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedVoucher(null)}
                  className="btn-outline text-xs"
                >
                  বন্ধ করুন ✕
                </button>
              </div>
            </div>

            {/* A4 Printable Voucher Area (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 print:overflow-visible print:p-0">
              <div className="border border-black p-6 bg-white text-black font-sans print:border-none print:p-0">
              {/* Mill Header */}
              <div className="text-center border-b-2 border-black pb-3 mb-4">
                <h1 className="text-2xl font-black">{settings.millName}</h1>
                <p className="text-xs font-semibold">{settings.millAddress} · ফোন: {settings.millPhone}</p>
                <div className="mt-2 inline-block border-y border-black py-1 px-4">
                  <h2 className="text-sm font-bold tracking-wide">
                    লাভ-ক্ষতি ও ৫০:৫০ অংশীদারিত্ব নিষ্পত্তি ভাউচার
                  </h2>
                </div>
              </div>

              {/* Voucher Meta */}
              <div className="grid grid-cols-2 gap-2 text-xs border-b border-black pb-3 mb-4">
                <div>
                  <p>ভাউচার নং: <b>{selectedVoucher.settlementNo}</b></p>
                  <p className="mt-1">
                    হিসাবের মেয়াদ: <b>{getBengaliDateLabel(new Date(selectedVoucher.fromDate))}</b> হতে <b>{getBengaliDateLabel(new Date(selectedVoucher.toDate))}</b>
                  </p>
                </div>
                <div className="text-right">
                  <p>নিষ্পত্তির তারিখ: <b>{getBengaliDateLabel(new Date(selectedVoucher.createdAt))}</b></p>
                  <p className="mt-1">সম্পাদনকারী: <b>{selectedVoucher.settledByName}</b></p>
                </div>
              </div>

              {/* Financial Statement Table */}
              <table className="w-full text-xs border-collapse border border-black mb-4">
                <tbody>
                  <tr className="bg-slate-100 font-bold border-b border-black">
                    <td className="p-2 border-r border-black" colSpan={2}>
                      ১. মোট আয় (Total Income)
                    </td>
                    <td className="p-2 text-right">
                      {formatBnCurrency(selectedVoucher.totalIncome)}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-1.5 pl-6 border-r border-black" colSpan={2}>
                      - ধান ছাটাই বিল বাবদ আয়
                    </td>
                    <td className="p-1.5 text-right font-medium">
                      {formatBnCurrency(selectedVoucher.totalMillingIncome)}
                    </td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-1.5 pl-6 border-r border-black" colSpan={2}>
                      - ভুষি ও কুঁড়া বিক্রয় বাবদ আয়
                    </td>
                    <td className="p-1.5 text-right font-medium">
                      {formatBnCurrency(selectedVoucher.totalByproductIncome)}
                    </td>
                  </tr>

                  <tr className="bg-slate-100 font-bold border-b border-black">
                    <td className="p-2 border-r border-black" colSpan={2}>
                      ২. মোট ব্যয় (Total Expense)
                    </td>
                    <td className="p-2 text-right">
                      {formatBnCurrency(selectedVoucher.totalExpense)}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-1.5 pl-6 border-r border-black" colSpan={2}>
                      - মিল ভাড়া বাবদ ব্যয়
                    </td>
                    <td className="p-1.5 text-right font-medium">
                      {formatBnCurrency(selectedVoucher.totalRentExpense)}
                    </td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-1.5 pl-6 border-r border-black" colSpan={2}>
                      - বিদ্যুৎ, লেবার, বেতন ও পরিচালনা ব্যয়
                    </td>
                    <td className="p-1.5 text-right font-medium">
                      {formatBnCurrency(selectedVoucher.totalOtherExpense)}
                    </td>
                  </tr>

                  {/* Net Profit / Loss */}
                  <tr className="bg-slate-200 font-black text-sm border-b-2 border-black">
                    <td className="p-2.5 border-r border-black" colSpan={2}>
                      {selectedVoucher.netProfit >= 0
                        ? "সর্বমোট নিট লাভ (Net Profit):"
                        : "সর্বমোট নিট লোকসান (Net Loss):"}
                    </td>
                    <td className="p-2.5 text-right">
                      {formatBnCurrency(Math.abs(selectedVoucher.netProfit))}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 50:50 Distribution Summary Table */}
              <div className="border border-black p-3 mb-6 bg-slate-50 text-xs">
                <p className="font-bold text-center border-b border-black pb-1 mb-2 uppercase">
                  অংশীদারদের মধ্যে ৫০% : ৫০% বণ্টনের সারসংক্ষেপ
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border-r border-slate-300 pr-2">
                    <p className="font-bold">অংশীদার ১ (মালিক): {selectedVoucher.partner1Name}</p>
                    <p className="mt-0.5">অংশ: {toBn(selectedVoucher.partner1Share)}%</p>
                    <p className="mt-1 font-black text-sm">
                      {selectedVoucher.netProfit >= 0 ? "পাওনা লভ্যাংশ:" : "লোকসান দায়ভার:"}{" "}
                      {formatBnCurrency(Math.abs(selectedVoucher.partner1Amount))}
                    </p>
                  </div>
                  <div>
                    <p className="font-bold">অংশীদার ২: {selectedVoucher.partner2Name}</p>
                    <p className="mt-0.5">অংশ: {toBn(selectedVoucher.partner2Share)}%</p>
                    <p className="mt-1 font-black text-sm">
                      {selectedVoucher.netProfit >= 0 ? "পাওনা লভ্যাংশ:" : "লোকসান দায়ভার:"}{" "}
                      {formatBnCurrency(Math.abs(selectedVoucher.partner2Amount))}
                    </p>
                  </div>
                </div>
                {selectedVoucher.notes && (
                  <p className="mt-2 text-[11px] text-slate-700 pt-1 border-t border-slate-300">
                    মন্তব্য/নোট: {selectedVoucher.notes}
                  </p>
                )}
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-12 pt-16 text-center text-xs">
                <div>
                  <div className="border-t border-black pt-1 font-bold">
                    {selectedVoucher.partner1Name} (মালিক)
                  </div>
                  <span className="text-[10px] text-slate-600">অংশীদার ১ এর স্বাক্ষর</span>
                </div>
                <div>
                  <div className="border-t border-black pt-1 font-bold">
                    {selectedVoucher.partner2Name}
                  </div>
                  <span className="text-[10px] text-slate-600">অংশীদার ২ এর স্বাক্ষর</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
}
