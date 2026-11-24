"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPartyPaymentAction,
  createRentedMillExpenseAction,
  createPaddyReceiptAction,
  createDryerMillingAction,
  approveRentedMillEntryAction,
  rejectRentedMillEntryAction,
} from "@/server/actions/rented-mill";
import {
  type RentedMillRole,
  EXPENSE_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_DRYER_NAMES,
} from "@/lib/rented-mill-types";
import { formatBnCurrency, toBn, getBengaliDateLabel } from "@/lib/format";
import { DryerManagerModal } from "./dryer-manager-modal";
import { ExpenseCategoryModal } from "./expense-category-modal";
import {
  EditPaddyReceiptModal,
  EditDryerMillingModal,
  EditPaymentModal,
  EditExpenseModal,
  EditMillingBillModal,
  EditByproductSaleModal,
} from "./rented-mill-edit-modals";
import {
  FundTransactionModal,
  EditFundTransactionModal,
  type FundModalType,
} from "./fund-transaction-modals";
import type { RentedMillBankAccountData } from "@/lib/rented-mill-types";
import Link from "next/link";

export interface PendingApprovalItem {
  id: string;
  type: "PAYMENT" | "EXPENSE" | "PADDY_RECEIPT" | "DRYER_MILLING" | "MILLING_BILL" | "BYPRODUCT_SALE" | "FUND_TRANSACTION";
  typeLabel: string;
  refNo: string;
  date: Date | string;
  partyOrCustomer?: string;
  title: string;
  details: string;
  amount?: number;
  createdByName: string;
  createdAt: Date | string;
  rawData?: any;
}


export interface PartyOption {
  id: string;
  name: string;
  phone: string | null;
}

export function QuickActionsClient({
  role,
  parties,
  todayCashReceived,
  todayExpenses,
  todayPaddyBags,
  todayPaddyKg,
  todayMilledBags,
  pendingItems,
  dryerNames = DEFAULT_DRYER_NAMES,
  expenseCategories = DEFAULT_EXPENSE_CATEGORIES,
  bankAccounts = [],
  totalBankBalance = 0,
  partner1Net = 0,
  partner2Net = 0,
  partner1Name = "নাহিদ হাসান",
  partner2Name = "পার্টনার",
}: {
  role: RentedMillRole;
  parties: PartyOption[];
  todayCashReceived: number;
  todayExpenses: number;
  todayPaddyBags: number;
  todayPaddyKg: number;
  todayMilledBags: number;
  pendingItems: PendingApprovalItem[];
  dryerNames?: string[];
  expenseCategories?: string[];
  bankAccounts?: RentedMillBankAccountData[];
  totalBankBalance?: number;
  partner1Net?: number;
  partner2Net?: number;
  partner1Name?: string;
  partner2Name?: string;
}) {
  const router = useRouter();

  // Modal display states
  const [activeModal, setActiveModal] = useState<"CASH" | "EXPENSE" | "PADDY" | "DRYER" | null>(null);
  const [fundModalType, setFundModalType] = useState<FundModalType>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Dryer list & modal state
  const [dryerList, setDryerList] = useState<string[]>(
    dryerNames && dryerNames.length > 0 ? dryerNames : DEFAULT_DRYER_NAMES
  );
  const [showDryerManager, setShowDryerManager] = useState(false);

  // Expense categories list & modal state
  const [categoryList, setCategoryList] = useState<string[]>(
    expenseCategories && expenseCategories.length > 0
      ? expenseCategories
      : [...DEFAULT_EXPENSE_CATEGORIES]
  );
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // Modal 1: Cash Receive State
  const [cashPartyId, setCashPartyId] = useState("");
  const [cashDate, setCashDate] = useState(new Date().toISOString().split("T")[0]);
  const [cashAmount, setCashAmount] = useState<number | "">("");
  const [cashMethod, setCashMethod] = useState("নগদ");
  const [cashNotes, setCashNotes] = useState("");

  // Modal 2: Expense State
  const [expCategory, setExpCategory] = useState<string>(
    expenseCategories && expenseCategories.length > 0
      ? expenseCategories[0]
      : EXPENSE_CATEGORIES[0]
  );
  const [expDate, setExpDate] = useState(new Date().toISOString().split("T")[0]);
  const [expAmount, setExpAmount] = useState<number | "">("");
  const [expPaidTo, setExpPaidTo] = useState("");
  const [expDescription, setExpDescription] = useState("");

  // Modal 3: Paddy Receipt State
  const [paddyPartyId, setPaddyPartyId] = useState(parties[0]?.id || "");
  const [isNewPaddyParty, setIsNewPaddyParty] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");
  const [newPartyPhone, setNewPartyPhone] = useState("");
  const [paddyDate, setPaddyDate] = useState(new Date().toISOString().split("T")[0]);
  const [paddyTime, setPaddyTime] = useState("");
  const [paddyName, setPaddyName] = useState("ব্রি-২৮");
  const [juteBags, setJuteBags] = useState<number | "">("");
  const [plasticBags, setPlasticBags] = useState<number | "">("");
  const [grossSkl, setGrossSkl] = useState<number | "">("");
  const [manualDhalta, setManualDhalta] = useState<number | "">("");
  const [ratePerStandardBag, setRatePerStandardBag] = useState<number | "">(100);
  const [paddyNotes, setPaddyNotes] = useState("");

  // Derived calculations for Paddy Receipt
  const jBags = typeof juteBags === "number" ? juteBags : 0;
  const pBags = typeof plasticBags === "number" ? plasticBags : 0;
  const totalPaddyBagsCount = jBags + pBags;
  const autoDhaltaKg = Number((jBags * 1.5 + pBags * 0.5).toFixed(2));
  const effectiveDhaltaKg = typeof manualDhalta === "number" ? manualDhalta : autoDhaltaKg;
  const grossWeightKg = typeof grossSkl === "number" ? grossSkl : 0;
  const netSklWeightKg = Math.max(0, Number((grossWeightKg - effectiveDhaltaKg).toFixed(2)));
  const standard75BagsCount = Number((netSklWeightKg / 75).toFixed(2));
  const maundsCount = Number((netSklWeightKg / 40).toFixed(2));
  const millingRate = typeof ratePerStandardBag === "number" ? ratePerStandardBag : 100;
  const totalMillingBillAmount = Math.round(standard75BagsCount * millingRate);

  // Modal 4: Dryer Milling State
  const [dryerPartyId, setDryerPartyId] = useState(parties[0]?.id || "");
  const [dryerDate, setDryerDate] = useState(new Date().toISOString().split("T")[0]);
  const [dryerNo, setDryerNo] = useState(() => dryerList[0] || "ডায়ার-১");
  const [dryerUsedBags, setDryerUsedBags] = useState<number | "">("");
  const [dryerMilledKg, setDryerMilledKg] = useState<number | "">("");
  const [dryerNotes, setDryerNotes] = useState("");

  // Approval action in progress
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PendingApprovalItem | null>(null);

  // Handler: Cash Receive
  async function handleCashSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cashPartyId) {
      setErrorMsg("অনুগ্রহ করে একটি পার্টি নির্বাচন করুন। পার্টির নাম ছাড়া জমা গ্রহণ করা যাবে না।");
      return;
    }
    const amt = typeof cashAmount === "number" ? cashAmount : 0;
    if (amt <= 0) {
      setErrorMsg("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append("partyId", cashPartyId);
      fd.append("date", cashDate);
      fd.append("amount", String(amt));
      fd.append("paymentMethod", cashMethod);
      fd.append("notes", cashNotes);

      const res = await createPartyPaymentAction(fd);
      if (res.ok) {
        setSuccessMsg(res.message);
        setActiveModal(null);
        setCashPartyId("");
        setCashAmount("");
        setCashNotes("");
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "ক্যাশ গ্রহণ সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handler: Expense
  async function handleExpenseSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = typeof expAmount === "number" ? expAmount : parseFloat(String(expAmount || "0")) || 0;
    if (amt <= 0) {
      setErrorMsg("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append("category", expCategory);
      fd.append("date", expDate);
      fd.append("amount", String(amt));
      fd.append("paidTo", expPaidTo);
      fd.append("description", expDescription);

      const res = await createRentedMillExpenseAction(fd);
      if (res.ok) {
        setSuccessMsg(res.message);
        setActiveModal(null);
        setExpAmount("");
        setExpPaidTo("");
        setExpDescription("");
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "খরচ এন্ট্রি সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handler: Paddy Receipt
  async function handlePaddySubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append("partyId", paddyPartyId);
      if (isNewPaddyParty) {
        fd.append("newPartyName", newPartyName);
        fd.append("partyPhone", newPartyPhone);
      }
      fd.append("date", paddyDate);
      fd.append("receiptTime", paddyTime);
      fd.append("paddyName", paddyName);
      fd.append("juteBags", String(jBags));
      fd.append("plasticBags", String(pBags));
      fd.append("bagsCount", String(totalPaddyBagsCount));
      fd.append("sklWeight", String(grossWeightKg));
      fd.append("dhaltaKg", String(effectiveDhaltaKg));
      fd.append("netSklKg", String(netSklWeightKg));
      fd.append("standardBags75kg", String(standard75BagsCount));
      fd.append("ratePerStandardBag", String(millingRate));
      fd.append("totalBillAmount", String(totalMillingBillAmount));
      fd.append("notes", paddyNotes);

      const res = await createPaddyReceiptAction(fd);
      if (res.ok) {
        setSuccessMsg(res.message);
        setActiveModal(null);
        setJuteBags("");
        setPlasticBags("");
        setGrossSkl("");
        setManualDhalta("");
        setPaddyNotes("");
        setIsNewPaddyParty(false);
        setNewPartyName("");
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "ধান প্রাপ্তি সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handler: Dryer Milling
  async function handleDryerSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append("partyId", dryerPartyId);
      fd.append("date", dryerDate);
      fd.append("dryerNo", dryerNo);
      fd.append("usedBags", String(dryerUsedBags || 0));
      fd.append("milledKg", String(dryerMilledKg || 0));
      fd.append("notes", dryerNotes);

      const res = await createDryerMillingAction(fd);
      if (res.ok) {
        setSuccessMsg(res.message);
        setActiveModal(null);
        setDryerUsedBags("");
        setDryerMilledKg("");
        setDryerNotes("");
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "ডায়ার ছাটাই সংরক্ষণ করতে সমস্যা হয়েছে।");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handler: Approve Entry
  async function handleApprove(item: PendingApprovalItem) {
    setProcessingId(item.id);
    setErrorMsg(null);
    try {
      const res = await approveRentedMillEntryAction({ type: item.type, id: item.id });
      if (res.ok) {
        setSuccessMsg(res.message);
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "অনুমোদন ব্যর্থ হয়েছে।");
    } finally {
      setProcessingId(null);
    }
  }

  // Handler: Reject Entry
  async function handleReject(item: PendingApprovalItem) {
    if (!confirm(`আপনি কি নিশ্চিত যে এই এন্ট্রিটি (${item.refNo}) বাতিল করতে চান?`)) return;
    setProcessingId(item.id);
    setErrorMsg(null);
    try {
      const res = await rejectRentedMillEntryAction({ type: item.type, id: item.id });
      if (res.ok) {
        setSuccessMsg(res.message);
        router.refresh();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "বাতিল ব্যর্থ হয়েছে।");
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {successMsg && (
        <div className="no-print rounded-xl bg-emerald-50 border border-emerald-300 p-3.5 text-xs sm:text-sm text-emerald-800 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 font-semibold">
            <span>✅</span> {successMsg}
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="no-print rounded-xl bg-red-50 border border-red-300 p-3.5 text-xs sm:text-sm text-red-800 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 font-semibold">
            <span>⚠️</span> {errorMsg}
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-700 hover:text-red-950 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* ────────────────── 1. FOUR LARGE QUICK-ACTION / METRIC CARDS ────────────────── */}
      <div className="no-print">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5">
            <span>⚡</span>{" "}
            {role === "PARTNER"
              ? "আজকের কার্যক্রম ও মেট্রিক ওভারভিউ"
              : "হিসাবরক্ষক ও অ্যাডমিন কুইক-অ্যাকশন এন্ট্রি"}
          </h2>
          <span className="text-[11px] text-ink-500 font-medium">
            {role === "PARTNER"
              ? "(শুধু দেখার অনুমতি / Read-Only)"
              : "(যেকোনো কার্ডে ক্লিক করে সরাসরি এন্ট্রি করুন)"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: রিসিভ ক্যাশ (Emerald Green) */}
          <div
            onClick={() => {
              if (role === "PARTNER") return;
              setErrorMsg(null);
              setSuccessMsg(null);
              setCashPartyId("");
              setActiveModal("CASH");
            }}
            className={`rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 p-4 text-white shadow-sm transition-all duration-150 ${
              role === "PARTNER"
                ? ""
                : "group cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl backdrop-blur-xs">
                💵
              </span>
              {role !== "PARTNER" ? (
                <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-bold text-white group-hover:bg-white group-hover:text-emerald-800 transition">
                  + ক্যাশ জমা
                </span>
              ) : (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                  নগদ আদায়
                </span>
              )}
            </div>
            <h3 className="mt-3 text-lg font-black tracking-tight">রিসিভ ক্যাশ</h3>
            <p className="text-xs text-emerald-100 line-clamp-1">
              পার্টির ছাটাই বিল আদায় বা নগদ টাকা গ্রহণ
            </p>
            <div className="mt-4 border-t border-white/20 pt-2 text-[11px] font-bold text-emerald-50">
              আজকের মোট রিসিভ:{" "}
              <span className="text-white font-black text-xs">
                {formatBnCurrency(todayCashReceived)}
              </span>
            </div>
          </div>

          {/* Card 2: মিল ভাড়া ও খরচ এন্ট্রি (Rose Red) */}
          <div
            onClick={() => {
              if (role === "PARTNER") return;
              setErrorMsg(null);
              setSuccessMsg(null);
              setExpCategory(categoryList[0] || EXPENSE_CATEGORIES[0]);
              setExpDate(new Date().toISOString().split("T")[0]);
              setExpAmount("");
              setExpPaidTo("");
              setExpDescription("");
              setActiveModal("EXPENSE");
            }}
            className={`rounded-2xl bg-gradient-to-br from-rose-600 to-rose-800 p-4 text-white shadow-sm transition-all duration-150 ${
              role === "PARTNER"
                ? ""
                : "group cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl backdrop-blur-xs">
                💸
              </span>
              {role !== "PARTNER" ? (
                <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-bold text-white group-hover:bg-white group-hover:text-rose-800 transition">
                  + খরচ এন্ট্রি
                </span>
              ) : (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-rose-100">
                  দৈনিক ব্যয়
                </span>
              )}
            </div>
            <h3 className="mt-3 text-lg font-black tracking-tight">মিল ভাড়া ও খরচ এন্ট্রি</h3>
            <p className="text-xs text-rose-100 line-clamp-1">
              মাসিক মিল ভাড়া, বিদ্যুৎ বিল, লেবার বা অন্য খরচ
            </p>
            <div className="mt-4 border-t border-white/20 pt-2 text-[11px] font-bold text-rose-50">
              আজকের মোট খরচ:{" "}
              <span className="text-white font-black text-xs">
                {formatBnCurrency(todayExpenses)}
              </span>
            </div>
          </div>

          {/* Card 3: ধান প্রাপ্তি (Blue) */}
          <div
            onClick={() => {
              if (role === "PARTNER") return;
              setErrorMsg(null);
              setSuccessMsg(null);
              setActiveModal("PADDY");
            }}
            className={`rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 p-4 text-white shadow-sm transition-all duration-150 ${
              role === "PARTNER"
                ? ""
                : "group cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl backdrop-blur-xs">
                🌾
              </span>
              {role !== "PARTNER" ? (
                <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-bold text-white group-hover:bg-white group-hover:text-blue-800 transition">
                  + ধান গ্রহণ
                </span>
              ) : (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-blue-100">
                  ধান স্টক
                </span>
              )}
            </div>
            <h3 className="mt-3 text-lg font-black tracking-tight">ধান প্রাপ্তি</h3>
            <p className="text-xs text-blue-100 line-clamp-1">
              ধানের জাত, বস্তা ও SKL স্কেল ওজন
            </p>
            <div className="mt-4 border-t border-white/20 pt-2 text-[11px] font-bold text-blue-50">
              আজকের ধান:{" "}
              <span className="text-white font-black text-xs">
                {toBn(todayPaddyBags)} বস্তা ({toBn(todayPaddyKg.toLocaleString())} কেজি)
              </span>
            </div>
          </div>

          {/* Card 4: ডায়ার ও ছাটাই (Amber/Orange) */}
          <div
            onClick={() => {
              if (role === "PARTNER") return;
              setErrorMsg(null);
              setSuccessMsg(null);
              setActiveModal("DRYER");
            }}
            className={`rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 p-4 text-white shadow-sm transition-all duration-150 ${
              role === "PARTNER"
                ? ""
                : "group cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl backdrop-blur-xs">
                ♨️
              </span>
              {role !== "PARTNER" ? (
                <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-bold text-white group-hover:bg-white group-hover:text-amber-800 transition">
                  + ডায়ার এন্ট্রি
                </span>
              ) : (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                  মিলিং স্টক
                </span>
              )}
            </div>
            <h3 className="mt-3 text-lg font-black tracking-tight">ডায়ার ও ছাটাই</h3>
            <p className="text-xs text-amber-100 line-clamp-1">
              ডায়ার নং ও ব্যবহৃত ধানের বস্তার হিসাব
            </p>
            <div className="mt-4 border-t border-white/20 pt-2 text-[11px] font-bold text-amber-50">
              আজকের মোট ছাটাই:{" "}
              <span className="text-white font-black text-xs">
                {toBn(todayMilledBags)} বস্তা
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ────────────────── ব্যাংক ও মালিকদের তহবিল (Bank & Partners) CARD ────────────────── */}
      <div className="no-print rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-slate-50 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-blue-200 pb-3 gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-700 text-white text-lg shadow-xs">
              🏦
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-black text-ink-900 flex items-center gap-2">
                ব্যাংক ও মালিকদের তহবিল (Bank & Partners)
                <span className="rounded-full bg-blue-100 text-blue-900 px-2.5 py-0.5 text-[11px] font-bold">
                  স্বতন্ত্র খতিয়ান
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                মিলের ব্যাংক জমা-উত্তোলন এবং দুই মালিকের মূলধন তহবিল (লাভ-ক্ষতির বাইরে পৃথক খতিয়ান)
              </p>
            </div>
          </div>
          <Link
            href="/rented-mill/bank-and-partners"
            className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline"
          >
            পূর্ণাঙ্গ খতিয়ান পেজ →
          </Link>
        </div>

        {/* 3 Metric Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
          {/* 1. মিলের ব্যাংক ব্যালেন্স */}
          <div className="rounded-xl border border-blue-200 bg-white p-3 shadow-2xs">
            <span className="text-xs font-semibold text-blue-800 block">মিলের মোট ব্যাংক ব্যালেন্স</span>
            <span className="text-xl font-black text-blue-950 block mt-0.5">
              {formatBnCurrency(totalBankBalance)}
            </span>
            <span className="text-[11px] text-slate-500 block mt-1">
              সক্রিয় ব্যাংক অ্যাকাউন্ট: {toBn(bankAccounts.length)} টি
            </span>
          </div>

          {/* 2. নাহিদ হাসান (মালিক ১) */}
          <div className="rounded-xl border border-brand-200 bg-white p-3 shadow-2xs">
            <span className="text-xs font-semibold text-brand-800 block">{partner1Name} (মালিক ১)</span>
            <span className={`text-xl font-black block mt-0.5 ${partner1Net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {formatBnCurrency(partner1Net)}
            </span>
            <span className="text-[11px] text-slate-500 block mt-1">
              {partner1Net >= 0 ? "মিলের নিকট নিট পাওনা (জমা)" : "মিলকে নিট প্রদেয় (উত্তোলন)"}
            </span>
          </div>

          {/* 3. পার্টনার (মালিক ২) */}
          <div className="rounded-xl border border-emerald-200 bg-white p-3 shadow-2xs">
            <span className="text-xs font-semibold text-emerald-800 block">{partner2Name} (মালিক ২)</span>
            <span className={`text-xl font-black block mt-0.5 ${partner2Net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {formatBnCurrency(partner2Net)}
            </span>
            <span className="text-[11px] text-slate-500 block mt-1">
              {partner2Net >= 0 ? "মিলের নিকট নিট পাওনা (জমা)" : "মিলকে নিট প্রদেয় (উত্তোলন)"}
            </span>
          </div>
        </div>

        {/* 4 Action Buttons directly on the card */}
        <div className="pt-3 border-t border-blue-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (role === "PARTNER") return;
                setFundModalType("BANK_DEPOSIT");
              }}
              disabled={role === "PARTNER"}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-blue-800 transition disabled:opacity-50"
            >
              <span>+</span> ব্যাংকে জমা
            </button>
            <button
              type="button"
              onClick={() => {
                if (role === "PARTNER") return;
                setFundModalType("BANK_WITHDRAW");
              }}
              disabled={role === "PARTNER"}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-100 border border-blue-300 px-3 py-1.5 text-xs font-bold text-blue-900 hover:bg-blue-200 transition disabled:opacity-50"
            >
              <span>-</span> ব্যাংক উত্তোলন
            </button>
            <button
              type="button"
              onClick={() => {
                if (role === "PARTNER") return;
                setFundModalType("PARTNER_DEPOSIT");
              }}
              disabled={role === "PARTNER"}
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-800 transition disabled:opacity-50"
            >
              <span>+</span> মালিকের টাকা জমা
            </button>
            <button
              type="button"
              onClick={() => {
                if (role === "PARTNER") return;
                setFundModalType("PARTNER_WITHDRAW");
              }}
              disabled={role === "PARTNER"}
              className="inline-flex items-center gap-1 rounded-xl bg-rose-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-rose-800 transition disabled:opacity-50"
            >
              <span>-</span> মালিকের টাকা উত্তোলন
            </button>
          </div>
          <Link
            href="/rented-mill/bank-and-partners"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            <span>📑</span> বিস্তারিত স্টেটমেন্ট
          </Link>
        </div>
      </div>

      {/* ────────────────── 2. "অনুমোদনের অপেক্ষায়" (PENDING APPROVAL) CARD ────────────────── */}
      <div className="no-print rounded-2xl border-2 border-amber-300 bg-amber-50/50 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white font-bold text-sm">
              ⏳
            </span>
            <div>
              <h3 className="text-base font-black text-ink-900 flex items-center gap-2">
                অনুমোদনের অপেক্ষায় (Pending Approval)
                {pendingItems.length > 0 && (
                  <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-xs text-white font-bold">
                    {toBn(pendingItems.length)} টি অপেক্ষমান
                  </span>
                )}
              </h3>
              <p className="text-xs text-amber-900">
                {role === "SUPER_ADMIN"
                  ? "হিসাবরক্ষকের দেওয়া এন্ট্রিগুলো যাচাই করে অনুমোদন দিন। অনুমোদনের পরেই তা মূল খতিয়ান ও ৫০:৫০ লাভে যোগ হবে।"
                  : role === "PARTNER"
                  ? "হিসাবরক্ষকের দেওয়া যেসব নতুন এন্ট্রি এখনও সুপার অ্যাডমিনের অনুমোদনের অপেক্ষায় রয়েছে।"
                  : "আপনার দেওয়া নতুন এন্ট্রিগুলো সুপার অ্যাডমিন / নাহিদ হাসান অনুমোদন দেওয়ার পর চূড়ান্ত হিসাবে যুক্ত হবে।"}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-200">
              রোল:{" "}
              {role === "SUPER_ADMIN"
                ? "মালিক (নাহিদ হাসান - পূর্ণ নিয়ন্ত্রণ)"
                : role === "PARTNER"
                ? "পার্টনার (৫০% - শুধু দেখার অনুমতি)"
                : "হিসাবরক্ষক (Accountant)"}
            </span>
          </div>
        </div>

        {/* Pending Items List */}
        <div className="mt-3">
          {pendingItems.length === 0 ? (
            <div className="py-6 text-center text-xs sm:text-sm text-ink-500">
              <span className="text-2xl block mb-1">🎉</span>
              বর্তমানে কোনো এন্ট্রি অনুমোদনের অপেক্ষায় নেই। সকল এন্ট্রি অনুমোদিত ও হালনাগাদ রয়েছে।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-amber-200 bg-amber-100/60 text-[11px] sm:text-xs font-bold text-amber-950 uppercase">
                    <th className="py-2 px-3">তারিখ</th>
                    <th className="py-2 px-3">ধরণ</th>
                    <th className="py-2 px-3">রশিদ/ভাউচার</th>
                    <th className="py-2 px-3">পার্টি/বিবরণ</th>
                    <th className="py-2 px-3 text-right">টাকা/পরিমাণ</th>
                    <th className="py-2 px-3">এন্ট্রি প্রদানকারী</th>
                    <th className="py-2 px-3 text-center">স্ট্যাটাস</th>
                    <th className="py-2 px-3 text-right">কার্যক্রম</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-200 font-medium">
                  {pendingItems.map((item) => (
                    <tr key={`${item.type}-${item.id}`} className="hover:bg-amber-100/40">
                      <td className="py-2.5 px-3 whitespace-nowrap text-ink-800">
                        {getBengaliDateLabel(new Date(item.date))}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold text-amber-950">
                          {item.typeLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono font-semibold text-ink-900">
                        {item.refNo}
                      </td>
                      <td className="py-2.5 px-3 text-ink-800">
                        <div className="font-semibold text-ink-900">{item.title}</div>
                        <div className="text-[11px] text-ink-600">{item.details}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold text-ink-900">
                        {item.amount !== undefined ? formatBnCurrency(item.amount) : "—"}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-ink-700">
                        <span className="text-xs font-semibold">{item.createdByName}</span>
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          ⏳ PENDING
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {role === "PARTNER" ? (
                          <span className="text-[11px] text-ink-500 font-semibold italic">
                            অ্যাডমিনের সিদ্ধান্তের অপেক্ষায়
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            {/* ১. সম্পাদনা (Edit) বাটন */}
                            <button
                              type="button"
                              onClick={() => setEditingItem(item)}
                              title="সম্পাদনা করুন (Edit)"
                              className="rounded-lg border border-slate-200 bg-white hover:bg-brand-50 hover:text-brand-700 hover:border-brand-300 px-2 py-1 text-xs font-bold text-ink-700 transition"
                            >
                              ✏️ সম্পাদনা
                            </button>

                            {/* ২. অনুমোদন (Approve) ও ৩. বাতিল (Reject) বাটন (সুপার অ্যাডমিন / নাহিদ হাসান) */}
                            {role === "SUPER_ADMIN" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleApprove(item)}
                                  disabled={processingId === item.id}
                                  title="অনুমোদন করুন (Approve)"
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-bold transition disabled:opacity-50"
                                >
                                  {processingId === item.id ? "..." : "✓ অনুমোদন"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReject(item)}
                                  disabled={processingId === item.id}
                                  title="বাতিল করুন (Reject)"
                                  className="rounded-lg bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 text-xs font-bold transition disabled:opacity-50"
                                >
                                  ✕ বাতিল
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] text-amber-800 font-medium italic">
                                (অনুমোদনের অপেক্ষায়)
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ────────────────── 3. MODALS ────────────────── */}

      {/* MODAL 1: Receive Cash */}
      {activeModal === "CASH" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            id="dashboard-cash-modal-form"
            onSubmit={handleCashSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-emerald-900 flex items-center gap-2">
                <span>💵</span> রিসিভ ক্যাশ (টাকা জমা এন্ট্রি)
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-ink-400 hover:text-ink-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-3.5 text-xs sm:text-sm">
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

              <div>
                <label className="mb-1 block font-semibold text-ink-700">
                  পার্টির নাম (বকেয়া / ছাটাই বিল আদায়) <span className="text-red-500">*</span>
                </label>
                <select
                  value={cashPartyId}
                  onChange={(e) => setCashPartyId(e.target.value)}
                  className="input w-full font-bold text-ink-900 border-emerald-300 focus:border-emerald-600"
                  required
                >
                  <option value="">-- অনুগ্রহ করে পার্টি নির্বাচন করুন (বাধ্যতামূলক) --</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.phone ? `(${p.phone})` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  * কার নিকট থেকে টাকা জমা নেওয়া হচ্ছে তা দৈনিক জমা খরচ রিপোর্টে স্পষ্ট দেখানোর জন্য পার্টি নির্বাচন করা আবশ্যক।
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">জমার তারিখ *</label>
                  <input
                    type="date"
                    value={cashDate}
                    onChange={(e) => setCashDate(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">জমার মাধ্যম</label>
                  <select
                    value={cashMethod}
                    onChange={(e) => setCashMethod(e.target.value)}
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
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
                  className="input w-full font-bold text-emerald-800 text-base"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">মন্তব্য / বিবরণ</label>
                <input
                  type="text"
                  placeholder="যেমন: রশিদ নং বা চেকের বিবরণ"
                  value={cashNotes}
                  onChange={(e) => setCashNotes(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="btn-outline text-xs"
                disabled={isSubmitting}
              >
                বাতিল
              </button>
              <button
                type="submit"
                form="dashboard-cash-modal-form"
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 font-bold text-xs shadow-xs"
                disabled={isSubmitting}
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "টাকা গ্রহণ নিশ্চিত করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: Expense & Payment */}
      {activeModal === "EXPENSE" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            id="dashboard-expense-modal-form"
            onSubmit={handleExpenseSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-rose-900 flex items-center gap-2">
                <span>💸</span> মিল ভাড়া ও খরচ এন্ট্রি
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-ink-400 hover:text-ink-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-3.5 text-xs sm:text-sm">
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

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-ink-700">খরচের খাত *</label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryManager(true)}
                    className="text-[11px] text-rose-600 font-semibold hover:underline flex items-center gap-1"
                  >
                    <span>➕</span> নতুন খতিয়ান
                  </button>
                </div>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="input w-full font-semibold"
                  required
                >
                  {categoryList.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">খরচের তারিখ *</label>
                  <input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">টাকার পরিমাণ (৳) *</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="যেমন: ২৫০০"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="input w-full font-bold text-rose-800 text-base"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">কার কাছে প্রদান (Paid To)</label>
                <input
                  type="text"
                  placeholder="যেমন: মিল মালিক, বিদ্যুৎ অফিস, ড্রাইভার"
                  value={expPaidTo}
                  onChange={(e) => setExpPaidTo(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">খরচের বিস্তারিত বিবরণ</label>
                <input
                  type="text"
                  placeholder="যেমন: মবিল ক্রয়, বেল্ট পরিবর্তন ইত্যাদি"
                  value={expDescription}
                  onChange={(e) => setExpDescription(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="btn-outline text-xs"
                disabled={isSubmitting}
              >
                বাতিল
              </button>
              <button
                type="submit"
                form="dashboard-expense-modal-form"
                className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 font-bold text-xs shadow-xs"
                disabled={isSubmitting}
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "খরচ সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: Paddy Receipt */}
      {activeModal === "PADDY" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            id="dashboard-paddy-modal-form"
            onSubmit={handlePaddySubmit}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-blue-900 flex items-center gap-2">
                <span>🌾</span> নতুন ধান প্রাপ্তি ও স্কেল এন্ট্রি
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-ink-400 hover:text-ink-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-3.5 text-xs sm:text-sm">
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

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-ink-700">পার্টি নির্বাচন করুন *</label>
                  <button
                    type="button"
                    onClick={() => setIsNewPaddyParty(!isNewPaddyParty)}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    {isNewPaddyParty ? "পূর্বের পার্টি নির্বাচন" : "+ নতুন পার্টি"}
                  </button>
                </div>
                {isNewPaddyParty ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="পার্টির নাম *"
                      value={newPartyName}
                      onChange={(e) => setNewPartyName(e.target.value)}
                      className="input w-full font-semibold"
                      required
                    />
                    <input
                      type="text"
                      placeholder="মোবাইল নম্বর"
                      value={newPartyPhone}
                      onChange={(e) => setNewPartyPhone(e.target.value)}
                      className="input w-full"
                    />
                  </div>
                ) : (
                  <select
                    value={paddyPartyId}
                    onChange={(e) => setPaddyPartyId(e.target.value)}
                    className="input w-full font-semibold"
                    required
                  >
                    <option value="">পার্টি নির্বাচন করুন</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.phone ? `(${p.phone})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">প্রাপ্তির তারিখ *</label>
                  <input
                    type="date"
                    value={paddyDate}
                    onChange={(e) => setPaddyDate(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">সময়</label>
                  <input
                    type="text"
                    placeholder="যেমন: ১০:৩০ AM"
                    value={paddyTime}
                    onChange={(e) => setPaddyTime(e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">ধানের জাত / নাম *</label>
                <div className="flex gap-1.5 mb-1.5 flex-wrap">
                  {["ব্রি-২৮", "স্বর্ণা", "জিরাশাইল", "কাটারি", "মিনিকেট"].map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setPaddyName(name)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                        paddyName === name
                          ? "bg-blue-600 text-white"
                          : "bg-ink-100 text-ink-700 hover:bg-ink-200"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="ধানের নাম"
                  value={paddyName}
                  onChange={(e) => setPaddyName(e.target.value)}
                  className="input w-full"
                  required
                />
              </div>

              {/* 1. দুই ধরনের বস্তার সংখ্যা (চট ও প্লাস্টিক) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">
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
                    className="input w-full font-bold text-base"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">
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
                    className="input w-full font-bold text-base"
                  />
                </div>
              </div>

              {/* বস্তা ও ধলতা সামারি ব্যাজ */}
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-ink-800 flex items-center justify-between font-semibold">
                <span>মোট বস্তা: <b className="text-sm font-black text-ink-900">{toBn(totalPaddyBagsCount)} টি</b></span>
                <span className="text-amber-800">স্বয়ংক্রিয় ধলতা: <b>{toBn(autoDhaltaKg)} কেজি</b></span>
              </div>

              {/* ২. স্কেল ওজন ও ধলতা কর্তন */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">
                    মোট SKL স্কেল ওজন (কেজি) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="যেমন: ৩৭৫০"
                    value={grossSkl}
                    onChange={(e) =>
                      setGrossSkl(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className="input w-full font-bold text-blue-800 text-base"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">
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
                    className="input w-full font-semibold text-amber-900"
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
                  <span>৭৫-এ স্ট্যান্ডার্ড বস্তা: <b className="text-sm font-black text-blue-950">{toBn(standard75BagsCount)} টি</b></span>
                  <span>মোট মণ (৪০ কেজিতে): <b>{toBn(maundsCount)} মণ</b></span>
                </div>
              </div>

              {/* ৪. প্রতি ৭৫ কেজি বস্তার দর ও মোট বিল হিসাব */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">
                    ৭৫-কেজি বস্তার দর (টাকা) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="যেমন: ১০০"
                    value={ratePerStandardBag}
                    onChange={(e) =>
                      setRatePerStandardBag(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className="input w-full font-bold text-base"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">
                    মোট বিল টাকা (খতিয়ানে পাওনা)
                  </label>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-2 text-right">
                    <span className="text-base font-black text-emerald-800">
                      {formatBnCurrency(totalMillingBillAmount)}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">নোট / গাড়ির নম্বর</label>
                <input
                  type="text"
                  placeholder="যেমন: ট্রাক নং বা ড্রাইভারের ফোন"
                  value={paddyNotes}
                  onChange={(e) => setPaddyNotes(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="btn-outline text-xs"
                disabled={isSubmitting}
              >
                বাতিল
              </button>
              <button
                type="submit"
                form="dashboard-paddy-modal-form"
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 font-bold text-xs shadow-xs"
                disabled={isSubmitting}
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "ধান গ্রহণ নিশ্চিত করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: Dryer Milling */}
      {activeModal === "DRYER" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            id="dashboard-dryer-modal-form"
            onSubmit={handleDryerSubmit}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header (Fixed) */}
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-amber-900 flex items-center gap-2">
                <span>♨️</span> ডায়ার ও ছাটাই এন্ট্রি
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-ink-400 hover:text-ink-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-3.5 text-xs sm:text-sm">
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

              <div>
                <label className="mb-1 block font-semibold text-ink-700">পার্টি নির্বাচন করুন *</label>
                <select
                  value={dryerPartyId}
                  onChange={(e) => setDryerPartyId(e.target.value)}
                  className="input w-full font-semibold"
                  required
                >
                  <option value="">পার্টি নির্বাচন করুন</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.phone ? `(${p.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">ছাটাইয়ের তারিখ *</label>
                  <input
                    type="date"
                    value={dryerDate}
                    onChange={(e) => setDryerDate(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-ink-700">ডায়ার নম্বর *</label>
                    <button
                      type="button"
                      onClick={() => setShowDryerManager(true)}
                      className="text-[11px] text-brand-600 font-semibold hover:underline flex items-center gap-1"
                    >
                      <span>✏️</span> নাম সম্পাদনা / নতুন
                    </button>
                  </div>
                  <select
                    value={dryerNo}
                    onChange={(e) => setDryerNo(e.target.value)}
                    className="input w-full font-semibold"
                    required
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

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">ব্যবহৃত বস্তা (Standard) *</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="যেমন: ৫০"
                    value={dryerUsedBags}
                    onChange={(e) => setDryerUsedBags(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="input w-full font-bold text-amber-900 text-base"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-ink-700">ছাটাইকৃত কেজি</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="যেমন: ২৫০০"
                    value={dryerMilledKg}
                    onChange={(e) => setDryerMilledKg(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    className="input w-full font-bold text-base"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink-700">নোট / মন্তব্য</label>
                <input
                  type="text"
                  placeholder="যেমন: সিদ্ধ বা আতপ বা অন্য বিবরণ"
                  value={dryerNotes}
                  onChange={(e) => setDryerNotes(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="btn-outline text-xs"
                disabled={isSubmitting}
              >
                বাতিল
              </button>
              <button
                type="submit"
                form="dashboard-dryer-modal-form"
                className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 font-bold text-xs shadow-xs"
                disabled={isSubmitting}
              >
                {isSubmitting ? "সংরক্ষণ হচ্ছে..." : "ডায়ার এন্ট্রি নিশ্চিত করুন"}
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

      {/* খরচের খাত ব্যবস্থাপনা ও নতুন খাত যোগ করার মডাল */}
      <ExpenseCategoryModal
        isOpen={showCategoryManager}
        onClose={() => setShowCategoryManager(false)}
        currentCategories={categoryList}
        onSaved={(newCategory, updatedList) => {
          setCategoryList(updatedList);
          setExpCategory(newCategory);
          router.refresh();
        }}
      />

      {/* ────────────────── 4. PENDING ITEMS EDIT MODALS ────────────────── */}
      {editingItem && editingItem.type === "PADDY_RECEIPT" && (
        <EditPaddyReceiptModal
          receipt={editingItem.rawData}
          parties={parties}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
      {editingItem && editingItem.type === "DRYER_MILLING" && (
        <EditDryerMillingModal
          entry={editingItem.rawData}
          parties={parties}
          dryerNames={dryerList}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
      {editingItem && editingItem.type === "PAYMENT" && (
        <EditPaymentModal
          payment={editingItem.rawData}
          parties={parties}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
      {editingItem && editingItem.type === "EXPENSE" && (
        <EditExpenseModal
          expense={editingItem.rawData}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
      {editingItem && editingItem.type === "MILLING_BILL" && (
        <EditMillingBillModal
          bill={editingItem.rawData}
          parties={parties}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
      {editingItem && editingItem.type === "BYPRODUCT_SALE" && (
        <EditByproductSaleModal
          sale={editingItem.rawData}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
      {/* Fund Transaction Modals */}
      <FundTransactionModal
        isOpen={fundModalType !== null}
        onClose={() => setFundModalType(null)}
        modalType={fundModalType}
        partner1Name={partner1Name}
        partner2Name={partner2Name}
        bankAccounts={bankAccounts}
      />
      {editingItem && editingItem.type === "FUND_TRANSACTION" && (
        <EditFundTransactionModal
          transaction={editingItem.rawData}
          bankAccounts={bankAccounts}
          isOpen={true}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}
