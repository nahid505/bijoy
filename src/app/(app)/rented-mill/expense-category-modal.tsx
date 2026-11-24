"use client";

import { useState } from "react";
import { addExpenseCategoryAction } from "@/server/actions/rented-mill";

export function ExpenseCategoryModal({
  isOpen,
  onClose,
  currentCategories,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentCategories: string[];
  onSaved: (newCategory: string, updatedList: string[]) => void;
}) {
  const [newCatName, setNewCatName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setErrorMsg("অনুগ্রহ করে খতিয়ানের নাম লিখুন।");
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      const res = await addExpenseCategoryAction(trimmed);
      if (res.ok) {
        onSaved(res.category, res.categories);
        setNewCatName("");
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "খাত যুক্ত করতে সমস্যা হয়েছে।");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header (Fixed) */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4 bg-rose-50/60">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <div>
              <h3 className="text-base font-bold text-rose-950">
                নতুন খরচের খাত / খতিয়ান যোগ
              </h3>
              <p className="text-[11px] text-rose-800">
                মিলের খরচের নতুন খাত তৈরি করুন (যেমন: জেনারেটর ডিজেল, গাড়ি ভাড়া)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Body (Scrollable) */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-4 text-xs sm:text-sm">
            {errorMsg && (
              <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700 border border-red-200 flex items-center justify-between">
                <span>⚠️ {errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="text-red-500 hover:text-red-800 font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            <div>
              <label className="mb-1 block font-semibold text-ink-700 text-xs">
                নতুন খরচের খাতের নাম <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="যেমন: জেনারেটর তেল/ডিজেল, গাড়ি ভাড়া, আপ্যায়ন খরচ"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="input w-full font-bold text-ink-900"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                * এটি সংরক্ষণ করার পর খরচ এন্ট্রি ফর্ম ও খতিয়ান রিপোর্টে সরাসরি যুক্ত হয়ে যাবে।
              </p>
            </div>

            {/* Quick suggested names */}
            <div>
              <label className="mb-1.5 block font-semibold text-slate-600 text-[11px]">
                জনপ্রিয় বা সাধারণ খরচের খাতসমূহ (ক্লিক করে নির্বাচন করুন):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "জেনারেটর তেল / ডিজেল",
                  "গাড়ি ভাড়া / পরিবহন",
                  "আপ্যায়ন খরচ",
                  "অফিস স্টেশনারি",
                  "মেরামত ও রক্ষণাবেক্ষণ",
                  "ট্যাক্স ও লাইসেন্স ফি",
                  "মোবাইল ও ইন্টারনেট",
                ].map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => setNewCatName(sug)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 transition"
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            </div>

            {/* Existing list */}
            <div className="rounded-xl bg-slate-50 border border-rule p-3">
              <span className="text-[11px] font-bold text-slate-600 block mb-1.5">
                বর্তমানে সচল খতিয়ানসমূহ ({currentCategories.length} টি):
              </span>
              <div className="flex flex-wrap gap-1">
                {currentCategories.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Footer (Fixed) */}
          <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="btn-outline text-xs"
              disabled={isSaving}
            >
              বাতিল
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary text-xs font-semibold"
            >
              {isSaving ? "সংরক্ষণ হচ্ছে..." : "খাত যোগ করুন"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
