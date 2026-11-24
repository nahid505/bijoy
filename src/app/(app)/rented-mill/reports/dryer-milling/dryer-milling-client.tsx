"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDryerMillingAction, deleteDryerMillingAction } from "@/server/actions/rented-mill";
import type { RentedMillRole } from "@/lib/rented-mill-types";
import { DEFAULT_DRYER_NAMES } from "@/lib/rented-mill-types";
import { toBn } from "@/lib/format";
import { DryerManagerModal } from "../../dryer-manager-modal";
import { EditDeleteActions, EditDryerMillingModal } from "../../rented-mill-edit-modals";

interface PartyWithStock {
  id: string;
  name: string;
  isSelfParty: boolean;
  currentStockBags: number;
}

export function DryerMillingClient({
  parties,
  role,
  dryerNames = DEFAULT_DRYER_NAMES,
}: {
  parties: PartyWithStock[];
  role?: RentedMillRole;
  dryerNames?: string[];
}) {
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (role === "PARTNER") {
    return null;
  }

  const [dryerList, setDryerList] = useState<string[]>(
    dryerNames && dryerNames.length > 0 ? dryerNames : DEFAULT_DRYER_NAMES
  );
  const [showDryerManager, setShowDryerManager] = useState(false);

  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [dryerNo, setDryerNo] = useState(() => dryerList[0] || "ডায়ার-১");
  const [usedBags, setUsedBags] = useState<number | "">("");
  const [milledKg, setMilledKg] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  const selectedParty = parties.find((p) => p.id === partyId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", partyId);
    fd.append("date", date);
    fd.append("dryerNo", dryerNo);
    fd.append("usedBags", String(usedBags || 0));
    fd.append("milledKg", String(milledKg || 0));
    fd.append("notes", notes);

    try {
      const res = await createDryerMillingAction(fd);
      if (res.ok) {
        setShowModal(false);
        setUsedBags("");
        setMilledKg("");
        setNotes("");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "ডায়ার / ছাটাই এন্ট্রি সংরক্ষণ করতে সমস্যা হয়েছে।");
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
        className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm no-print"
      >
        <span>➕</span> নতুন ডায়ার / ছাটাই এন্ট্রি
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
                ডায়ার ও ধান ছাটাই এন্ট্রি
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

              {/* পার্টি নির্বাচন */}
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  পার্টি নির্বাচন করুন <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
                >
                  <option value="">-- পার্টি নির্বাচন করুন --</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isSelfParty ? "(নিজেদের পার্টি)" : ""} — মজুদ: {toBn(p.currentStockBags.toFixed(1))} বস্তা
                    </option>
                  ))}
                </select>
                {selectedParty && (
                  <p className="text-[11px] text-brand-700 font-semibold mt-1">
                    বর্তমানে এই পার্টির অবশিষ্ট ধানের মজুদ: {toBn(selectedParty.currentStockBags.toFixed(2))} স্ট্যান্ডার্ড বস্তা
                  </p>
                )}
              </div>

              {/* তারিখ ও ডায়ার নং */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    তারিখ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-ink-800">
                      ডায়ার নং <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDryerManager(true)}
                      className="text-[11px] text-brand-600 font-semibold hover:underline flex items-center gap-0.5"
                    >
                      <span>✏️</span> নাম সম্পাদনা / নতুন
                    </button>
                  </div>
                  <select
                    value={dryerNo}
                    onChange={(e) => setDryerNo(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold"
                  >
                    {dryerList.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    <option value="সরাসরি মিলিং (ডায়ার ছাড়া)">
                      সরাসরি মিলিং (ডায়ার ছাড়া)
                    </option>
                  </select>
                </div>
              </div>

              {/* ব্যবহৃত বস্তার সংখ্যা ও ছাটাইকৃত কেজি */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    ব্যবহৃত বস্তার সংখ্যা (স্ট্যান্ডার্ড) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="যেমন: ২৫"
                    value={usedBags}
                    onChange={(e) => setUsedBags(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-ink-900"
                  />
                  <span className="text-[10px] text-slate-500">৭৫ কেজি হিসেবে হিসাব</span>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    ছাটাইকৃত চাল/পণ্য (কেজি) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="যেমন: ১২৫০"
                    value={milledKg}
                    onChange={(e) => setMilledKg(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-emerald-700"
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
                  placeholder="যেমন: সিদ্ধ ও শুকানো সম্পন্ন"
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
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "এন্ট্রি সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* ডায়ার তালিকা ও নাম সম্পাদনা মডাল */}
      <DryerManagerModal
        isOpen={showDryerManager}
        onClose={() => setShowDryerManager(false)}
        currentDryers={dryerList}
        onSaved={(updated) => {
          setDryerList(updated);
          if (
            updated.length > 0 &&
            !updated.includes(dryerNo) &&
            dryerNo !== "সরাসরি মিলিং (ডায়ার ছাড়া)"
          ) {
            setDryerNo(updated[0]);
          }
        }}
      />
    </>
  );
}

export { DryerMillingRowActions } from "../../rented-mill-edit-modals";

export function DeleteDryerMillingButton({ entryId }: { entryId: string }) {
  return (
    <form
      action={async () => {
        if (!confirm("আপনি কি নিশ্চিত এই ডায়ার / ছাটাই এন্ট্রিটি মুছে ফেলতে চান?")) return;
        await deleteDryerMillingAction(entryId);
      }}
    >
      <button
        type="submit"
        title="মুছুন"
        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 no-print"
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
    </form>
  );
}
