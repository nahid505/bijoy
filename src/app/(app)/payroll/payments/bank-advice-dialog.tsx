"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MONTH_NAMES } from "@/lib/payroll";
import { toDateInput, formatMoney, toBnDigits } from "@/lib/format";
import { useToast } from "@/components/toaster";
import {
  postBankSalaryAdvicePaymentAction,
  getBankDisbursementPreviewAction,
  executeBankDisbursementAction,
  requestDisbursementOtpAction,
} from "@/server/actions/payroll";
import type { DisbursementPreview, DisbursementResult } from "@/server/services/bankDisbursement";

export interface BankAccountOption {
  id: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  isApiEnabled?: boolean;
  apiProvider?: string | null;
}

export function BankSalaryAdviceDialog({
  bankAccounts,
  defaultBankAccountId,
  currentYear,
  currentMonth,
}: {
  bankAccounts: BankAccountOption[];
  defaultBankAccountId?: string | null;
  currentYear: number;
  currentMonth: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"ADVICE" | "DIRECT_API">("ADVICE");

  // Common parameters
  const [bankAccountId, setBankAccountId] = useState(defaultBankAccountId || bankAccounts[0]?.id || "");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [paymentDate, setPaymentDate] = useState(toDateInput());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  // Manual Advice File parameters
  const [adviceTemplate, setAdviceTemplate] = useState<"standard" | "dbbl">("dbbl");
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  const [autoPost, setAutoPost] = useState(false);

  // Direct Bank API parameters
  const [preview, setPreview] = useState<DisbursementPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [securityPin, setSecurityPin] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [showEmployeesList, setShowEmployeesList] = useState(false);
  const [lastResult, setLastResult] = useState<DisbursementResult | null>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  // Load preview when opening or switching to DIRECT_API
  useEffect(() => {
    if (open && method === "DIRECT_API" && bankAccountId) {
      loadPreview(year, month, bankAccountId);
    }
  }, [open, method, bankAccountId, year, month]);

  const loadPreview = async (y: number, m: number, accId: string) => {
    setLoadingPreview(true);
    try {
      const res = await getBankDisbursementPreviewAction({
        year: y,
        month: m,
        bankAccountId: accId,
      });
      if (res.ok && res.data) {
        setPreview(res.data);
      } else {
        setPreview(null);
        if (res.message) toast(res.message, "error");
      }
    } catch {
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSendOtp = async () => {
    setSendingOtp(true);
    setOtpMessage(null);
    try {
      const res = await requestDisbursementOtpAction();
      if (res.ok) {
        toast(res.message, "success");
        setOtpMessage(res.message);
      } else {
        toast(res.message, "error");
      }
    } catch {
      toast("ওটিপি পাঠাতে সমস্যা হয়েছে", "error");
    } finally {
      setSendingOtp(false);
    }
  };

  // 1. Submit Manual Offline Advice
  const handleAdviceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountId) {
      toast("অনুগ্রহ করে অর্থ প্রদানের ব্যাংক অ্যাকাউন্ট নির্বাচন করুন", "error");
      return;
    }

    setBusy(true);
    try {
      if (autoPost) {
        const res = await postBankSalaryAdvicePaymentAction({
          year,
          month,
          bankAccountId,
          reference: reference.trim() || undefined,
          date: paymentDate,
        });

        if (!res.ok) {
          toast(res.message, "error");
          setBusy(false);
          return;
        }

        toast(res.message, "success");
        startTransition(() => {
          router.refresh();
        });
      }

      // Download or open advice letter
      const refParam = reference.trim() ? `&ref=${encodeURIComponent(reference.trim())}` : "";
      const templateParam = adviceTemplate === "dbbl" ? "&template=dbbl" : "&template=standard";
      if (format === "pdf") {
        window.open(
          `/payroll/payments/bank-advice?year=${year}&month=${month}&accountId=${bankAccountId}${templateParam}${refParam}`,
          "_blank"
        );
      } else {
        const url = `/api/payroll/bank-advice?year=${year}&month=${month}&accountId=${bankAccountId}${templateParam}&format=${format}${refParam}`;
        const filename = adviceTemplate === "dbbl"
          ? `dbbl-rocket-salary-advice-${year}-${String(month).padStart(2, "0")}.${format}`
          : `salary-advice-${year}-${String(month).padStart(2, "0")}.${format}`;
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      setOpen(false);
    } catch {
      toast("ব্যাংক স্যালারি শিট প্রক্রিয়াকরণ ব্যর্থ হয়েছে", "error");
    } finally {
      setBusy(false);
    }
  };

  // 2. Submit Direct Bank API Transfer
  const handleApiDisbursementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountId) {
      toast("অনুগ্রহ করে ব্যাংক অ্যাকাউন্ট নির্বাচন করুন", "error");
      return;
    }
    if (!securityPin.trim() && !otpCode.trim()) {
      toast("পেমেন্ট অনুমোদনের জন্য আপনার পাসওয়ার্ড/পিন বা ওটিপি প্রদান করুন", "error");
      return;
    }

    setBusy(true);
    try {
      const res = await executeBankDisbursementAction({
        year,
        month,
        bankAccountId,
        date: paymentDate ? new Date(paymentDate) : null,
        reference: reference.trim() || null,
        securityPin: securityPin.trim() || null,
        otpCode: otpCode.trim() || null,
      });

      setLastResult(res);

      if (res.ok) {
        toast(res.message, "success");
        startTransition(() => {
          router.refresh();
        });
      } else {
        toast(res.message, "error");
      }
    } catch {
      toast("ব্যাংক ফান্ড ট্রান্সফার প্রক্রিয়াকরণ ব্যর্থ হয়েছে", "error");
    } finally {
      setBusy(false);
    }
  };

  const years = [currentYear - 1, currentYear, currentYear + 1];
  const selectedAccount = bankAccounts.find((a) => a.id === bankAccountId);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setLastResult(null);
        }}
        className="btn-secondary inline-flex items-center gap-1.5"
      >
        <span>💳</span>
        <span>বেতন পরিশোধ ও ব্যাংক অ্যাডভাইস</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setAdviceTemplate("dbbl");
          setMethod("ADVICE");
          const dbblAcc = bankAccounts.find((b) => {
            const n = (b.bankName || b.name || "").toLowerCase();
            return (
              n.includes("dutch") ||
              n.includes("dbbl") ||
              n.includes("ডাচ-বাংলা") ||
              n.includes("rocket") ||
              n.includes("রকেট")
            );
          });
          if (dbblAcc) {
            setBankAccountId(dbblAcc.id);
          }
          setOpen(true);
          setLastResult(null);
        }}
        className="btn-secondary inline-flex items-center gap-1.5 border-emerald-500/40 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 font-medium"
      >
        <span>🏦</span>
        <span>DBBL / Rocket Salary Advice</span>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="modal rounded-2xl border border-rule bg-white p-0 shadow-2xl backdrop:bg-slate-900/50 max-w-xl w-full"
      >
        {/* Header */}
        <div className="border-b border-rule px-5 py-4 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏦</span>
            <div>
              <h2 className="text-base font-bold text-ink-900">ডুয়েল-মেথড বেতন পরিশোধ (Payroll Disbursement)</h2>
              <p className="text-xs text-slate-500">ব্যাংক অ্যাডভাইস এক্সপোর্ট অথবা সরাসরি ব্যাংক API ফান্ড ট্রান্সফার</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-slate-400 hover:text-slate-600 font-bold text-lg leading-none p-1.5 rounded-lg hover:bg-slate-200"
            aria-label="বন্ধ করুন"
          >
            ✕
          </button>
        </div>

        {/* Dual-Method Selector Tab */}
        <div className="p-5 pb-0">
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl gap-1 text-center font-medium text-xs sm:text-sm">
            <button
              type="button"
              onClick={() => setMethod("ADVICE")}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                method === "ADVICE"
                  ? "bg-white text-ink-900 font-bold shadow-sm"
                  : "text-slate-600 hover:text-ink-900"
              }`}
            >
              <span>📄</span>
              <span>ব্যাংক অ্যাডভাইস ফাইল (ম্যানুয়াল)</span>
            </button>
            <button
              type="button"
              onClick={() => setMethod("DIRECT_API")}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                method === "DIRECT_API"
                  ? "bg-brand-600 text-white font-bold shadow-sm"
                  : "text-slate-600 hover:text-ink-900"
              }`}
            >
              <span>⚡</span>
              <span>সরাসরি ব্যাংক ট্রান্সফার (API)</span>
            </button>
          </div>
        </div>

        {/* METHOD 1: OFFLINE ADVICE FILE */}
        {method === "ADVICE" && (
          <form onSubmit={handleAdviceSubmit} className="p-5 space-y-4">
            {/* ব্যাংক অ্যাকাউন্ট */}
            <div>
              <label className="label" htmlFor="adv-bank-account-select">
                অর্থ প্রদানের ব্যাংক (যে ব্যাংক থেকে বেতন দেওয়া হবে) *
              </label>
              <select
                id="adv-bank-account-select"
                className="input w-full"
                value={bankAccountId}
                onChange={(e) => {
                  const newId = e.target.value;
                  setBankAccountId(newId);
                  const acc = bankAccounts.find((b) => b.id === newId);
                  if (acc) {
                    const n = (acc.bankName || acc.name || "").toLowerCase();
                    if (
                      n.includes("dutch") ||
                      n.includes("dbbl") ||
                      n.includes("ডাচ-বাংলা") ||
                      n.includes("rocket") ||
                      n.includes("রকেট")
                    ) {
                      setAdviceTemplate("dbbl");
                    }
                  }
                }}
                required
              >
                {bankAccounts.length === 0 ? (
                  <option value="">কোনো ব্যাংক হিসাব পাওয়া যায়নি</option>
                ) : (
                  bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.bankName ? `(${b.bankName})` : ""} {b.accountNumber ? `[A/C: ${b.accountNumber}]` : ""}
                    </option>
                  ))
                )}
              </select>
              <p className="hint">এই অ্যাকাউন্টের বিপরীতে ব্যাংকের অ্যাডভাইস লেটার তৈরি হবে।</p>
            </div>

            {/* মাস ও বছর */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="adv-salary-month">বেতনের মাস *</label>
                <select
                  id="adv-salary-month"
                  className="input w-full"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="adv-salary-year">বছর *</label>
                <select
                  id="adv-salary-year"
                  className="input w-full"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ফরম্যাট ও টেমপ্লেট নির্বাচন */}
            <div className="space-y-2">
              <label className="label">স্যালারি অ্যাডভাইস ফরম্যাট নির্বাচন *</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdviceTemplate("dbbl")}
                  className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                    adviceTemplate === "dbbl"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-950 font-semibold ring-2 ring-emerald-500/20"
                      : "border-rule bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xl">🏦</span>
                  <div>
                    <span className="text-xs font-bold block">DBBL ও রকেট ফরম্যাট</span>
                    <span className="text-[10px] text-slate-500 block">৭ কলাম DBBL Corporate Bulk Upload</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAdviceTemplate("standard")}
                  className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                    adviceTemplate === "standard"
                      ? "border-brand-600 bg-brand-50 text-brand-950 font-semibold ring-2 ring-brand-500/20"
                      : "border-rule bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xl">🏛️</span>
                  <div>
                    <span className="text-xs font-bold block">সাধারণ ব্যাংক ফরম্যাট</span>
                    <span className="text-[10px] text-slate-500 block">অন্যান্য সব ব্যাংকের সাধারণ BEFTN</span>
                  </div>
                </button>
              </div>
            </div>

            {/* ডাউনলোড টাইপ নির্বাচন */}
            <div>
              <label className="label">ডাউনলোড ফাইল টাইপ *</label>
              <div className="grid grid-cols-3 gap-2">
                <label
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border cursor-pointer text-center transition-colors ${
                    format === "xlsx"
                      ? adviceTemplate === "dbbl"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900 font-bold"
                        : "border-brand-600 bg-brand-50 text-brand-900 font-bold"
                      : "border-rule bg-white text-ink-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value="xlsx"
                    checked={format === "xlsx"}
                    onChange={() => setFormat("xlsx")}
                    className="sr-only"
                  />
                  <span className="text-xl mb-1">📊</span>
                  <span className="text-xs">{adviceTemplate === "dbbl" ? "DBBL Excel" : "Excel (.xlsx)"}</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {adviceTemplate === "dbbl" ? "৭ কলাম বাল্ক" : "ব্যাংক আপলোড"}
                  </span>
                </label>

                <label
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border cursor-pointer text-center transition-colors ${
                    format === "csv"
                      ? adviceTemplate === "dbbl"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900 font-bold"
                        : "border-brand-600 bg-brand-50 text-brand-900 font-bold"
                      : "border-rule bg-white text-ink-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={format === "csv"}
                    onChange={() => setFormat("csv")}
                    className="sr-only"
                  />
                  <span className="text-xl mb-1">📄</span>
                  <span className="text-xs">{adviceTemplate === "dbbl" ? "DBBL CSV" : "CSV (BEFTN)"}</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {adviceTemplate === "dbbl" ? "রকেট ও ডিবিবিএল" : "EFT ফরম্যাট"}
                  </span>
                </label>

                <label
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border cursor-pointer text-center transition-colors ${
                    format === "pdf"
                      ? adviceTemplate === "dbbl"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900 font-bold"
                        : "border-brand-600 bg-brand-50 text-brand-900 font-bold"
                      : "border-rule bg-white text-ink-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value="pdf"
                    checked={format === "pdf"}
                    onChange={() => setFormat("pdf")}
                    className="sr-only"
                  />
                  <span className="text-xl mb-1">🖨️</span>
                  <span className="text-xs">{adviceTemplate === "dbbl" ? "DBBL লেটার" : "PDF Advice"}</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {adviceTemplate === "dbbl" ? "শাখা ব্যবস্থাপক" : "অফিশিয়াল লেটার"}
                  </span>
                </label>
              </div>
            </div>

            {/* রেফারেন্স */}
            <div>
              <label className="label" htmlFor="adv-ref-input">রেফারেন্স / স্মারক নম্বর (ঐচ্ছিক)</label>
              <input
                id="adv-ref-input"
                type="text"
                className="input w-full font-mono text-sm"
                placeholder={`BL/SAL/${year}/${String(month).padStart(2, "0")}`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>

            {/* লেজার ও ব্যালেন্স অটো-পোস্টিং চেকবক্স */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer text-sm font-semibold text-ink-900">
                <input
                  type="checkbox"
                  checked={autoPost}
                  onChange={(e) => setAutoPost(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-brand-600 focus:ring-brand-500"
                />
                <span>পেমেন্ট কনফার্ম করে লেজারে পোস্টিং করুন (অটো-পোস্ট)</span>
              </label>
              <p className="text-xs text-slate-600 pl-6 leading-relaxed">
                সংশ্লিষ্ট ব্যাংক হিসাব ক্রেডিট ও বেতন প্রদেয় ডেবিট হয়ে পেমেন্ট ভাউচার তৈরি হবে এবং সাথে সাথে লেজার ব্যালেন্স আপডেট হবে।
              </p>

              {autoPost && (
                <div className="pl-6 pt-1">
                  <label className="text-xs font-medium text-slate-700 block mb-1" htmlFor="adv-pay-date">
                    পরিশোধের তারিখ:
                  </label>
                  <input
                    id="adv-pay-date"
                    type="date"
                    className="input w-44 text-xs"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    required
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-rule">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost"
                disabled={busy}
              >
                বাতিল
              </button>
              <button
                type="submit"
                className="btn-primary inline-flex items-center gap-1.5"
                disabled={busy}
              >
                {busy ? "প্রক্রিয়াকরণ হচ্ছে..." : "📥 ফাইল ডাউনলোড ও সম্পন্ন করুন"}
              </button>
            </div>
          </form>
        )}

        {/* METHOD 2: DIRECT REAL-TIME BANK API TRANSFER */}
        {method === "DIRECT_API" && (
          <form onSubmit={handleApiDisbursementSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* ব্যাংক অ্যাকাউন্ট ও মাস নির্বাচন */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="api-bank-account-select">
                  প্রদানকারী ব্যাংক অ্যাকাউন্ট *
                </label>
                <select
                  id="api-bank-account-select"
                  className="input w-full"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  required
                >
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.bankName ? `(${b.bankName})` : ""} {b.accountNumber ? `[${b.accountNumber}]` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="api-salary-period">মাস ও বছর</label>
                <div className="flex gap-1">
                  <select
                    id="api-salary-period"
                    className="input w-full text-xs"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name.slice(0, 4)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input w-24 text-xs"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* LIVE PREVIEW CARD */}
            <div className="rounded-xl border border-rule bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  📊 ব্যালেন্স ও ট্রান্সফার প্রিভিউ
                </h3>
                {loadingPreview && <span className="text-xs text-brand-600 animate-pulse">হিসাব করা হচ্ছে…</span>}
              </div>

              {preview ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-white border border-rule">
                      <span className="text-slate-500 block">ব্যাংক ব্যালেন্স:</span>
                      <span className={`font-semibold text-sm ${preview.account.currentBalance < preview.summary.totalAmount ? "text-rose-600" : "text-emerald-700"}`}>
                        {formatMoney(preview.account.currentBalance, "৳")}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white border border-rule">
                      <span className="text-slate-500 block">মোট প্রদেয় বেতন:</span>
                      <span className="font-semibold text-sm text-brand-900">
                        {formatMoney(preview.summary.totalAmount, "৳")}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white border border-rule col-span-2 sm:col-span-1">
                      <span className="text-slate-500 block">কর্মচারী সংখ্যা:</span>
                      <span className="font-semibold text-sm">
                        {toBnDigits(preview.summary.readyCount)} জন প্রস্তুত
                        {preview.summary.missingInfoCount > 0 && (
                          <span className="text-amber-600 text-xs font-normal ml-1">
                            ({toBnDigits(preview.summary.missingInfoCount)} অপূর্ণ)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* ব্যালেন্স স্ট্যাটাস এলার্ট */}
                  {preview.account.currentBalance < preview.summary.totalAmount && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                      <span>⚠️</span>
                      <span>সতর্কতা: ব্যাংক অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই। ট্রান্সফারের পূর্বে ফান্ড নিশ্চিত করুন।</span>
                    </div>
                  )}

                  {/* কর্মচারীদের তালিকা প্রিভিউ টগল */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowEmployeesList(!showEmployeesList)}
                      className="text-xs text-brand-700 hover:underline inline-flex items-center gap-1 font-semibold"
                    >
                      <span>{showEmployeesList ? "▲ কর্মচারীদের তালিকা লুকান" : "▼ কর্মচারীদের তালিকা ও ব্যাংক বিবরণী দেখুন (" + toBnDigits(preview.employees.length) + " জন)"}</span>
                    </button>

                    {showEmployeesList && (
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-rule bg-white text-xs divide-y divide-rule">
                        {preview.employees.map((emp) => (
                          <div key={emp.employeeId} className="p-2 flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-ink-900">{emp.name}</span>
                                <span className="text-slate-500 text-[11px]">({emp.code})</span>
                                {emp.transferType === "ROCKET" ? (
                                  <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-800">
                                    রকেট
                                  </span>
                                ) : emp.transferType === "DBBL" ? (
                                  <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                                    DBBL
                                  </span>
                                ) : (
                                  <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-blue-800">
                                    BEFTN
                                  </span>
                                )}
                              </div>
                              <span className="block text-[11px] text-slate-500">
                                {emp.bankName || "ব্যাংক নেই"} · A/C: {emp.accountNumber || "অনুপস্থিত"} {emp.routingNumber ? `· Routing: ${emp.routingNumber}` : ""}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-semibold text-ink-900 block">{formatMoney(emp.amount, "৳")}</span>
                              {emp.isReady ? (
                                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">প্রস্তুত</span>
                              ) : (
                                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">{emp.missingReason}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-slate-500">
                  {loadingPreview ? "তথ্য লোড হচ্ছে…" : "বেতনের পে-স্লিপ বা তথ্য পাওয়া যায়নি"}
                </div>
              )}
            </div>

            {/* তারিখ ও রেফারেন্স */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="api-pay-date">পরিশোধের তারিখ</label>
                <input
                  id="api-pay-date"
                  type="date"
                  className="input w-full text-xs"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="api-ref-input">ব্যাংক রেফারেন্স (ঐচ্ছিক)</label>
                <input
                  id="api-ref-input"
                  type="text"
                  className="input w-full font-mono text-xs"
                  placeholder={`API-SAL-${year}-${String(month).padStart(2, "0")}`}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            {/* 2FA / SECURITY VERIFICATION SECTION */}
            <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔐</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-950">মালিকের নিরাপত্তা যাচাই (2FA Security)</h4>
                  <p className="text-[11px] text-slate-600">ফান্ড স্থানান্তরের জন্য মালিকের পাসওয়ার্ড/পিন অথবা এসএমএস ওটিপি প্রদান করুন</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="label text-xs" htmlFor="api-sec-pin">
                    পাসওয়ার্ড বা নিরাপত্তা পিন
                  </label>
                  <input
                    id="api-sec-pin"
                    type="password"
                    autoComplete="current-password"
                    className="input w-full text-xs"
                    placeholder="আপনার পাসওয়ার্ড বা পিন"
                    value={securityPin}
                    onChange={(e) => setSecurityPin(e.target.value)}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700" htmlFor="api-sec-otp">
                      অথবা SMS OTP কোড
                    </label>
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={sendingOtp}
                      className="text-[11px] text-brand-700 hover:underline font-semibold"
                    >
                      {sendingOtp ? "পাঠানো হচ্ছে…" : "ওটিপি পাঠান"}
                    </button>
                  </div>
                  <input
                    id="api-sec-otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="input w-full font-mono text-center text-xs tracking-widest"
                    placeholder="৬ অঙ্কের কোড"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                  />
                  {otpMessage && <p className="text-[10px] text-emerald-700 mt-1">{otpMessage}</p>}
                </div>
              </div>
            </div>

            {/* RESULTS DISPLAY AFTER SUBMIT */}
            {lastResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                  lastResult.status === "SUCCESS"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : lastResult.status === "PARTIAL"
                    ? "bg-amber-50 border-amber-200 text-amber-900"
                    : "bg-rose-50 border-rose-200 text-rose-900"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <span>{lastResult.status === "SUCCESS" ? "✅" : lastResult.status === "PARTIAL" ? "⚠️" : "❌"}</span>
                  <span>{lastResult.message}</span>
                </div>
                {lastResult.voucherNo && (
                  <p className="font-mono text-[11px]">
                    লেজার পেমেন্ট ভাউচার নম্বর: <b>{lastResult.voucherNo}</b>
                  </p>
                )}
                <div className="divide-y divide-rule/40 max-h-32 overflow-y-auto pt-1">
                  {lastResult.transfers.map((t) => (
                    <div key={t.id} className="py-1 flex justify-between items-center text-[11px]">
                      <span>{t.employeeName} ({t.accountNumber})</span>
                      <span>
                        {t.status === "SUCCESS" ? (
                          <span className="text-emerald-700 font-mono font-bold">✓ {t.bankTxId || "SUCCESS"}</span>
                        ) : (
                          <span className="text-rose-600 font-bold">✗ {t.errorMessage || "FAILED"}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-rule">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost"
                disabled={busy}
              >
                বন্ধ করুন
              </button>
              <button
                type="submit"
                className="btn-primary inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold py-2 px-4 rounded-xl shadow-md"
                disabled={busy || loadingPreview}
              >
                <span>⚡</span>
                <span>{busy ? "ব্যাংকে ট্রান্সফার হচ্ছে..." : "সরাসরি ব্যাংকে পেমেন্ট সম্পন্ন করুন"}</span>
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
