"use client";

import { useState } from "react";
import Link from "next/link";
import { createPartyPaymentAction } from "@/server/actions/rented-mill";
import type { RentedMillRole } from "@/lib/rented-mill-types";

interface PartyOption {
  id: string;
  name: string;
  phone: string | null;
  isSelfParty: boolean;
}

export function MillingBillsClient({
  parties,
  role,
}: {
  parties: PartyOption[];
  role?: RentedMillRole;
}) {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (role === "PARTNER") {
    return null;
  }

  // Payment modal state
  const [paymentPartyId, setPaymentPartyId] = useState(parties[0]?.id || "");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentAmount, setPaymentAmount] = useState<number | "">("");
  const [paymentMethod, setPaymentMethod] = useState("নগদ");
  const [paymentNotes, setPaymentNotes] = useState("");

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", paymentPartyId);
    fd.append("date", paymentDate);
    fd.append("amount", String(paymentAmount || 0));
    fd.append("paymentMethod", paymentMethod);
    fd.append("notes", paymentNotes);

    try {
      const res = await createPartyPaymentAction(fd);
      if (res.ok) {
        setShowPaymentModal(false);
        setPaymentAmount("");
        setPaymentNotes("");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "পেমেন্ট সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* সহায়ক বাটন: সরাসরি ধান প্রাপ্তি (অটো বিলসহ) পেজে যাওয়ার লিংক */}
        <Link
          href="/rented-mill/reports/paddy-receipt"
          className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm shadow-xs"
        >
          <span>🌾 ➕</span>
          <span>+ নতুন ধান প্রাপ্তি (অটো বিলসহ)</span>
        </Link>

        {/* বকেয়া টাকা জমা / আদায় বাটন */}
        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setShowPaymentModal(true);
          }}
          className="btn-outline flex items-center gap-1.5 text-xs sm:text-sm"
        >
          <span>💵</span>
          <span>বকেয়া টাকা জমা / আদায়</span>
        </button>
      </div>

      {/* বকেয়া টাকা জমা / আদায় মডাল */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handlePaymentSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base sm:text-lg font-bold text-ink-900">
                পার্টির বকেয়া টাকা আদায় / জমা
              </h3>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
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

              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  পার্টি নির্বাচন <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={paymentPartyId}
                  onChange={(e) => setPaymentPartyId(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
                >
                  <option value="">-- পার্টি নির্বাচন করুন --</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isSelfParty ? "(নিজেদের পার্টি)" : ""} {p.phone ? `(${p.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  জমার তারিখ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  জমার পরিমাণ (টাকা) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  required
                  placeholder="যেমন: ৫০০০"
                  value={paymentAmount}
                  onChange={(e) =>
                    setPaymentAmount(e.target.value === "" ? "" : parseFloat(e.target.value))
                  }
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-ink-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  পেমেন্ট মাধ্যম
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                >
                  <option value="নগদ">নগদ (Cash)</option>
                  <option value="ব্যাংক">ব্যাংক (Bank)</option>
                  <option value="বিকাশ/নগদ">বিকাশ / নগদ মোবাইল ব্যাংকিং</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  বিবরণ / নোট
                </label>
                <input
                  type="text"
                  placeholder="যেমন: ধান ছাটাই বিল বাবদ পরিশোধ"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
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
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "জমা সম্পন্ন করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
