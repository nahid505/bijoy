"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updatePaddyReceiptAction,
  deletePaddyReceiptAction,
  updateDryerMillingAction,
  deleteDryerMillingAction,
  updatePartyPaymentAction,
  deletePartyPaymentAction,
  updateRentedMillExpenseAction,
  deleteRentedMillExpenseAction,
  updateMillingBillAction,
  deleteMillingBillAction,
  updateByproductSaleAction,
  deleteByproductSaleAction,
} from "@/server/actions/rented-mill";
import {
  type RentedMillRole,
  EXPENSE_CATEGORIES,
  DEFAULT_DRYER_NAMES,
} from "@/lib/rented-mill-types";
import { formatBnCurrency, toBn } from "@/lib/format";

// ─────────────────────────────────────────────────────────────
// Reusable Action Buttons (Edit & Delete) with Role Protection
// ─────────────────────────────────────────────────────────────
export interface EditDeleteActionsProps {
  role?: RentedMillRole;
  status?: "PENDING" | "APPROVED" | "REJECTED" | string;
  onEdit: () => void;
  onDelete: () => Promise<void> | void;
  isDeleting?: boolean;
  deleteConfirmMessage?: string;
  compact?: boolean;
}

export function EditDeleteActions({
  role,
  status = "APPROVED",
  onEdit,
  onDelete,
  isDeleting = false,
  deleteConfirmMessage = "আপনি কি নিশ্চিতভাবে এই এন্ট্রিটি মুছে ফেলতে চান?",
  compact = true,
}: EditDeleteActionsProps) {
  // Partner has strictly read-only access (no edit or delete actions)
  if (!role || role === "PARTNER" || role === "GUEST") {
    return null;
  }

  // Super Admin can edit/delete any entry
  // Accountant can ONLY edit/delete PENDING entries
  const canEditOrDelete =
    role === "SUPER_ADMIN" || (role === "ACCOUNTANT" && status === "PENDING");

  if (!canEditOrDelete) {
    return null;
  }

  async function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(deleteConfirmMessage)) {
      await onDelete();
    }
  }

  function handleEditClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onEdit();
  }

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1 no-print">
        <button
          type="button"
          onClick={handleEditClick}
          title="সম্পাদনা করুন (Edit)"
          className="rounded p-1 text-slate-500 hover:bg-brand-50 hover:text-brand-600 transition"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={isDeleting}
          title="মুছে ফেলুন (Delete)"
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-50"
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
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 no-print">
      <button
        type="button"
        onClick={handleEditClick}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-300 transition"
      >
        <span>✏️</span> সম্পাদনা
      </button>

      <button
        type="button"
        onClick={handleDeleteClick}
        disabled={isDeleting}
        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50/60 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition disabled:opacity-50"
      >
        <span>🗑️</span> {isDeleting ? "মুছছে..." : "মুছুন"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 1. Edit Paddy Receipt Modal (ধান প্রাপ্তি সম্পাদনা)
// ─────────────────────────────────────────────────────────────
export interface PaddyReceiptData {
  id: string;
  receiptNo: string;
  partyId: string;
  date: Date | string;
  receiptTime?: string | null;
  paddyName: string;
  juteBags: number;
  plasticBags: number;
  sklWeight: number; // Gross SKL
  dhaltaKg: number;
  ratePerStandardBag: number;
  notes?: string | null;
}

export function EditPaddyReceiptModal({
  receipt,
  parties,
  isOpen,
  onClose,
  onSuccess,
}: {
  receipt: PaddyReceiptData | null;
  parties: Array<{ id: string; name: string }>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  if (!isOpen || !receipt) return null;

  return (
    <EditPaddyReceiptForm
      key={receipt.id}
      receipt={receipt}
      parties={parties}
      onClose={onClose}
      onSuccess={() => {
        if (onSuccess) onSuccess();
        router.refresh();
      }}
    />
  );
}

function EditPaddyReceiptForm({
  receipt,
  parties,
  onClose,
  onSuccess,
}: {
  receipt: PaddyReceiptData;
  parties: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [partyId, setPartyId] = useState(receipt.partyId);
  const [date, setDate] = useState(
    typeof receipt.date === "string"
      ? receipt.date.split("T")[0]
      : new Date(receipt.date).toISOString().split("T")[0]
  );
  const [receiptTime, setReceiptTime] = useState(receipt.receiptTime || "");
  const [paddyName, setPaddyName] = useState(receipt.paddyName || "ব্রি-২৮");
  const [juteBags, setJuteBags] = useState<number | "">(receipt.juteBags ?? 0);
  const [plasticBags, setPlasticBags] = useState<number | "">(receipt.plasticBags ?? 0);
  const [sklWeight, setSklWeight] = useState<number | "">(receipt.sklWeight ?? 0);
  const [manualDhalta, setManualDhalta] = useState<number | "">(receipt.dhaltaKg ?? 0);
  const [ratePerStandardBag, setRatePerStandardBag] = useState<number | "">(
    receipt.ratePerStandardBag ?? 100
  );
  const [notes, setNotes] = useState(receipt.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Calculations
  const jBags = typeof juteBags === "number" ? juteBags : 0;
  const pBags = typeof plasticBags === "number" ? plasticBags : 0;
  const totalBags = jBags + pBags;
  const grossWeight = typeof sklWeight === "number" ? sklWeight : 0;
  const effectiveDhalta = typeof manualDhalta === "number" ? manualDhalta : Number((jBags * 1.5 + pBags * 0.5).toFixed(2));
  const netSklKg = Math.max(0, Number((grossWeight - effectiveDhalta).toFixed(2)));
  const standard75Bags = Number((netSklKg / 75).toFixed(2));
  const rate = typeof ratePerStandardBag === "number" ? ratePerStandardBag : 100;
  const totalBillAmount = Math.round(standard75Bags * rate);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) {
      setErrorMsg("পার্টি নির্বাচন করা আবশ্যক।");
      return;
    }
    if (grossWeight <= 0) {
      setErrorMsg("স্কেল ওজন ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", partyId);
    fd.append("date", date);
    fd.append("receiptTime", receiptTime);
    fd.append("paddyName", paddyName);
    fd.append("juteBags", String(jBags));
    fd.append("plasticBags", String(pBags));
    fd.append("sklWeight", String(grossWeight));
    fd.append("dhaltaKg", String(effectiveDhalta));
    fd.append("ratePerStandardBag", String(rate));
    fd.append("notes", notes);

    try {
      const res = await updatePaddyReceiptAction(receipt.id, fd);
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে ব্যর্থ হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 bg-blue-50/60">
          <div>
            <h3 className="text-base font-bold text-blue-900 flex items-center gap-2">
              <span>🌾</span> ধান প্রাপ্তি রশিদ সম্পাদনা ({receipt.receiptNo})
            </h3>
            <p className="text-xs text-blue-700">চালানের তথ্য ও স্কেল ওজন পরিবর্তন করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Party and Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                পার্টি নির্বাচন *
              </label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="input w-full text-xs"
                required
              >
                <option value="">-- পার্টি নির্বাচন করুন --</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>
          </div>

          {/* Paddy Name and Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ধানের জাত / নাম *
              </label>
              <input
                type="text"
                value={paddyName}
                onChange={(e) => setPaddyName(e.target.value)}
                placeholder="যেমন: ব্রি-২৮, স্বর্ণা, জিরাশাইল"
                className="input w-full text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">সময় (ঐচ্ছিক)</label>
              <input
                type="text"
                value={receiptTime}
                onChange={(e) => setReceiptTime(e.target.value)}
                placeholder="যেমন: ১০:৩০ AM"
                className="input w-full text-xs"
              />
            </div>
          </div>

          {/* Bags Input */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-2">
            <h4 className="text-xs font-bold text-blue-900">বস্তার সংখ্যা ও ধরন</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-ink-700 mb-0.5">
                  চটের বস্তা
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={juteBags}
                  onChange={(e) =>
                    setJuteBags(e.target.value === "" ? "" : parseInt(e.target.value, 10) || 0)
                  }
                  className="input w-full text-xs text-right font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-700 mb-0.5">
                  প্লাস্টিক বস্তা
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={plasticBags}
                  onChange={(e) =>
                    setPlasticBags(e.target.value === "" ? "" : parseInt(e.target.value, 10) || 0)
                  }
                  className="input w-full text-xs text-right font-bold"
                />
              </div>

              <div className="col-span-2 sm:col-span-1 flex flex-col justify-end">
                <div className="rounded-lg bg-blue-100 p-2 text-center">
                  <span className="text-[10px] text-blue-700 block font-semibold">মোট বস্তা</span>
                  <span className="text-sm font-black text-blue-950">{toBn(totalBags)} টি</span>
                </div>
              </div>
            </div>
          </div>

          {/* Scale Weight, Dhalta & Rate */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                মোট SKL ওজন (কেজি) *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={sklWeight}
                onChange={(e) =>
                  setSklWeight(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-black text-ink-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ধলতা বাদ (কেজি)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={manualDhalta}
                onChange={(e) =>
                  setManualDhalta(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right text-amber-900 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                রেট (টাকা/৭৫-কেজি)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={ratePerStandardBag}
                onChange={(e) =>
                  setRatePerStandardBag(
                    e.target.value === "" ? "" : parseFloat(e.target.value) || 0
                  )
                }
                className="input w-full text-xs text-right font-bold"
              />
            </div>
          </div>

          {/* Live Calculated Stats Box */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div>
              <span className="text-[10px] text-emerald-800 font-semibold block">নিট SKL ওজন</span>
              <span className="text-xs sm:text-sm font-black text-emerald-950">
                {toBn(netSklKg.toLocaleString("bn-BD"))} কেজি
              </span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-800 font-semibold block">মণ (৪০ কেজি)</span>
              <span className="text-xs sm:text-sm font-black text-emerald-950">
                {toBn((netSklKg / 40).toFixed(2))} মণ
              </span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-800 font-semibold block">৭৫-কেজি স্ট্যান্ডার্ড</span>
              <span className="text-xs sm:text-sm font-black text-brand-700">
                {toBn(standard75Bags.toFixed(2))} বস্তা
              </span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-800 font-semibold block">স্বয়ংক্রিয় বিল</span>
              <span className="text-xs sm:text-sm font-black text-emerald-900">
                {formatBnCurrency(totalBillAmount)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">মন্তব্য (ঐচ্ছিক)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="গাড়ি নং, চালকের নাম ইত্যাদি"
              className="input w-full text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-outline text-xs"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 text-xs transition disabled:opacity-50"
          >
            {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. Edit Dryer & Milling Modal (ডায়ার ও ছাটাই সম্পাদনা)
// ─────────────────────────────────────────────────────────────
export interface DryerMillingData {
  id: string;
  entryNo: string;
  partyId: string;
  date: Date | string;
  dryerNo: string;
  usedBags: number;
  milledKg: number;
  notes?: string | null;
}

export function EditDryerMillingModal({
  entry,
  parties,
  dryerNames = DEFAULT_DRYER_NAMES,
  isOpen,
  onClose,
  onSuccess,
}: {
  entry: DryerMillingData | null;
  parties: Array<{ id: string; name: string }>;
  dryerNames?: string[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  if (!isOpen || !entry) return null;

  return (
    <EditDryerMillingForm
      key={entry.id}
      entry={entry}
      parties={parties}
      dryerNames={dryerNames}
      onClose={onClose}
      onSuccess={() => {
        if (onSuccess) onSuccess();
        router.refresh();
      }}
    />
  );
}

function EditDryerMillingForm({
  entry,
  parties,
  dryerNames,
  onClose,
  onSuccess,
}: {
  entry: DryerMillingData;
  parties: Array<{ id: string; name: string }>;
  dryerNames: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [partyId, setPartyId] = useState(entry.partyId);
  const [date, setDate] = useState(
    typeof entry.date === "string"
      ? entry.date.split("T")[0]
      : new Date(entry.date).toISOString().split("T")[0]
  );
  const [dryerNo, setDryerNo] = useState(entry.dryerNo);
  const [usedBags, setUsedBags] = useState<number | "">(entry.usedBags ?? 0);
  const [milledKg, setMilledKg] = useState<number | "">(entry.milledKg ?? 0);
  const [notes, setNotes] = useState(entry.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) {
      setErrorMsg("পার্টি নির্বাচন করা আবশ্যক।");
      return;
    }
    const uBags = typeof usedBags === "number" ? usedBags : 0;
    const mKg = typeof milledKg === "number" ? milledKg : 0;
    if (uBags <= 0 && mKg <= 0) {
      setErrorMsg("ব্যবহৃত বস্তা বা ছাটাই ওজন ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", partyId);
    fd.append("date", date);
    fd.append("dryerNo", dryerNo);
    fd.append("usedBags", String(uBags));
    fd.append("milledKg", String(mKg));
    fd.append("notes", notes);

    try {
      const res = await updateDryerMillingAction(entry.id, fd);
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে ব্যর্থ হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 bg-amber-50/60">
          <div>
            <h3 className="text-base font-bold text-amber-900 flex items-center gap-2">
              <span>♨️</span> ডায়ার / ছাটাই এন্ট্রি সম্পাদনা ({entry.entryNo})
            </h3>
            <p className="text-xs text-amber-700">ডায়ার নং ও ব্যবহৃত ধানের বস্তা পরিবর্তন করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              পার্টি নির্বাচন *
            </label>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="input w-full text-xs"
              required
            >
              <option value="">-- পার্টি নির্বাচন করুন --</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">ডায়ার নং *</label>
              <select
                value={dryerNo}
                onChange={(e) => setDryerNo(e.target.value)}
                className="input w-full text-xs"
                required
              >
                {dryerNames.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ব্যবহৃত বস্তা (৭৫-কেজি) *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={usedBags}
                onChange={(e) =>
                  setUsedBags(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ছাটাইকৃত ওজন (কেজি)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={milledKg}
                onChange={(e) =>
                  setMilledKg(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">মন্তব্য (ঐচ্ছিক)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ব্যাচ বিবরণ ইত্যাদি"
              className="input w-full text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-outline text-xs"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 text-xs transition disabled:opacity-50"
          >
            {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. Edit Cash Receive / Payment Modal (রিসিভ ক্যাশ সম্পাদনা)
// ─────────────────────────────────────────────────────────────
export interface PaymentData {
  id: string;
  receiptNo: string;
  partyId: string;
  date: Date | string;
  amount: number;
  paymentMethod: string;
  notes?: string | null;
}

export function EditPaymentModal({
  payment,
  parties,
  isOpen,
  onClose,
  onSuccess,
}: {
  payment: PaymentData | null;
  parties: Array<{ id: string; name: string }>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  if (!isOpen || !payment) return null;

  return (
    <EditPaymentForm
      key={payment.id}
      payment={payment}
      parties={parties}
      onClose={onClose}
      onSuccess={() => {
        if (onSuccess) onSuccess();
        router.refresh();
      }}
    />
  );
}

function EditPaymentForm({
  payment,
  parties,
  onClose,
  onSuccess,
}: {
  payment: PaymentData;
  parties: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [partyId, setPartyId] = useState(payment.partyId);
  const [date, setDate] = useState(
    typeof payment.date === "string"
      ? payment.date.split("T")[0]
      : new Date(payment.date).toISOString().split("T")[0]
  );
  const [amount, setAmount] = useState<number | "">(payment.amount ?? 0);
  const [paymentMethod, setPaymentMethod] = useState(payment.paymentMethod || "নগদ");
  const [notes, setNotes] = useState(payment.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) {
      setErrorMsg("পার্টি নির্বাচন করা আবশ্যক।");
      return;
    }
    const payAmt = typeof amount === "number" ? amount : 0;
    if (payAmt <= 0) {
      setErrorMsg("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", partyId);
    fd.append("date", date);
    fd.append("amount", String(payAmt));
    fd.append("paymentMethod", paymentMethod);
    fd.append("notes", notes);

    try {
      const res = await updatePartyPaymentAction(payment.id, fd);
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে ব্যর্থ হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 bg-emerald-50/60">
          <div>
            <h3 className="text-base font-bold text-emerald-900 flex items-center gap-2">
              <span>💵</span> রিসিভ ক্যাশ এন্ট্রি সম্পাদনা ({payment.receiptNo})
            </h3>
            <p className="text-xs text-emerald-700">টাকা জমা বা আদায়ের তথ্য পরিবর্তন করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              পার্টি নির্বাচন *
            </label>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="input w-full text-xs"
              required
            >
              <option value="">-- পার্টি নির্বাচন করুন --</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">পরিশোধ মাধ্যম</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="input w-full text-xs"
              >
                <option value="নগদ">নগদ</option>
                <option value="ব্যাংক">ব্যাংক</option>
                <option value="বিকাশ">বিকাশ</option>
                <option value="নগদ রকেট">নগদ / রকেট</option>
                <option value="চেক">চেক</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              টাকার পরিমাণ (টাকা) *
            </label>
            <input
              type="number"
              min="1"
              step="any"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
              }
              className="input w-full text-xs font-black text-emerald-800 text-right"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">মন্তব্য (ঐচ্ছিক)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ব্যাংক স্লিপ নং বা বিবরণ"
              className="input w-full text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-outline text-xs"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 text-xs transition disabled:opacity-50"
          >
            {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4. Edit Expense Modal (পেমেন্ট ও খরচ সম্পাদনা)
// ─────────────────────────────────────────────────────────────
export interface ExpenseData {
  id: string;
  expenseNo: string;
  category: string;
  date: Date | string;
  amount: number;
  description?: string | null;
  paidTo?: string | null;
}

export function EditExpenseModal({
  expense,
  isOpen,
  onClose,
  onSuccess,
}: {
  expense: ExpenseData | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  if (!isOpen || !expense) return null;

  return (
    <EditExpenseForm
      key={expense.id}
      expense={expense}
      onClose={onClose}
      onSuccess={() => {
        if (onSuccess) onSuccess();
        router.refresh();
      }}
    />
  );
}

function EditExpenseForm({
  expense,
  onClose,
  onSuccess,
}: {
  expense: ExpenseData;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [category, setCategory] = useState(expense.category || EXPENSE_CATEGORIES[0]);
  const [date, setDate] = useState(
    typeof expense.date === "string"
      ? expense.date.split("T")[0]
      : new Date(expense.date).toISOString().split("T")[0]
  );
  const [amount, setAmount] = useState<number | "">(expense.amount ?? 0);
  const [paidTo, setPaidTo] = useState(expense.paidTo || "");
  const [description, setDescription] = useState(expense.description || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const expAmt = typeof amount === "number" ? amount : 0;
    if (expAmt <= 0) {
      setErrorMsg("খরচের পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("category", category);
    fd.append("date", date);
    fd.append("amount", String(expAmt));
    fd.append("paidTo", paidTo);
    fd.append("description", description);

    try {
      const res = await updateRentedMillExpenseAction(expense.id, fd);
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে ব্যর্থ হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 bg-rose-50/60">
          <div>
            <h3 className="text-base font-bold text-rose-900 flex items-center gap-2">
              <span>💸</span> খরচ এন্ট্রি সম্পাদনা ({expense.expenseNo})
            </h3>
            <p className="text-xs text-rose-700">খরচের খাত ও টাকার পরিমাণ পরিবর্তন করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                খরচের খাত *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input w-full text-xs"
                required
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              খরচের পরিমাণ (টাকা) *
            </label>
            <input
              type="number"
              min="1"
              step="any"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
              }
              className="input w-full text-xs font-black text-rose-700 text-right"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              প্রাপকের নাম (ঐচ্ছিক)
            </label>
            <input
              type="text"
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              placeholder="যাকে টাকা দেওয়া হলো"
              className="input w-full text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              বিস্তারিত বিবরণ (ঐচ্ছিক)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="খরচের বিস্তারিত বিবরণ..."
              className="input w-full text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-outline text-xs"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 text-xs transition disabled:opacity-50"
          >
            {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. Edit Milling Bill Modal (ছাটাই বিল সম্পাদনা)
// ─────────────────────────────────────────────────────────────
export interface MillingBillData {
  id: string;
  billNo: string;
  partyId: string;
  date: Date | string;
  paddyQuantity: number;
  unit: string;
  millingRate: number;
  paidAmount: number;
  notes?: string | null;
}

export function EditMillingBillModal({
  bill,
  parties,
  isOpen,
  onClose,
  onSuccess,
}: {
  bill: MillingBillData | null;
  parties: Array<{ id: string; name: string }>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  if (!isOpen || !bill) return null;

  return (
    <EditMillingBillForm
      key={bill.id}
      bill={bill}
      parties={parties}
      onClose={onClose}
      onSuccess={() => {
        if (onSuccess) onSuccess();
        router.refresh();
      }}
    />
  );
}

function EditMillingBillForm({
  bill,
  parties,
  onClose,
  onSuccess,
}: {
  bill: MillingBillData;
  parties: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [partyId, setPartyId] = useState(bill.partyId);
  const [date, setDate] = useState(
    typeof bill.date === "string"
      ? bill.date.split("T")[0]
      : new Date(bill.date).toISOString().split("T")[0]
  );
  const [paddyQuantity, setPaddyQuantity] = useState<number | "">(bill.paddyQuantity ?? 0);
  const [unit, setUnit] = useState(bill.unit || "বস্তা");
  const [millingRate, setMillingRate] = useState<number | "">(bill.millingRate ?? 100);
  const [paidAmount, setPaidAmount] = useState<number | "">(bill.paidAmount ?? 0);
  const [notes, setNotes] = useState(bill.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const qty = typeof paddyQuantity === "number" ? paddyQuantity : 0;
  const rate = typeof millingRate === "number" ? millingRate : 0;
  const paid = typeof paidAmount === "number" ? paidAmount : 0;
  const totalAmount = Math.round(qty * rate);
  const dueAmount = Math.max(0, totalAmount - paid);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) {
      setErrorMsg("পার্টি নির্বাচন করা আবশ্যক।");
      return;
    }
    if (qty <= 0 || rate <= 0) {
      setErrorMsg("পরিমাণ এবং রেট ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", partyId);
    fd.append("date", date);
    fd.append("paddyQuantity", String(qty));
    fd.append("unit", unit);
    fd.append("millingRate", String(rate));
    fd.append("paidAmount", String(paid));
    fd.append("notes", notes);

    try {
      const res = await updateMillingBillAction(bill.id, fd);
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে ব্যর্থ হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 bg-blue-50/60">
          <div>
            <h3 className="text-base font-bold text-blue-900 flex items-center gap-2">
              <span>📜</span> ছাটাই বিল সম্পাদনা ({bill.billNo})
            </h3>
            <p className="text-xs text-blue-700">বিলের পরিমাণ ও রেট সংশোধন করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">
              পার্টি নির্বাচন *
            </label>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="input w-full text-xs"
              required
            >
              <option value="">-- পার্টি নির্বাচন করুন --</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">একক (Unit)</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="input w-full text-xs"
              >
                <option value="বস্তা">বস্তা</option>
                <option value="মণ">মণ</option>
                <option value="কেজি">কেজি</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ধনের পরিমাণ ({unit}) *
              </label>
              <input
                type="number"
                min="0.1"
                step="any"
                value={paddyQuantity}
                onChange={(e) =>
                  setPaddyQuantity(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ছাটাই রেট (টাকা) *
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={millingRate}
                onChange={(e) =>
                  setMillingRate(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-bold"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                নগদ আদায় / জমা (টাকা)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={paidAmount}
                onChange={(e) =>
                  setPaidAmount(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right text-emerald-700 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">মোট বিল / বাকি</label>
              <div className="rounded-lg bg-slate-100 p-2 text-right">
                <span className="text-[11px] font-bold text-ink-900 block">
                  মোট: {formatBnCurrency(totalAmount)}
                </span>
                <span className="text-[10px] font-bold text-red-700">
                  বাকি: {formatBnCurrency(dueAmount)}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">মন্তব্য (ঐচ্ছিক)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="নোট বা বিবরণ"
              className="input w-full text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-outline text-xs"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 text-xs transition disabled:opacity-50"
          >
            {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 6. Edit Byproduct Sale Modal (ভুষি ও কুঁড়া বিক্রয় সম্পাদনা)
// ─────────────────────────────────────────────────────────────
export interface ByproductSaleData {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerPhone?: string | null;
  productType: string;
  date: Date | string;
  quantity: number;
  unit: string;
  rate: number;
  paidAmount: number;
  notes?: string | null;
}

export function EditByproductSaleModal({
  sale,
  isOpen,
  onClose,
  onSuccess,
}: {
  sale: ByproductSaleData | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  if (!isOpen || !sale) return null;

  return (
    <EditByproductSaleForm
      key={sale.id}
      sale={sale}
      onClose={onClose}
      onSuccess={() => {
        if (onSuccess) onSuccess();
        router.refresh();
      }}
    />
  );
}

function EditByproductSaleForm({
  sale,
  onClose,
  onSuccess,
}: {
  sale: ByproductSaleData;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [customerName, setCustomerName] = useState(sale.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(sale.customerPhone || "");
  const [productType, setProductType] = useState(sale.productType || "ভুষি");
  const [date, setDate] = useState(
    typeof sale.date === "string"
      ? sale.date.split("T")[0]
      : new Date(sale.date).toISOString().split("T")[0]
  );
  const [quantity, setQuantity] = useState<number | "">(sale.quantity ?? 0);
  const [unit, setUnit] = useState(sale.unit || "কেজি");
  const [rate, setRate] = useState<number | "">(sale.rate ?? 0);
  const [paidAmount, setPaidAmount] = useState<number | "">(sale.paidAmount ?? 0);
  const [notes, setNotes] = useState(sale.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const qty = typeof quantity === "number" ? quantity : 0;
  const r = typeof rate === "number" ? rate : 0;
  const paid = typeof paidAmount === "number" ? paidAmount : 0;
  const totalAmount = Math.round(qty * r);
  const dueAmount = Math.max(0, totalAmount - paid);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerName.trim()) {
      setErrorMsg("ক্রেতার নাম দেওয়া বাধ্যতামূলক।");
      return;
    }
    if (qty <= 0 || r <= 0) {
      setErrorMsg("পরিমাণ এবং দর ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("customerName", customerName);
    fd.append("customerPhone", customerPhone);
    fd.append("productType", productType);
    fd.append("date", date);
    fd.append("quantity", String(qty));
    fd.append("unit", unit);
    fd.append("rate", String(r));
    fd.append("paidAmount", String(paid));
    fd.append("notes", notes);

    try {
      const res = await updateByproductSaleAction(sale.id, fd);
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে ব্যর্থ হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 bg-amber-50/60">
          <div>
            <h3 className="text-base font-bold text-amber-900 flex items-center gap-2">
              <span>🌾</span> ভুষি/কুঁড়া বিক্রয় সম্পাদনা ({sale.invoiceNo})
            </h3>
            <p className="text-xs text-amber-700">বিক্রয়ের পরিমাণ ও দর পরিবর্তন করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                ক্রেতার নাম *
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="input w-full text-xs font-semibold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">
                মোবাইল (ঐচ্ছিক)
              </label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="input w-full text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">পণ্য ধরণ *</label>
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="input w-full text-xs"
              >
                <option value="ভুষি">ভুষি</option>
                <option value="কুঁড়া">কুঁড়া</option>
                <option value="অন্যান্য">অন্যান্য</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">পরিমাণ *</label>
              <input
                type="number"
                min="0.1"
                step="any"
                value={quantity}
                onChange={(e) =>
                  setQuantity(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">একক</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="input w-full text-xs"
              >
                <option value="কেজি">কেজি</option>
                <option value="বস্তা">বস্তা</option>
                <option value="মণ">মণ</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">দর (টাকা) *</label>
              <input
                type="number"
                min="0.1"
                step="any"
                value={rate}
                onChange={(e) =>
                  setRate(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right font-bold"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">প্রাপ্ত টাকা</label>
              <input
                type="number"
                min="0"
                step="any"
                value={paidAmount}
                onChange={(e) =>
                  setPaidAmount(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)
                }
                className="input w-full text-xs text-right text-emerald-700 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink-800 mb-1">মোট / বাকি</label>
              <div className="rounded-lg bg-slate-100 p-2 text-right">
                <span className="text-[11px] font-bold text-ink-900 block">
                  মোট: {formatBnCurrency(totalAmount)}
                </span>
                <span className="text-[10px] font-bold text-red-700">
                  বাকি: {formatBnCurrency(dueAmount)}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-800 mb-1">মন্তব্য (ঐচ্ছিক)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="গাড়ি নং বা মন্তব্য"
              className="input w-full text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-outline text-xs"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 text-xs transition disabled:opacity-50"
          >
            {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Row Action Wrappers for Table Lists
// ─────────────────────────────────────────────────────────────

export function ExpenseRowActions({
  expense,
  role,
  compact = true,
}: {
  expense: any;
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <EditDeleteActions
        role={role}
        status={expense.status}
        onEdit={() => setShowEdit(true)}
        onDelete={async () => {
          setIsDeleting(true);
          try {
            await deleteRentedMillExpenseAction(expense.id);
            router.refresh();
          } catch (err: any) {
            alert(err.message || "মুছে ফেলতে ব্যর্থ হয়েছে।");
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        deleteConfirmMessage={`আপনি কি নিশ্চিত এই খরচ এন্ট্রিটি (${expense.expenseNo || expense.category}) মুছে ফেলতে চান?`}
        compact={compact}
      />

      {showEdit && (
        <EditExpenseModal
          expense={expense}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

export function PaymentRowActions({
  payment,
  parties,
  role,
  compact = true,
}: {
  payment: any;
  parties: Array<{ id: string; name: string }>;
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <EditDeleteActions
        role={role}
        status={payment.status}
        onEdit={() => setShowEdit(true)}
        onDelete={async () => {
          setIsDeleting(true);
          try {
            await deletePartyPaymentAction(payment.id);
            router.refresh();
          } catch (err: any) {
            alert(err.message || "মুছে ফেলতে ব্যর্থ হয়েছে।");
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        deleteConfirmMessage={`আপনি কি নিশ্চিত এই টাকা গ্রহণ রশিদটি (${payment.receiptNo}) মুছে ফেলতে চান?`}
        compact={compact}
      />

      {showEdit && (
        <EditPaymentModal
          payment={payment}
          parties={parties}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

export function MillingBillRowActions({
  bill,
  parties,
  role,
  compact = true,
}: {
  bill: any;
  parties: Array<{ id: string; name: string }>;
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <EditDeleteActions
        role={role}
        status={bill.status}
        onEdit={() => setShowEdit(true)}
        onDelete={async () => {
          setIsDeleting(true);
          try {
            await deleteMillingBillAction(bill.id);
            router.refresh();
          } catch (err: any) {
            alert(err.message || "মুছে ফেলতে ব্যর্থ হয়েছে।");
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        deleteConfirmMessage={`আপনি কি নিশ্চিত এই ছাটাই বিলটি (${bill.billNo}) মুছে ফেলতে চান?`}
        compact={compact}
      />

      {showEdit && (
        <EditMillingBillModal
          bill={bill}
          parties={parties}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

export function ByproductSaleRowActions({
  sale,
  role,
  compact = true,
}: {
  sale: any;
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <EditDeleteActions
        role={role}
        status={sale.status}
        onEdit={() => setShowEdit(true)}
        onDelete={async () => {
          setIsDeleting(true);
          try {
            await deleteByproductSaleAction(sale.id);
            router.refresh();
          } catch (err: any) {
            alert(err.message || "মুছে ফেলতে ব্যর্থ হয়েছে।");
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        deleteConfirmMessage={`আপনি কি নিশ্চিত এই বিক্রয় রেকর্ডটি (${sale.invoiceNo}) মুছে ফেলতে চান?`}
        compact={compact}
      />

      {showEdit && (
        <EditByproductSaleModal
          sale={sale}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

export function ReceiptRowActions({
  receipt,
  parties,
  role,
  compact = true,
}: {
  receipt: any;
  parties: Array<{ id: string; name: string }>;
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <EditDeleteActions
        role={role}
        status={receipt.status}
        onEdit={() => setShowEdit(true)}
        onDelete={async () => {
          setIsDeleting(true);
          try {
            await deletePaddyReceiptAction(receipt.id);
            router.refresh();
          } catch (err: any) {
            alert(err.message || "মুছে ফেলতে ব্যর্থ হয়েছে।");
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        deleteConfirmMessage={`আপনি কি নিশ্চিত ধান প্রাপ্তি রশিদ (${receipt.receiptNo}) মুছে ফেলতে চান?`}
        compact={compact}
      />

      {showEdit && (
        <EditPaddyReceiptModal
          receipt={receipt}
          parties={parties}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

export function DryerMillingRowActions({
  entry,
  parties,
  dryerNames = DEFAULT_DRYER_NAMES,
  role,
  compact = true,
}: {
  entry: any;
  parties: Array<{ id: string; name: string }>;
  dryerNames?: string[];
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <EditDeleteActions
        role={role}
        status={entry.status}
        onEdit={() => setShowEdit(true)}
        onDelete={async () => {
          setIsDeleting(true);
          try {
            await deleteDryerMillingAction(entry.id);
            router.refresh();
          } catch (err: any) {
            alert(err.message || "মুছে ফেলতে ব্যর্থ হয়েছে।");
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        deleteConfirmMessage={`আপনি কি নিশ্চিত ডায়ার / ছাটাই এন্ট্রি (${entry.entryNo || entry.dryerNo}) মুছে ফেলতে চান?`}
        compact={compact}
      />

      {showEdit && (
        <EditDryerMillingModal
          entry={entry}
          parties={parties}
          dryerNames={dryerNames}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}
