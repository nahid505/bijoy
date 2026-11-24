"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPaddyReceiptAction, deletePaddyReceiptAction } from "@/server/actions/rented-mill";
import type { RentedMillRole } from "@/lib/rented-mill-types";
import { formatBnCurrency, toBn } from "@/lib/format";
import { EditDeleteActions, EditPaddyReceiptModal } from "../../rented-mill-edit-modals";

interface PartyOption {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  isSelfParty: boolean;
}

export function PaddyReceiptClient({
  parties,
  role,
  defaultMillingRate = 100,
}: {
  parties: PartyOption[];
  role?: RentedMillRole;
  defaultMillingRate?: number;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (role === "PARTNER") {
    return null;
  }

  const [partyId, setPartyId] = useState("");
  const [isNewParty, setIsNewParty] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");
  const [partyPhone, setPartyPhone] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [isSelfParty, setIsSelfParty] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [receiptTime, setReceiptTime] = useState("");
  const [paddyName, setPaddyName] = useState("ব্রি-২৮");

  // Bag inputs & Dhalta
  const [juteBags, setJuteBags] = useState<number | "">("");
  const [plasticBags, setPlasticBags] = useState<number | "">("");
  const [grossSkl, setGrossSkl] = useState<number | "">("");
  const [manualDhalta, setManualDhalta] = useState<number | "">("");
  const [ratePerStandardBag, setRatePerStandardBag] = useState<number | "">(defaultMillingRate);
  const [notes, setNotes] = useState("");

  // Derived calculations
  const jBags = typeof juteBags === "number" ? juteBags : 0;
  const pBags = typeof plasticBags === "number" ? plasticBags : 0;
  const totalBagsCount = jBags + pBags;
  const autoDhaltaKg = Number((jBags * 1.5 + pBags * 0.5).toFixed(2));
  const effectiveDhaltaKg = typeof manualDhalta === "number" ? manualDhalta : autoDhaltaKg;
  const grossWeightKg = typeof grossSkl === "number" ? grossSkl : 0;
  const netSklWeightKg = Math.max(0, Number((grossWeightKg - effectiveDhaltaKg).toFixed(2)));
  const standard75BagsCount = Number((netSklWeightKg / 75).toFixed(2));
  const maundsCount = Number((netSklWeightKg / 40).toFixed(2));
  const millingRate = typeof ratePerStandardBag === "number" ? ratePerStandardBag : defaultMillingRate;
  const totalMillingBillAmount = Math.round(standard75BagsCount * millingRate);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const fd = new FormData();
    fd.append("partyId", partyId);
    if (isNewParty) {
      fd.append("newPartyName", newPartyName);
      fd.append("partyPhone", partyPhone);
      fd.append("partyAddress", partyAddress);
      fd.append("isSelfParty", String(isSelfParty));
    }
    fd.append("date", date);
    fd.append(
      "receiptTime",
      receiptTime || new Date().toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })
    );
    fd.append("paddyName", paddyName);
    fd.append("juteBags", String(jBags));
    fd.append("plasticBags", String(pBags));
    fd.append("bagsCount", String(totalBagsCount));
    fd.append("sklWeight", String(grossWeightKg));
    fd.append("dhaltaKg", String(effectiveDhaltaKg));
    fd.append("netSklKg", String(netSklWeightKg));
    fd.append("standardBags75kg", String(standard75BagsCount));
    fd.append("ratePerStandardBag", String(millingRate));
    fd.append("totalBillAmount", String(totalMillingBillAmount));
    fd.append("notes", notes);

    try {
      const res = await createPaddyReceiptAction(fd);
      if (res.ok) {
        setShowModal(false);
        setJuteBags("");
        setPlasticBags("");
        setGrossSkl("");
        setManualDhalta("");
        setReceiptTime("");
        setNotes("");
        setIsNewParty(false);
        setNewPartyName("");
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "ধান প্রাপ্তি সংরক্ষণ করতে সমস্যা হয়েছে।");
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
        <span>➕</span> নতুন ধান গ্রহণ এন্ট্রি
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSubmit}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base sm:text-lg font-bold text-ink-900">
                নতুন ধান গ্রহণ ও স্কেল ওজন এন্ট্রি
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-ink-800">
                    পার্টি নির্বাচন <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewParty(!isNewParty);
                      if (!isNewParty) setPartyId("");
                    }}
                    className="text-[11px] text-brand-600 font-semibold hover:underline"
                  >
                    {isNewParty ? "পূর্বের পার্টি তালিকা" : "+ নতুন পার্টি লিখুন"}
                  </button>
                </div>

                {isNewParty ? (
                  <div className="space-y-2 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 p-3">
                    <input
                      type="text"
                      required
                      placeholder="নতুন পার্টির নাম লিখুন *"
                      value={newPartyName}
                      onChange={(e) => setNewPartyName(e.target.value)}
                      className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="মোবাইল নম্বর"
                        value={partyPhone}
                        onChange={(e) => setPartyPhone(e.target.value)}
                        className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                      />
                      <input
                        type="text"
                        placeholder="ঠিকানা (গ্রাম/এলাকা)"
                        value={partyAddress}
                        onChange={(e) => setPartyAddress(e.target.value)}
                        className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ink-800 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={isSelfParty}
                        onChange={(e) => setIsSelfParty(e.target.checked)}
                        className="rounded border-rule text-brand-600"
                      />
                      <span>নিজেদের পার্টি / আল্লাহর দান এন্টারপ্রাইজ (Self Party)</span>
                    </label>
                  </div>
                ) : (
                  <select
                    required
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
                  >
                    <option value="">-- পার্টি নির্বাচন করুন --</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.address ? `(${p.address})` : ""} {p.isSelfParty ? "(নিজেদের পার্টি)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* তারিখ ও সময় */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    ধান প্রাপ্তির তারিখ <span className="text-red-500">*</span>
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
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    গ্রহণের সময় (Time)
                  </label>
                  <input
                    type="text"
                    placeholder="যেমন: ১০:৩০ AM"
                    value={receiptTime}
                    onChange={(e) => setReceiptTime(e.target.value)}
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* ধানের নাম */}
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  ধানের নাম (জাত) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: ব্রি-২৮ / স্বর্ণা / কাটারি"
                  value={paddyName}
                  onChange={(e) => setPaddyName(e.target.value)}
                  className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
                />
              </div>

              {/* ১. বস্তার ধরণ ও সংখ্যা (চট ও প্লাস্টিক) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    চটের বস্তা (১.৫ কেজি ধলতা)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="যেমন: ৫০"
                    value={juteBags}
                    onChange={(e) =>
                      setJuteBags(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                    }
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-ink-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    প্লাস্টিক বস্তা (০.৫ কেজি ধলতা)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="যেমন: ৫০"
                    value={plasticBags}
                    onChange={(e) =>
                      setPlasticBags(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                    }
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-ink-900"
                  />
                </div>
              </div>

              {/* বস্তা ও ধলতা সামারি ব্যাজ */}
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-ink-800 flex items-center justify-between font-semibold">
                <span>
                  মোট বস্তা: <b className="text-sm font-black text-ink-900">{toBn(totalBagsCount)} টি</b>
                </span>
                <span className="text-amber-800">
                  স্বয়ংক্রিয় ধলতা: <b>{toBn(autoDhaltaKg)} কেজি</b>
                </span>
              </div>

              {/* ২. স্কেল ওজন ও ধলতা কর্তন */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    মোট SKL স্কেল ওজন (কেজি) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="যেমন: ৩৭৫০"
                    value={grossSkl}
                    onChange={(e) =>
                      setGrossSkl(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-black text-blue-800 text-base"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    ধলতা কর্তন (কেজি)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder={`ডিফল্ট: ${autoDhaltaKg}`}
                    value={manualDhalta}
                    onChange={(e) =>
                      setManualDhalta(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-semibold text-amber-900"
                  />
                </div>
              </div>

              {/* ৩. নিট SKL ও ৭৫ কেজি স্ট্যান্ডার্ড বস্তা হাইলাইট কার্ড */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900">নিট SKL ওজন (ধলতা বাদে):</span>
                  <span className="text-base font-black text-blue-950">
                    {toBn(netSklWeightKg.toLocaleString())} কেজি
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-blue-800 pt-1 border-t border-blue-200">
                  <span>
                    ৭৫-এ স্ট্যান্ডার্ড বস্তা:{" "}
                    <b className="text-sm font-black text-blue-950">{toBn(standard75BagsCount)} টি</b>
                  </span>
                  <span>
                    মোট মণ (৪০ কেজিতে): <b>{toBn(maundsCount)} মণ</b>
                  </span>
                </div>
              </div>

              {/* ৪. প্রতি ৭৫ কেজি বস্তার দর ও মোট বিল হিসাব */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    ৭৫-কেজি বস্তার দর (টাকা) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="যেমন: ১০০"
                    value={ratePerStandardBag}
                    onChange={(e) =>
                      setRatePerStandardBag(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    মোট বিল টাকা (খতিয়ানে পাওনা)
                  </label>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-2 text-right">
                    <span className="text-sm font-black text-emerald-800">
                      {formatBnCurrency(totalMillingBillAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* মন্তব্য / গাড়ি নং */}
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  মন্তব্য / গাড়ি নং (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: ট্রাক নং ঢাকা মেট্রো-ট..."
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
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "ধান গ্রহণ সম্পন্ন করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export { ReceiptRowActions } from "../../rented-mill-edit-modals";

export function DeleteReceiptButton({ receiptId }: { receiptId: string }) {
  return (
    <form
      action={async () => {
        if (!confirm("আপনি কি নিশ্চিত এই ধান প্রাপ্তি এন্ট্রিটি মুছে ফেলতে চান?")) return;
        await deletePaddyReceiptAction(receiptId);
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
