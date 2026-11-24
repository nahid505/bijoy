"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFundTransactionAction,
  updateFundTransactionAction,
  deleteFundTransactionAction,
  createRentedMillBankAccountAction,
  updateRentedMillBankAccountAction,
} from "@/server/actions/rented-mill";
import type {
  RentedMillBankAccountData,
  RentedMillFundTransactionData,
  FundPartyType,
  FundTransactionType,
  FundMedium,
  RentedMillRole,
} from "@/lib/rented-mill-types";
import { formatBnCurrency } from "@/lib/format";
import { EditDeleteActions } from "./rented-mill-edit-modals";

export type FundModalType =
  | "BANK_DEPOSIT"
  | "BANK_WITHDRAW"
  | "PARTNER_DEPOSIT"
  | "PARTNER_WITHDRAW"
  | null;

export function FundTransactionModal({
  isOpen,
  onClose,
  modalType,
  partner1Name = "নাহিদ হাসান",
  partner2Name = "পার্টনার",
  bankAccounts = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  modalType: FundModalType;
  partner1Name?: string;
  partner2Name?: string;
  bankAccounts: RentedMillBankAccountData[];
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isBankMode = modalType === "BANK_DEPOSIT" || modalType === "BANK_WITHDRAW";
  const defaultPartyType: FundPartyType = isBankMode
    ? "BANK"
    : "OWNER_1";
  const defaultTxType: FundTransactionType =
    modalType === "BANK_DEPOSIT" || modalType === "PARTNER_DEPOSIT"
      ? "DEPOSIT"
      : "WITHDRAW";

  const [partyType, setPartyType] = useState<FundPartyType>(defaultPartyType);
  const [medium, setMedium] = useState<FundMedium>("CASH");
  const [bankAccountId, setBankAccountId] = useState<string>(
    bankAccounts[0]?.id || ""
  );
  const [amount, setAmount] = useState<number | "">("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [reference, setReference] = useState("");

  if (!isOpen || !modalType) return null;

  const title =
    modalType === "BANK_DEPOSIT"
      ? "🏦 ক্যাশ থেকে ব্যাংকে জমা"
      : modalType === "BANK_WITHDRAW"
      ? "🏧 ব্যাংক থেকে ক্যাশে উত্তোলন"
      : modalType === "PARTNER_DEPOSIT"
      ? "💼 মালিকের মূলধন / টাকা জমা"
      : "💸 মালিকের ব্যক্তিগত টাকা উত্তোলন (Drawing)";

  const partnerName =
    partyType === "OWNER_1"
      ? partner1Name
      : partyType === "OWNER_2"
      ? partner2Name
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof amount !== "number" || amount <= 0) {
      setErrorMsg("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }
    if ((isBankMode || medium === "BANK") && !bankAccountId) {
      setErrorMsg("অনুগ্রহ করে একটি ব্যাংক হিসাব নির্বাচন করুন।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("partyType", isBankMode ? "BANK" : partyType);
      if (partnerName) fd.append("partnerName", partnerName);
      fd.append("transactionType", defaultTxType);
      fd.append("medium", isBankMode ? "CASH" : medium);
      if (bankAccountId && (isBankMode || medium === "BANK")) {
        fd.append("bankAccountId", bankAccountId);
      }
      fd.append("amount", String(amount));
      fd.append("date", date);
      if (reference) fd.append("reference", reference);

      const res = await createFundTransactionAction(fd);
      if (!res.ok) {
        throw new Error(res.message || "সংরক্ষণ করা সম্ভব হয়নি।");
      }

      onClose();
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || "কোনো সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-rule overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-rule flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-ink-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isBankMode
                ? "মিলের দৈনিক ক্যাশ ও ব্যাংক হিসাবের মধ্যে সমন্বয়"
                : "মালিকদের মূলধন জমা ও উত্তোলনের খতিয়ান সমন্বয়"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Partner Selection (for partner deposit/withdraw) */}
          {!isBankMode && (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                মালিক / অংশীদার নির্বাচন করুন *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPartyType("OWNER_1")}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    partyType === "OWNER_1"
                      ? "border-brand-600 bg-brand-50 text-brand-900 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>👤</span> {partner1Name} (মালিক ১)
                </button>
                <button
                  type="button"
                  onClick={() => setPartyType("OWNER_2")}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    partyType === "OWNER_2"
                      ? "border-brand-600 bg-brand-50 text-brand-900 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>👥</span> {partner2Name} (মালিক ২)
                </button>
              </div>
            </div>
          )}

          {/* Medium Selection (for partner deposit/withdraw) */}
          {!isBankMode && (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                লেনদেনের মাধ্যম *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMedium("CASH")}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    medium === "CASH"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>💵</span> ক্যাশ (নগদ)
                </button>
                <button
                  type="button"
                  onClick={() => setMedium("BANK")}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    medium === "BANK"
                      ? "border-blue-600 bg-blue-50 text-blue-900 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>🏦</span> ব্যাংক হিসাব
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {medium === "CASH"
                  ? "ক্যাশ নির্বাচন করলে মিলের দৈনিক ক্যাশ খতিয়ানে জমা/খরচ সমন্বয় হবে।"
                  : "ব্যাংক নির্বাচন করলে মিলের নির্দিষ্ট ব্যাংক অ্যাকাউন্টের ব্যালেন্স সমন্বয় হবে।"}
              </p>
            </div>
          )}

          {/* Bank Account Selection (if bank mode or medium is bank) */}
          {(isBankMode || medium === "BANK") && (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                মিলের ব্যাংক অ্যাকাউন্ট নির্বাচন করুন *
              </label>
              {bankAccounts.length === 0 ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900">
                  কোনো ব্যাংক অ্যাকাউন্ট যুক্ত নেই। অনুগ্রহ করে প্রথমে একটি ব্যাংক অ্যাকাউন্ট যোগ করুন।
                </div>
              ) : (
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="input w-full text-xs"
                  required
                >
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} — {b.accountNumber} ({b.branchName || "শাখা"}) [বর্তমান ব্যালেন্স: {formatBnCurrency(b.currentBalance)}]
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Amount & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                টাকার পরিমাণ (৳) *
              </label>
              <input
                type="number"
                step="any"
                min="1"
                placeholder="0.00"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="input w-full text-sm font-bold"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                তারিখ *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>
          </div>

          {/* Reference / Note */}
          <div>
            <label className="block text-xs font-semibold text-ink-800 mb-1">
              বিবরণ / চেক নং / স্লিপ নং (ঐচ্ছিক)
            </label>
            <input
              type="text"
              placeholder="যেমন: চেক নং-123456 / নগদ মূলধন জমা / জরুরি খরচ বাবদ উত্তোলন"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input w-full text-xs"
            />
          </div>

          {/* Accounting Note Alert */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
            ℹ️ <b>হিসাবরক্ষণ তথ্য:</b> এই লেনদেনটি কোনো ব্যবসায়িক আয় বা খরচ নয়। এটি ৫০:৫০ লাভ-ক্ষতির হিসাবে প্রভাব ফেলবে না—শুধুমাত্র সংশ্লিষ্ট ক্যাশ/ব্যাংক এবং মালিকদের মূলধন খতিয়ানে যুক্ত হবে।
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-rule flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-secondary text-xs"
            >
              বাতিল
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary text-xs"
            >
              {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BankAccountModal({
  isOpen,
  onClose,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialData?: RentedMillBankAccountData | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [bankName, setBankName] = useState(initialData?.bankName || "সোনালী ব্যাংক পিএলসি");
  const [accountName, setAccountName] = useState(initialData?.accountName || "শুভংকর অটো রাইস মিল");
  const [accountNumber, setAccountNumber] = useState(initialData?.accountNumber || "");
  const [branchName, setBranchName] = useState(initialData?.branchName || "দিনাজপুর শাখা");
  const [openingBalance, setOpeningBalance] = useState<number | "">(initialData?.openingBalance ?? 0);
  const [notes, setNotes] = useState(initialData?.notes || "");

  if (!isOpen) return null;

  const isEditing = Boolean(initialData?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim() || !accountNumber.trim()) {
      setErrorMsg("ব্যাংকের নাম এবং হিসাব নম্বর দেওয়া বাধ্যতামূলক।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      if (isEditing && initialData) fd.append("id", initialData.id);
      fd.append("bankName", bankName.trim());
      fd.append("accountName", accountName.trim());
      fd.append("accountNumber", accountNumber.trim());
      fd.append("branchName", branchName.trim());
      fd.append("openingBalance", String(typeof openingBalance === "number" ? openingBalance : 0));
      if (notes) fd.append("notes", notes.trim());

      const res = isEditing
        ? await updateRentedMillBankAccountAction(fd)
        : await createRentedMillBankAccountAction(fd);

      if (!res.ok) throw new Error(res.message);

      onClose();
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || "সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-rule overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-rule flex items-center justify-between bg-slate-50">
          <h3 className="text-base font-bold text-ink-900">
            {isEditing ? "🏦 ব্যাংক হিসাব সম্পাদনা" : "🏦 নতুন ব্যাংক হিসাব যুক্ত করুন"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800">
              ⚠️ {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink-800 mb-1">ব্যাংকের নাম *</label>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="যেমন: সোনালী ব্যাংক পিএলসি / ইসলামী ব্যাংক"
              className="input w-full text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-800 mb-1">অ্যাকাউন্টের নাম</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="যেমন: শুভংকর অটো রাইস মিল"
              className="input w-full text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">হিসাব নম্বর *</label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="যেমন: 0123456789"
                className="input w-full text-xs font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">শাখার নাম</label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="যেমন: দিনাজপুর শাখা"
                className="input w-full text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-800 mb-1">
              প্রারম্ভিক ব্যালেন্স (Opening Balance - ৳)
            </label>
            <input
              type="number"
              step="any"
              value={openingBalance}
              onChange={(e) =>
                setOpeningBalance(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="input w-full text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-800 mb-1">মন্তব্য / নোট</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ঐচ্ছিক তথ্য"
              className="input w-full text-xs"
            />
          </div>

          <div className="pt-3 border-t border-rule flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-secondary text-xs"
            >
              বাতিল
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary text-xs"
            >
              {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EditFundTransactionModal({
  isOpen,
  onClose,
  transaction,
  bankAccounts = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  transaction: RentedMillFundTransactionData | null;
  bankAccounts: RentedMillBankAccountData[];
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !transaction) return null;

  return <EditFundTransactionInnerModal transaction={transaction} bankAccounts={bankAccounts} onClose={onClose} router={router} />;
}

function EditFundTransactionInnerModal({
  transaction,
  bankAccounts,
  onClose,
  router,
}: {
  transaction: RentedMillFundTransactionData;
  bankAccounts: RentedMillBankAccountData[];
  onClose: () => void;
  router: any;
}) {
  const [amount, setAmount] = useState<number | "">(transaction.amount);
  const [date, setDate] = useState(() => {
    const d = new Date(transaction.date);
    return isNaN(d.getTime()) ? new Date().toISOString().split("T")[0] : d.toISOString().split("T")[0];
  });
  const [reference, setReference] = useState(transaction.reference || "");
  const [bankAccountId, setBankAccountId] = useState(transaction.bankAccountId || bankAccounts[0]?.id || "");
  const [medium, setMedium] = useState<FundMedium>(transaction.medium);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isBankMode = transaction.partyType === "BANK";

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof amount !== "number" || amount <= 0) {
      setErrorMsg("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("id", transaction.id);
      fd.append("amount", String(amount));
      fd.append("date", date);
      fd.append("reference", reference);
      fd.append("medium", isBankMode ? "CASH" : medium);
      if (bankAccountId) fd.append("bankAccountId", bankAccountId);

      const res = await updateFundTransactionAction(fd);
      if (!res.ok) throw new Error(res.message);

      onClose();
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || "হালনাগাদ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`আপনি কি নিশ্চিত যে (${transaction.transactionNo}) এন্ট্রিটি মুছে ফেলতে চান?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await deleteFundTransactionAction(transaction.id);
      if (!res.ok) throw new Error(res.message);
      onClose();
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || "মুছতে সমস্যা হয়েছে।");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-rule overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-rule flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-ink-900">
              ✏️ তহবিল এন্ট্রি সম্পাদনা ({transaction.transactionNo})
            </h3>
            <span className="text-xs text-slate-500">
              {transaction.partyType === "BANK"
                ? "ব্যাংক তহবিল লেনদেন"
                : `${transaction.partnerName || "মালিক"} তহবিল লেনদেন`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleUpdate} className="p-5 space-y-3.5">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800">
              ⚠️ {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">টাকার পরিমাণ (৳) *</label>
              <input
                type="number"
                step="any"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="input w-full text-xs font-bold"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">তারিখ *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full text-xs"
                required
              />
            </div>
          </div>

          {!isBankMode && (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">লেনদেনের মাধ্যম</label>
              <select
                value={medium}
                onChange={(e) => setMedium(e.target.value as FundMedium)}
                className="input w-full text-xs"
              >
                <option value="CASH">ক্যাশ (নগদ)</option>
                <option value="BANK">ব্যাংক হিসাব</option>
              </select>
            </div>
          )}

          {(isBankMode || medium === "BANK") && (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">ব্যাংক অ্যাকাউন্ট</label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="input w-full text-xs"
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bankName} — {b.accountNumber} ({b.branchName || "শাখা"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink-800 mb-1">বিবরণ / রেফারেন্স</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input w-full text-xs"
            />
          </div>

          <div className="pt-3 border-t border-rule flex items-center justify-between">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
            >
              🗑️ এন্ট্রি মুছুন
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="btn-secondary text-xs"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary text-xs"
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "হালনাগাদ করুন"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function FundTransactionRowActions({
  transaction,
  bankAccounts = [],
  role,
  compact = true,
}: {
  transaction: RentedMillFundTransactionData;
  bankAccounts?: RentedMillBankAccountData[];
  role?: RentedMillRole;
  compact?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  if (!role || role === "PARTNER" || role === "GUEST") {
    return null;
  }
  const canEditOrDelete =
    role === "SUPER_ADMIN" || (role === "ACCOUNTANT" && transaction.status === "PENDING");
  if (!canEditOrDelete) {
    return null;
  }

  const handleDelete = async () => {
    if (!confirm(`আপনি কি নিশ্চিত যে (${transaction.transactionNo}) এন্ট্রিটি মুছে ফেলতে চান?`)) {
      return;
    }
    setIsDeleting(true);
    try {
      const res = await deleteFundTransactionAction(transaction.id);
      if (!res.ok) throw new Error(res.message);
      router.refresh();
    } catch (err: any) {
      alert(err.message || "মুছতে সমস্যা হয়েছে।");
      setIsDeleting(false);
    }
  };

  return (
    <>
      <EditDeleteActions
        role={role}
        status={transaction.status}
        onEdit={() => setIsEditing(true)}
        onDelete={handleDelete}
        isDeleting={isDeleting}
        compact={compact}
      />
      <EditFundTransactionModal
        isOpen={isEditing}
        onClose={() => setIsEditing(false)}
        transaction={transaction}
        bankAccounts={bankAccounts}
      />
    </>
  );
}

