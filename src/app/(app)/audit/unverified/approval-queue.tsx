"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { useT } from "@/components/lang";
import { bulkVerifyVouchersAction, verifyVoucherAction } from "@/server/actions/verification";

export interface UnverifiedVoucherItem {
  id: string;
  voucherNo: string;
  type: string;
  typeLabel: string;
  date: string;
  amount: number;
  narration: string | null;
  reference: string | null;
  partyName: string | null;
  creatorName: string | null;
  cashOrBankName: string | null;
}

interface ApprovalQueueProps {
  initialVouchers: UnverifiedVoucherItem[];
  currency?: string;
  currentUserName?: string | null;
}

export function ApprovalQueue({
  initialVouchers,
  currency = "৳",
  currentUserName,
}: ApprovalQueueProps) {
  const t = useT();
  const router = useRouter();
  const [items, setItems] = useState<UnverifiedVoucherItem[]>(initialVouchers);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  // Reject modal state (for single or bulk)
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const allIds = useMemo(() => items.map((i) => i.id), [items]);
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleVerifySingle = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;

    // Optimistic UI update: remove item from current queue
    setItems((prev) => prev.filter((item) => item.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    startTransition(async () => {
      const res = await verifyVoucherAction({ voucherId: id, status: "VERIFIED" });
      if (!res.ok) {
        alert(res.message || t("ভেরিফিকেশন সম্পন্ন করা সম্ভব হয়নি"));
        router.refresh();
      }
    });
  };

  const openRejectSingle = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRejectTargetId(id);
    setRejectNote("");
    setShowRejectModal(true);
  };

  const openRejectBulk = () => {
    setRejectTargetId(null);
    setRejectNote("");
    setShowRejectModal(true);
  };

  const handleRejectConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const note = rejectNote.trim();
    setShowRejectModal(false);

    if (rejectTargetId) {
      // Single Reject
      const id = rejectTargetId;
      setItems((prev) => prev.filter((item) => item.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      startTransition(async () => {
        const res = await verifyVoucherAction({ voucherId: id, status: "REJECTED", note });
        if (!res.ok) {
          alert(res.message || t("বাতিলকরণ সম্পন্ন করা সম্ভব হয়নি"));
          router.refresh();
        }
      });
    } else {
      // Bulk Reject
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      setItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());

      startTransition(async () => {
        const res = await bulkVerifyVouchersAction({ voucherIds: ids, status: "REJECTED", note });
        if (!res.ok) {
          alert(res.message || t("বাল্ক অ্যাকশন সম্পন্ন করা সম্ভব হয়নি"));
          router.refresh();
        }
      });
    }
  };

  const handleBulkVerify = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || isPending) return;

    // Optimistically remove from queue
    setItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
    setSelectedIds(new Set());

    startTransition(async () => {
      const res = await bulkVerifyVouchersAction({ voucherIds: ids, status: "VERIFIED" });
      if (!res.ok) {
        alert(res.message || t("বাল্ক অনুমোদন সম্পন্ন করা সম্ভব হয়নি"));
        router.refresh();
      }
    });
  };

  const getTypeBadgeClass = (rawType: string, label?: string) => {
    const combined = `${rawType || ""} ${label || ""}`.toLowerCase();
    if (combined.includes("depot") || combined.includes("delivery") || combined.includes("ডিপো") || combined.includes("ডিও") || combined.includes("চালান")) {
      return "bg-indigo-100 text-indigo-800 border-indigo-300";
    }
    if (combined.includes("production") || combined.includes("উৎপাদন")) {
      return "bg-teal-100 text-teal-800 border-teal-300";
    }
    if (combined.includes("sales") || combined.includes("বিক্রয়")) {
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    }
    if (combined.includes("purchase") || combined.includes("ক্রয়")) {
      return "bg-blue-100 text-blue-800 border-blue-300";
    }
    if (combined.includes("receipt") || combined.includes("আদায়") || combined.includes("প্রাপ্তি")) {
      return "bg-green-100 text-green-800 border-green-300";
    }
    if (combined.includes("payment") || combined.includes("পরিশোধ")) {
      return "bg-amber-100 text-amber-800 border-amber-300";
    }
    if (combined.includes("return") || combined.includes("ফেরত")) {
      return "bg-purple-100 text-purple-800 border-purple-300";
    }
    return "bg-slate-100 text-slate-800 border-slate-300";
  };

  if (items.length === 0) {
    return (
      <div className="card my-8 p-12 text-center border-2 border-dashed border-emerald-300 bg-emerald-50/40 rounded-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
          🎉
        </div>
        <h3 className="mt-4 text-xl font-bold text-slate-900">
          {t("কোনো অপেক্ষমাণ লেনদেন নেই!")}
        </h3>
        <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
          {t("সকল লেনদেন যাচাই ও অনুমোদিত রয়েছে। নতুন কোনো লেনদেন এন্ট্রি হলে এখানে জমা হবে।")}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link prefetch={false} href="/dashboard" className="btn-primary">
            <span>← {t("ড্যাশবোর্ডে ফিরে যান")}</span>
          </Link>
          <Link prefetch={false} href="/reports/daily-cash" className="btn-secondary">
            <span>{t("ক্যাশ বুক দেখুন")}</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Top Selection / Action Header ── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 font-semibold text-slate-800 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleToggleSelectAll}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
            />
            <span>{t("সব বাছাই করুন")}</span>
          </label>
          <span className="text-xs text-slate-500 font-medium">
            ({toBnDigits(items.length)} {t("টি বাকি")})
          </span>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              {toBnDigits(selectedIds.size)} {t("টি নির্বাচিত")}
            </span>
            <button
              type="button"
              onClick={handleBulkVerify}
              disabled={isPending}
              className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3.5 py-1.5 font-bold flex items-center gap-1.5 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span>✓</span>
              <span>{t("সবগুলো একসাথে অনুমোদন")}</span>
            </button>
            <button
              type="button"
              onClick={openRejectBulk}
              disabled={isPending}
              className="btn-danger bg-rose-600 hover:bg-rose-700 text-white text-xs px-3 py-1.5 font-bold flex items-center gap-1 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span>✕</span>
              <span>{t("রিজেক্ট")}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-500 hover:text-slate-800 underline px-1.5 py-1"
            >
              {t("বাতিল")}
            </button>
          </div>
        )}
      </div>

      {/* ── Desktop Table View ── */}
      <div className="overflow-x-auto hidden md:block rounded-xl border border-slate-200 bg-white shadow-2xs">
        <table className="table w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-700">
              <th className="w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
                  title={t("সব বাছাই করুন")}
                />
              </th>
              <th>{t("তারিখ")}</th>
              <th>{t("ভাউচার")}</th>
              <th>{t("ধরন")}</th>
              <th>{t("পার্টি / হিসাব")}</th>
              <th>{t("বিবরণ / নোট")}</th>
              <th>{t("এন্ট্রি করেছেন")}</th>
              <th className="num text-right">{t("মোট টাকা")}</th>
              <th className="text-center w-36">{t("দ্রুত অ্যাকশন")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const isSelected = selectedIds.has(item.id);
              return (
                <tr
                  key={item.id}
                  className={`transition-colors hover:bg-slate-50/80 ${
                    isSelected ? "bg-amber-50/70" : ""
                  }`}
                >
                  <td className="w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => handleToggleSelect(item.id, e as any)}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
                    />
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-700">
                    {formatDate(item.date)}
                  </td>
                  <td>
                    <Link
                      prefetch={false}
                      href={`/vouchers/v/${item.id}`}
                      className="font-mono font-bold text-brand-700 hover:underline text-xs"
                    >
                      {item.voucherNo}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold border ${getTypeBadgeClass(
                        item.type,
                        item.typeLabel
                      )}`}
                    >
                      {item.typeLabel}
                    </span>
                  </td>
                  <td className="text-sm font-semibold text-slate-800">
                    {item.partyName || item.cashOrBankName || "—"}
                  </td>
                  <td className="text-xs text-slate-500 max-w-[200px] truncate" title={item.narration || item.reference || ""}>
                    {item.narration || item.reference || "—"}
                  </td>
                  <td className="text-xs text-slate-600 font-medium">
                    {item.creatorName || t("অ্যাডমিন")}
                  </td>
                  <td className="num font-bold text-slate-900 text-right tabular-nums">
                    {formatMoney(item.amount, currency)}
                  </td>
                  <td className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => handleVerifySingle(item.id, e)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-1 rounded-md text-xs font-bold transition shadow-2xs hover:shadow-xs disabled:opacity-50 cursor-pointer"
                        title={t("এক ক্লিকে অনুমোদন (Verify)")}
                      >
                        <span>✓</span>
                        <span>{t("অনুমোদন")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => openRejectSingle(item.id, e)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-1 rounded-md text-xs font-semibold transition shadow-2xs hover:shadow-xs disabled:opacity-50 cursor-pointer"
                        title={t("বাতিল / রিজেক্ট (Reject)")}
                      >
                        <span>✕</span>
                        <span>{t("রিজেক্ট")}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile View: Compact Responsive Cards ── */}
      <div className="block md:hidden divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        {items.map((item) => {
          const isSelected = selectedIds.has(item.id);
          return (
            <div
              key={item.id}
              className={`p-3.5 space-y-2.5 transition-colors ${
                isSelected ? "bg-amber-50/70" : "bg-white"
              }`}
            >
              {/* Row 1: Checkbox + Badge + Date | Amount */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => handleToggleSelect(item.id, e as any)}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4 shrink-0"
                  />
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold border shrink-0 ${getTypeBadgeClass(
                      item.type,
                      item.typeLabel
                    )}`}
                  >
                    {item.typeLabel}
                  </span>
                  <span className="text-xs text-slate-500 truncate">{formatDate(item.date)}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-base font-extrabold text-slate-900 tabular-nums">
                    {formatMoney(item.amount, currency)}
                  </span>
                </div>
              </div>

              {/* Row 2: Voucher No + Party/Account */}
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    prefetch={false}
                    href={`/vouchers/v/${item.id}`}
                    className="font-mono font-bold text-brand-700 hover:underline text-xs"
                  >
                    {item.voucherNo}
                  </Link>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-slate-800 truncate text-xs sm:text-sm">
                    {item.partyName || item.cashOrBankName || "—"}
                  </span>
                </div>
                <span className="text-xs text-slate-500 shrink-0">
                  {item.creatorName || t("অ্যাডমিন")}
                </span>
              </div>

              {/* Row 3: Narration (if any) */}
              {(item.narration || item.reference) && (
                <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-100">
                  {item.narration || item.reference}
                </p>
              )}

              {/* Row 4: Quick Action Buttons */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={(e) => handleVerifySingle(item.id, e)}
                  disabled={isPending}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3.5 py-1.5 font-bold flex items-center gap-1 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <span>✓</span>
                  <span>{t("অনুমোদন")}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => openRejectSingle(item.id, e)}
                  disabled={isPending}
                  className="btn-danger bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 text-xs px-3 py-1.5 font-semibold flex items-center gap-1 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <span>✕</span>
                  <span>{t("রিজেক্ট")}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Floating Bulk Action Toolbar (When 1 or more items are selected) ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex flex-wrap items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-5 border border-slate-700 max-w-[95vw]">
          <div className="flex items-center gap-2 shrink-0">
            <span className="bg-emerald-600 text-white font-bold text-xs px-2.5 py-1 rounded-full tabular-nums">
              {toBnDigits(selectedIds.size)}
            </span>
            <span className="text-xs sm:text-sm font-medium text-slate-200">
              {t("টি লেনদেন নির্বাচিত")}
            </span>
          </div>

          <div className="h-4 w-px bg-slate-700 hidden sm:block shrink-0" />

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleBulkVerify}
              disabled={isPending}
              className="btn-primary bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3.5 py-1.5 font-bold flex items-center gap-1.5 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span>✓</span>
              <span>{t("সবগুলো একসাথে অনুমোদন")}</span>
            </button>

            <button
              type="button"
              onClick={openRejectBulk}
              disabled={isPending}
              className="btn-danger bg-rose-600 hover:bg-rose-500 text-white text-xs px-3 py-1.5 font-bold flex items-center gap-1.5 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span>✕</span>
              <span>{t("রিজেক্ট")}</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 underline cursor-pointer"
            >
              {t("বাছাই বাতিল")}
            </button>
          </div>
        </div>
      )}

      {/* ── Reject Modal (Single or Bulk) ── */}
      {showRejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={() => setShowRejectModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-ink-900 flex items-center gap-1.5 text-rose-700">
                <span>✕</span>
                <span>
                  {rejectTargetId
                    ? t("লেনদেন বাতিল / রিজেক্ট")
                    : t("একসাথে {0} টি লেনদেন রিজেক্ট", { 0: selectedIds.size })}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRejectConfirm} className="pt-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t("বাতিলের কারণ বা অডিট নোট (ঐচ্ছিক)")}
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder={t("যেমন: টাকার পরিমাণে অমিল, অপ্রয়োজনীয় এন্ট্রি ইত্যাদি...")}
                  className="input w-full text-xs p-2.5 h-20 resize-none border border-slate-300 focus:border-rose-500 rounded-md"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="btn-ghost text-xs px-3 py-1.5"
                >
                  {t("বাতিল")}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-danger text-xs px-3.5 py-1.5 font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-xs disabled:opacity-50"
                >
                  {isPending ? t("প্রক্রিয়াকরণ...") : t("রিজেক্ট নিশ্চিত করুন")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
