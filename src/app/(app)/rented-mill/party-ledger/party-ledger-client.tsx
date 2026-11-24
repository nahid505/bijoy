"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPartyPaymentAction } from "@/server/actions/rented-mill";
import type { RentedMillRole } from "@/lib/rented-mill-types";
import { formatBnCurrency } from "@/lib/format";

export interface PartyOption {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  isSelfParty: boolean;
  currentStock: number;
  totalDue: number;
}

export function PartyLedgerClient({
  parties,
  selectedPartyId,
  role,
}: {
  parties: PartyOption[];
  selectedPartyId?: string;
  role?: RentedMillRole;
}) {
  const router = useRouter();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Payment form states
  const [targetPartyId, setTargetPartyId] = useState(selectedPartyId || (parties[0]?.id ?? ""));
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState<number | "">("");
  const [paymentMethod, setPaymentMethod] = useState("নগদ");
  const [notes, setNotes] = useState("");

  const activeParty = parties.find((p) => p.id === (selectedPartyId || targetPartyId));

  function handlePartyChange(newId: string) {
    if (!newId) {
      router.push("/rented-mill/party-ledger");
    } else {
      router.push(`/rented-mill/party-ledger?partyId=${newId}`);
    }
  }

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetPartyId) {
      setErrorMsg("অনুগ্রহ করে একটি পার্টি নির্বাচন করুন।");
      return;
    }
    const payAmt = typeof amount === "number" ? amount : 0;
    if (payAmt <= 0) {
      setErrorMsg("আদায়ের পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", targetPartyId);
    fd.append("date", date);
    fd.append("amount", String(payAmt));
    fd.append("paymentMethod", paymentMethod);
    fd.append("notes", notes);

    try {
      const res = await createPartyPaymentAction(fd);
      if (res.ok) {
        setShowPaymentModal(false);
        setAmount("");
        setNotes("");
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "পেমেন্ট সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-white p-4 shadow-xs">
        {/* Left: Party Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="party-select" className="text-xs sm:text-sm font-bold text-ink-800">
            পার্টি নির্বাচন করুন:
          </label>
          <select
            id="party-select"
            value={selectedPartyId || ""}
            onChange={(e) => handlePartyChange(e.target.value)}
            className="input text-xs sm:text-sm py-1.5 px-3 min-w-[220px] font-medium"
          >
            <option value="">-- সকল পার্টির সার্বিক খতিয়ান --</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.phone ? `(${p.phone})` : ""} {p.totalDue > 0 ? `· বাকি: ৳${p.totalDue}` : ""}
              </option>
            ))}
          </select>

          {selectedPartyId && (
            <button
              type="button"
              onClick={() => handlePartyChange("")}
              className="text-xs text-brand-600 hover:underline font-semibold ml-1"
            >
              ✕ ফিল্টার মুছুন (সকল পার্টি)
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {role !== "PARTNER" && (
            <button
              type="button"
              onClick={() => {
                if (selectedPartyId) {
                  setTargetPartyId(selectedPartyId);
                }
                setErrorMsg(null);
                setShowPaymentModal(true);
              }}
              className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm shadow-xs"
            >
              <span>💰</span> + টাকা গ্রহণ (বিল আদায়)
            </button>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="btn-outline flex items-center gap-1.5 text-xs sm:text-sm"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            প্রিন্ট খতিয়ান (Print A4)
          </button>
        </div>
      </div>

      {/* Money Receipt / Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handlePaymentSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-ink-900 flex items-center gap-2">
                <span>💰</span> বকেয়া বিল আদায় / টাকা গ্রহণ
              </h3>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="text-ink-400 hover:text-ink-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-3.5 text-xs sm:text-sm">
              {errorMsg && (
                <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="mb-1 block font-semibold text-ink-700">পার্টি নির্বাচন *</label>
                <select
                  value={targetPartyId}
                  onChange={(e) => setTargetPartyId(e.target.value)}
                  className="input w-full"
                  required
                >
                  <option value="">পার্টি নির্বাচন করুন</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.phone ? `(${p.phone})` : ""} · বর্তমান বাকি: {formatBnCurrency(p.totalDue)}
                    </option>
                  ))}
                </select>
                {activeParty && (
                  <p className="mt-1 text-[11px] text-amber-700 font-semibold">
                    বর্তমান মোট বাকি: {formatBnCurrency(activeParty.totalDue)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">আদায়ের তারিখ *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-ink-700">আদায়ের মাধ্যম</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="input w-full"
                  >
                    <option value="নগদ">নগদ (Cash)</option>
                    <option value="ব্যাংক">ব্যাংক একাউন্ট</option>
                    <option value="বিকাশ">বিকাশ (bKash)</option>
                    <option value="নগদ/মোবাইল">অন্যান্য মোবাইল ব্যাংকিং</option>
                    <option value="চেক">চেক</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">টাকার পরিমাণ (৳) *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  placeholder="যেমন: ৫০০০"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
                  className="input w-full font-bold text-emerald-800 text-base"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">মন্তব্য / রেফারেন্স নোট</label>
                <input
                  type="text"
                  placeholder="যেমন: রশিদ নং বা চেকের বিবরণ"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input w-full"
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
                className="btn-primary text-xs"
                disabled={isSubmitting}
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "টাকা গ্রহণ নিশ্চিত করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
