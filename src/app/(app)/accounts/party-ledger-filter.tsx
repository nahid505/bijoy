"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang";

interface PartyLedgerFilterProps {
  basePath: string;
  isCustomer: boolean;
  q?: string;
  from: string;
  to: string;
  filterStatus: string;
}

export function PartyLedgerFilter({
  basePath,
  isCustomer,
  q: initialQ = "",
  from: initialFrom,
  to: initialTo,
  filterStatus: initialStatus,
}: PartyLedgerFilterProps) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [status, setStatus] = useState(initialStatus);

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state if initial props change externally (e.g. back/forward navigation)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setQ(initialQ);
    }
  }, [initialQ]);

  useEffect(() => {
    setFrom(initialFrom);
  }, [initialFrom]);

  useEffect(() => {
    setTo(initialTo);
  }, [initialTo]);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const applyFilters = (values: { q: string; from: string; to: string; status: string }) => {
    const params = new URLSearchParams();
    const trimmed = values.q.trim();
    if (trimmed) params.set("q", trimmed);
    if (values.from) params.set("from", values.from);
    if (values.to) params.set("to", values.to);
    if (values.status && values.status !== "all") params.set("status", values.status);

    const qs = params.toString();
    const targetUrl = qs ? `${basePath}?${qs}` : basePath;
    startTransition(() => {
      router.replace(targetUrl, { scroll: false });
    });
  };

  // Debounced search on q change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (q !== initialQ) {
        applyFilters({ q, from, to, status });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const handleDateOrStatusChange = (newFrom: string, newTo: string, newStatus: string) => {
    applyFilters({ q, from: newFrom, to: newTo, status: newStatus });
  };

  const csvParams = new URLSearchParams();
  if (from) csvParams.set("from", from);
  if (to) csvParams.set("to", to);
  if (q.trim()) csvParams.set("q", q.trim());
  const csvQuery = csvParams.toString();
  const csvHref = `/api/reports/${isCustomer ? "customers" : "suppliers"}${csvQuery ? `?${csvQuery}` : ""}`;

  return (
    <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-1 sm:px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters({ q, from, to, status });
        }}
        className="no-print flex items-center gap-2 overflow-x-auto whitespace-nowrap py-1.5 no-scrollbar"
      >
        {/* 1. "খুঁজুন" ইনপুট (সংক্ষিপ্ত প্রস্থ যেমন: min-w-[140px] বা w-36) */}
        <div className="relative shrink-0">
          <input
            ref={inputRef}
            name="q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input h-8 w-36 sm:w-44 min-w-[140px] text-xs px-2.5 pr-6"
            placeholder={isCustomer ? t("নাম, কোড, মোবাইল…") : t("নাম, কোড, মোবাইল…")}
            title={t("খুঁজুন")}
          />
          {isPending ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-spin">
              ⏳
            </span>
          ) : q ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                applyFilters({ q: "", from, to, status });
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 p-0.5"
              title={t("মুছে ফেলুন")}
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* 2. "হতে" তারিখ পিকার (w-28 text-xs) */}
        <div className="flex items-center gap-1 shrink-0" title={t("হতে")}>
          <span className="text-[11px] text-slate-500 font-medium">{t("হতে")}:</span>
          <input
            type="date"
            name="from"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              handleDateOrStatusChange(e.target.value, to, status);
            }}
            className="input h-8 w-28 text-xs px-1.5 py-1"
          />
        </div>

        {/* 3. "পর্যন্ত" তারিখ পিকার (w-28 text-xs) */}
        <div className="flex items-center gap-1 shrink-0" title={t("পর্যন্ত")}>
          <span className="text-[11px] text-slate-500 font-medium">{t("পর্যন্ত")}:</span>
          <input
            type="date"
            name="to"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              handleDateOrStatusChange(from, e.target.value, status);
            }}
            className="input h-8 w-28 text-xs px-1.5 py-1"
          />
        </div>

        {/* 4. "ফিল্টার" ড্রপডাউন (w-24 text-xs) */}
        <select
          name="status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            handleDateOrStatusChange(from, to, e.target.value);
          }}
          className="input h-8 w-24 sm:w-28 text-xs px-1.5 py-1 shrink-0"
          title={t("ফিল্টার")}
        >
          <option value="all">{t("সকল")}</option>
          <option value="due">{isCustomer ? t("শুধু বকেয়া পাওনা") : t("শুধু দেনা")}</option>
        </select>

        {/* 5. "🖨️ প্রিন্ট" বাটন (shrink-0 text-xs px-2.5 py-1.5) */}
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-secondary shrink-0 text-xs px-2.5 py-1.5 h-8 flex items-center gap-1 font-medium"
          title={t("প্রিন্ট")}
        >
          <span>🖨️</span>
          <span>{t("প্রিন্ট")}</span>
        </button>

        {/* 6. "📊 Excel" বাটন (shrink-0 text-xs px-2.5 py-1.5) */}
        <a
          href={`${csvHref}${csvHref.includes("?") ? "&" : "?"}format=xlsx`}
          className="btn-secondary shrink-0 text-xs px-2.5 py-1.5 h-8 flex items-center gap-1 font-medium text-slate-700 hover:text-emerald-700"
          title="Excel"
        >
          <span>📊</span>
          <span>Excel</span>
        </a>

        {/* 7. "📥 CSV" বাটন (shrink-0 text-xs px-2.5 py-1.5) */}
        <a
          href={csvHref}
          className="btn-secondary shrink-0 text-xs px-2.5 py-1.5 h-8 flex items-center gap-1 font-medium text-slate-700 hover:text-brand-700"
          title={t("সিএসভি ডাউনলোড")}
        >
          <span>📥</span>
          <span>CSV</span>
        </a>
      </form>
    </div>
  );
}
