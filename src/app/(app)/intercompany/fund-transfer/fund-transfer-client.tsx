"use client";

import React, { useState, useTransition } from "react";
import {
  transferIntercompanyFundsAction,
  loadEntityBankAccountsAction,
} from "@/server/actions/intercompany";
import { formatMoney } from "@/lib/format";

interface AccountOption {
  id: string;
  name: string;
  kind: string;
  bankName?: string | null;
  accountNumber?: string | null;
}

interface SisterConcernOption {
  id: string;
  name: string;
  intercompanyCode?: string | null;
  isParent?: boolean;
}

interface FundTransferClientProps {
  currentBusiness: {
    id: string;
    name: string;
    currencySymbol: string;
  };
  inGroup: boolean;
  groupName?: string | null;
  sisterConcerns: SisterConcernOption[];
  initialSenderAccounts: AccountOption[];
}

export function FundTransferClient({
  currentBusiness,
  inGroup,
  groupName,
  sisterConcerns,
  initialSenderAccounts,
}: FundTransferClientProps) {
  const [selectedReceiverId, setSelectedReceiverId] = useState<string>(
    sisterConcerns[0]?.id || ""
  );
  const [receiverAccounts, setReceiverAccounts] = useState<AccountOption[]>([]);
  const [selectedSenderAccountId, setSelectedSenderAccountId] = useState<string>(
    initialSenderAccounts[0]?.id || ""
  );
  const [selectedReceiverAccountId, setSelectedReceiverAccountId] = useState<string>("");
  const [transferType, setTransferType] = useState<"LOAN" | "ADVANCE" | "WORKING_CAPITAL" | "SETTLEMENT">("LOAN");
  const [amount, setAmount] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [narration, setNarration] = useState<string>("");

  const [isLoadingReceiverAccounts, setIsLoadingReceiverAccounts] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    senderVoucherNo: string;
    receiverVoucherNo: string;
    amount: number;
  } | null>(null);

  // Load receiver accounts when receiver changes
  React.useEffect(() => {
    if (!selectedReceiverId) {
      setReceiverAccounts([]);
      setSelectedReceiverAccountId("");
      return;
    }

    setIsLoadingReceiverAccounts(true);
    loadEntityBankAccountsAction(selectedReceiverId)
      .then((accounts) => {
        setReceiverAccounts(accounts);
        if (accounts.length > 0) {
          setSelectedReceiverAccountId(accounts[0].id);
        } else {
          setSelectedReceiverAccountId("");
        }
      })
      .catch((err) => {
        console.error("Failed to load receiver accounts", err);
        setReceiverAccounts([]);
      })
      .finally(() => {
        setIsLoadingReceiverAccounts(false);
      });
  }, [selectedReceiverId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessData(null);

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setErrorMsg("স্থানান্তরের জন্য একটি বৈধ পরিমাণ (টাকা) প্রদান করুন");
      return;
    }

    if (!selectedReceiverId) {
      setErrorMsg("প্রাপক সিস্টার কনসার্ন নির্বাচন করুন");
      return;
    }

    if (!selectedSenderAccountId) {
      setErrorMsg("প্রেরক প্রতিষ্ঠানের নগদ বা ব্যাংক হিসাব নির্বাচন করুন");
      return;
    }

    if (!selectedReceiverAccountId) {
      setErrorMsg("প্রাপক প্রতিষ্ঠানের নগদ বা ব্যাংক হিসাব নির্বাচন করুন");
      return;
    }

    const fd = new FormData();
    fd.append("receiverBusinessId", selectedReceiverId);
    fd.append("amount", String(numAmount));
    fd.append("senderAccountId", selectedSenderAccountId);
    fd.append("receiverAccountId", selectedReceiverAccountId);
    fd.append("transferType", transferType);
    if (reference) fd.append("reference", reference);
    if (narration) fd.append("narration", narration);

    startTransition(async () => {
      const res = await transferIntercompanyFundsAction({ ok: false }, fd);
      if (res?.ok && res.data) {
        setSuccessData({
          senderVoucherNo: res.data.senderVoucherNo,
          receiverVoucherNo: res.data.receiverVoucherNo,
          amount: numAmount,
        });
        setAmount("");
        setReference("");
        setNarration("");
      } else {
        setErrorMsg(res?.message || "তহবিল স্থানান্তর ব্যর্থ হয়েছে");
      }
    });
  };

  if (!inGroup || sisterConcerns.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800">
        <h3 className="text-lg font-bold">এন্টারপ্রাইজ গ্রুপ প্রয়োজন</h3>
        <p className="mt-2 text-sm leading-relaxed">
          আন্তঃপ্রতিষ্ঠান তহবিল স্থানান্তর বা ঋণ আদান-প্রদান করতে আপনার প্রতিষ্ঠানটিকে একটি এন্টারপ্রাইজ কোম্পানি গ্রুপের অন্তর্ভুক্ত হতে হবে এবং অন্তত একটি সিস্টার কনসার্ন থাকতে হবে।
        </p>
      </div>
    );
  }

  const selectedReceiver = sisterConcerns.find((s) => s.id === selectedReceiverId);
  const selectedSenderAcc = initialSenderAccounts.find((a) => a.id === selectedSenderAccountId);
  const selectedReceiverAcc = receiverAccounts.find((a) => a.id === selectedReceiverAccountId);

  return (
    <div className="space-y-6 max-w-4xl">
      {successData && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-6 text-emerald-900 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✓</span>
            <div>
              <h4 className="text-lg font-bold">দ্বিপাক্ষিক তহবিল স্থানান্তর সম্পন্ন হয়েছে!</h4>
              <p className="text-sm text-emerald-700 mt-1">
                উভয় প্রতিষ্ঠানের খতিয়ানে সমান্তরাল ব্যালেন্সড ভাউচার সংরক্ষিত হয়েছে।
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white/70 p-4 rounded-lg border border-emerald-200 text-sm">
            <div>
              <span className="text-xs font-semibold text-emerald-600 uppercase">প্রেরক ভাউচার ({currentBusiness.name})</span>
              <p className="font-mono font-bold text-base mt-1">{successData.senderVoucherNo}</p>
              <p className="text-xs text-slate-500 mt-0.5">ভাউচার ধরন: PAYMENT (পরিশোধ)</p>
            </div>
            <div>
              <span className="text-xs font-semibold text-emerald-600 uppercase">প্রাপক ভাউচার ({selectedReceiver?.name})</span>
              <p className="font-mono font-bold text-base mt-1">{successData.receiverVoucherNo}</p>
              <p className="text-xs text-slate-500 mt-0.5">ভাউচার ধরন: RECEIPT (প্রাপ্তি)</p>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-300 rounded-xl p-4 text-rose-800 text-sm">
          <span className="font-bold mr-2">ত্রুটি:</span> {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <h3 className="text-base font-bold text-slate-900">তহবিল স্থানান্তর তথ্য বিবরণী</h3>
          <p className="text-xs text-slate-500 mt-1">
            গ্রুপ: <span className="font-semibold text-slate-700">{groupName}</span>
          </p>
        </div>

        {/* Sender & Receiver Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Sender Entity (Source) */}
          <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                ১. প্রেরক প্রতিষ্ঠান (Source)
              </label>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded">
                বর্তমান প্রতিষ্ঠান
              </span>
            </div>
            <div className="font-semibold text-slate-900">{currentBusiness.name}</div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                টাকা প্রদানের হিসাব (Cash/Bank) *
              </label>
              <select
                value={selectedSenderAccountId}
                onChange={(e) => setSelectedSenderAccountId(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              >
                {initialSenderAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} {acc.accountNumber ? `(${acc.accountNumber})` : ""} [{acc.kind}]
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Receiver Entity (Destination) */}
          <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                ২. প্রাপক সিস্টার কনসার্ন (Destination)
              </label>
              <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded">
                সিস্টার কনসার্ন
              </span>
            </div>

            <select
              value={selectedReceiverId}
              onChange={(e) => setSelectedReceiverId(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
              required
            >
              {sisterConcerns.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.isParent ? "(প্যারেন্ট)" : ""} {s.intercompanyCode ? `[${s.intercompanyCode}]` : ""}
                </option>
              ))}
            </select>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                টাকা জমার হিসাব (Cash/Bank) *
              </label>
              {isLoadingReceiverAccounts ? (
                <div className="text-xs text-slate-500 py-2">হিসাব তালিকা লোড হচ্ছে...</div>
              ) : receiverAccounts.length > 0 ? (
                <select
                  value={selectedReceiverAccountId}
                  onChange={(e) => setSelectedReceiverAccountId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  {receiverAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} {acc.accountNumber ? `(${acc.accountNumber})` : ""} [{acc.kind}]
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-rose-600 py-1">
                  প্রাপক প্রতিষ্ঠানে কোনো সক্রিয় নগদ/ব্যাংক হিসাব পাওয়া যায়নি
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Transfer Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">স্থানান্তরের ধরন (Type) *</label>
            <select
              value={transferType}
              onChange={(e) => setTransferType(e.target.value as any)}
              className="w-full text-sm border border-slate-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="LOAN">আন্তঃপ্রতিষ্ঠান ঋণ (Intercompany Loan)</option>
              <option value="ADVANCE">আন্তঃপ্রতিষ্ঠান অগ্রিম (Intercompany Advance)</option>
              <option value="WORKING_CAPITAL">চলতি মূলধন সহায়তা (Working Capital Support)</option>
              <option value="SETTLEMENT">দ্বিপাক্ষিক পাওনা সমন্বয় (Mutual Settlement)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">স্থানান্তরের পরিমাণ (টাকা) *</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-slate-400 font-semibold">{currentBusiness.currencySymbol}</span>
              <input
                type="number"
                step="any"
                min="1"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                required
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">চেক নং / TrxID / রেফারেন্স</label>
            <input
              type="text"
              placeholder="e.g. CHQ-99214, BEFTN-1029"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">বিবরণ / নোট (Narration)</label>
            <input
              type="text"
              placeholder="স্থানান্তরের উদ্দেশ্য বা মন্তব্য লিখুন..."
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Double-entry Ledger Preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs space-y-2">
          <span className="font-bold text-slate-700 uppercase tracking-wider block">
            দ্বিপাক্ষিক অ্যাকাউন্টিং খতিয়ান প্রিভিউ (Double-Entry Impact)
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="bg-white p-3 rounded border border-slate-200">
              <span className="font-semibold text-indigo-700 block mb-1">
                {currentBusiness.name} (প্রেরক বুক)
              </span>
              <p className="text-slate-600">
                Dr. <span className="font-medium text-slate-900">{selectedReceiver?.name || "সিস্টার কনসার্ন"} (আন্তঃপ্রতিষ্ঠান ঋণ/প্রাপ্য)</span>
              </p>
              <p className="text-slate-600 mt-1">
                Cr. <span className="font-medium text-slate-900">{selectedSenderAcc?.name || "প্রেরক ব্যাংক/ক্যাশ"}</span>
              </p>
            </div>

            <div className="bg-white p-3 rounded border border-slate-200">
              <span className="font-semibold text-emerald-700 block mb-1">
                {selectedReceiver?.name || "সিস্টার কনসার্ন"} (প্রাপক বুক)
              </span>
              <p className="text-slate-600">
                Dr. <span className="font-medium text-slate-900">{selectedReceiverAcc?.name || "প্রাপক ব্যাংক/ক্যাশ"}</span>
              </p>
              <p className="text-slate-600 mt-1">
                Cr. <span className="font-medium text-slate-900">{currentBusiness.name} (আন্তঃপ্রতিষ্ঠান ঋণ/প্রদেয়)</span>
              </p>
            </div>
          </div>
          <p className="text-slate-400 text-[11px] pt-1">
            * নিশ্চিত করলে উভয় প্রতিষ্ঠানে একই সাথে স্বয়ংক্রিয়ভাবে দুটি সমান্তরাল ও ব্যালেন্সড ভাউচার তৈরি হবে।
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isPending || isLoadingReceiverAccounts || !selectedReceiverAccountId}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm flex items-center gap-2"
          >
            {isPending ? "তহবিল স্থানান্তর সম্পন্ন হচ্ছে..." : "১-ক্লিক দ্বিপাক্ষিক ফান্ড ট্রান্সফার নিশ্চিত করুন"}
          </button>
        </div>
      </form>
    </div>
  );
}
