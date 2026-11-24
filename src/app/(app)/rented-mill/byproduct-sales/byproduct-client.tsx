"use client";

import { useState } from "react";
import { createByproductSaleAction } from "@/server/actions/rented-mill";
import type { RentedMillRole } from "@/lib/rented-mill-types";
import { formatBnCurrency } from "@/lib/format";

export function ByproductSaleClient({ role }: { role?: RentedMillRole }) {
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (role === "PARTNER") {
    return null;
  }

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [productType, setProductType] = useState("ভুষি");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [quantity, setQuantity] = useState<number | "">("");
  const [unit, setUnit] = useState("কেজি");
  const [rate, setRate] = useState<number | "">("");
  const [paidAmount, setPaidAmount] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  const q = typeof quantity === "number" ? quantity : 0;
  const r = typeof rate === "number" ? rate : 0;
  const total = Math.round(q * r);
  const paid = typeof paidAmount === "number" ? paidAmount : 0;
  const due = Math.max(0, total - paid);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("customerName", customerName);
    fd.append("customerPhone", customerPhone);
    fd.append("productType", productType);
    fd.append("date", date);
    fd.append("quantity", String(q));
    fd.append("unit", unit);
    fd.append("rate", String(r));
    fd.append("paidAmount", String(paid));
    fd.append("notes", notes);

    try {
      const res = await createByproductSaleAction(fd);
      if (res.ok) {
        setShowModal(false);
        setCustomerName("");
        setCustomerPhone("");
        setQuantity("");
        setRate("");
        setPaidAmount("");
        setNotes("");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "বিক্রয় সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErrorMsg(null);
          setShowModal(true);
        }}
        className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm"
      >
        <span>➕</span> নতুন ভুষি / কুঁড়া বিক্রয় এন্ট্রি
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base sm:text-lg font-bold text-ink-900">
                ভুষি / কুঁড়া বিক্রয় এন্ট্রি
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
                <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {errorMsg}
                </div>
              )}

              {/* ক্রেতার নাম ও মোবাইল */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    ক্রেতার নাম <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: মোজাম্মেল হক"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    মোবাইল নম্বর (ঐচ্ছিক)
                  </label>
                  <input
                    type="text"
                    placeholder="017xxxxxxxx"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* পণ্যের ধরন ও তারিখ */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    পণ্যের নাম / ধরন <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-semibold"
                  >
                    <option value="ভুষি">ভুষি (Rice Husk / Bran)</option>
                    <option value="কুঁড়া">কুঁড়া (Polish / Bran)</option>
                    <option value="অন্যান্য উপজাত">অন্যান্য উপজাত</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    বিক্রয় তারিখ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* পরিমাণ ও একক */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    পরিমাণ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="যেমন: ৫০০"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    একক <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  >
                    <option value="কেজি">কেজি (KG)</option>
                    <option value="বস্তা">বস্তা (Bags)</option>
                    <option value="মণ">মণ (Maund)</option>
                  </select>
                </div>
              </div>

              {/* দর ও মোট টাকা */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    দর (প্রতি {unit}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="যেমন: ২৮"
                    value={rate}
                    onChange={(e) => setRate(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    মোট টাকা
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={formatBnCurrency(total)}
                    className="w-full rounded-md border border-rule bg-slate-100 px-3 py-2 text-xs font-bold text-ink-900"
                  />
                </div>
              </div>

              {/* নগদ জমা ও বাকি */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    প্রাপ্ত নগদ টাকা (Paid)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="টাকা লিখুন"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    বাকি (Due)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={formatBnCurrency(due)}
                    className="w-full rounded-md border border-rule bg-slate-100 px-3 py-2 text-xs font-bold text-red-700"
                  />
                </div>
              </div>

              {/* মন্তব্য */}
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  মন্তব্য / নোট
                </label>
                <input
                  type="text"
                  placeholder="যেমন: নগদ পরিশোধিত"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
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
                disabled={isSubmitting}
                className="btn-primary text-xs font-semibold"
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "বিক্রয় সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
