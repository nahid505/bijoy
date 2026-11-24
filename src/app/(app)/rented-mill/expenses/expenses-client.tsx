"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRentedMillExpenseAction } from "@/server/actions/rented-mill";
import {
  EXPENSE_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  type RentedMillRole,
} from "@/lib/rented-mill-types";
import { formatBnCurrency } from "@/lib/format";
import { ExpenseCategoryModal } from "../expense-category-modal";

export function ExpensesClient({
  role,
  monthlyRent,
  expenseCategories = DEFAULT_EXPENSE_CATEGORIES,
}: {
  role?: RentedMillRole;
  monthlyRent: number;
  expenseCategories?: string[];
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (role === "PARTNER") {
    return null;
  }

  const [categoryList, setCategoryList] = useState<string[]>(
    expenseCategories && expenseCategories.length > 0
      ? expenseCategories
      : [...DEFAULT_EXPENSE_CATEGORIES]
  );
  const [category, setCategory] = useState<string>(
    expenseCategories && expenseCategories.length > 0
      ? expenseCategories[0]
      : EXPENSE_CATEGORIES[0]
  );
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState<number | "">(monthlyRent);
  const [description, setDescription] = useState("");
  const [paidTo, setPaidTo] = useState("");

  function handleCategoryChange(cat: string) {
    setCategory(cat);
    if (cat === "মাসিক মিল ভাড়া") {
      setAmount(monthlyRent);
      if (!description) setDescription("চলতি মাসের মিল ভাড়া পরিশোধ");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = typeof amount === "number" ? amount : parseFloat(String(amount || "0")) || 0;
    if (amt <= 0) {
      setErrorMsg("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("category", category);
    fd.append("date", date);
    fd.append("amount", String(amt));
    fd.append("description", description);
    fd.append("paidTo", paidTo);

    try {
      const res = await createRentedMillExpenseAction(fd);
      if (res.ok) {
        setSuccessMsg(res.message);
        setShowModal(false);
        setDescription("");
        setPaidTo("");
        setAmount(monthlyRent);
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "খরচ সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {successMsg && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 border border-emerald-200 shadow-2xs">
            <div className="flex items-center gap-1.5">
              <span>✅</span>
              <span>{successMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold text-sm"
            >
              ✕
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setCategory(categoryList[0] || "মাসিক মিল ভাড়া");
            setAmount(monthlyRent);
            setDescription("চলতি মাসের মিল ভাড়া পরিশোধ");
            setShowModal(true);
          }}
          className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm"
        >
          <span>➕</span> নতুন খরচ / মিল ভাড়া এন্ট্রি
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            id="expense-modal-form"
            onSubmit={handleSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base sm:text-lg font-bold text-ink-900 flex items-center gap-2">
                <span>💸</span> মিল ভাড়া ও খরচ এন্ট্রি
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-4">
              {errorMsg && (
                <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700 border border-red-200 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>{errorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMsg(null)}
                    className="text-red-500 hover:text-red-800 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* খরচের খাত নির্বাচন */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-ink-800">
                    খরচের খাত <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    className="text-[11px] text-rose-600 font-semibold hover:underline flex items-center gap-1"
                  >
                    <span>➕</span> নতুন খতিয়ান
                  </button>
                </div>
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-semibold text-ink-900 focus:border-brand-500 focus:outline-none"
                >
                  {categoryList.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat} {cat === "মাসিক মিল ভাড়া" ? `(ডিফল্ট ${formatBnCurrency(monthlyRent)})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* তারিখ ও টাকার পরিমাণ */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    খরচের তারিখ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    টাকার পরিমাণ (৳) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    required
                    placeholder="টাকা লিখুন"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-ink-900 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* কাকে দেওয়া হলো */}
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  প্রাপক / কাকে পরিশোধ করা হলো (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: মিল মালিক / বিদ্যুৎ অফিস / সর্দার"
                  value={paidTo}
                  onChange={(e) => setPaidTo(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>

              {/* বিস্তারিত বিবরণ */}
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  বিবরণ / নোট
                </label>
                <textarea
                  rows={2}
                  placeholder="খরচের বিস্তারিত তথ্য লিখুন..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-outline text-xs"
                disabled={isSubmitting}
              >
                বাতিল
              </button>
              <button
                type="submit"
                form="expense-modal-form"
                disabled={isSubmitting}
                className="btn-primary text-xs font-semibold"
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "খরচ সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* নতুন খরচের খাত যোগ করার মডাল */}
      <ExpenseCategoryModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        currentCategories={categoryList}
        onSaved={(newCategory, updatedList) => {
          setCategoryList(updatedList);
          setCategory(newCategory);
          router.refresh();
        }}
      />
    </>
  );
}
