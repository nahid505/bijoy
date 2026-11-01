"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/components/lang";

interface CompactReportFilterProps {
  basePath: string;
  from: string;
  to: string;
  q?: string;
  verification?: string;
  keepParams?: Record<string, string | undefined>;
  showRange?: boolean;
  showQ?: boolean;
  showVerification?: boolean;
}

export function CompactReportFilter({
  basePath,
  from: initialFrom,
  to: initialTo,
  q: initialQ = "",
  verification: initialVerification = "",
  keepParams = {},
  showRange = true,
  showQ = true,
  showVerification = false,
}: CompactReportFilterProps) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [verification, setVerification] = useState(initialVerification);

  const inputRef = useRef<HTMLInputElement>(null);

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
    setVerification(initialVerification);
  }, [initialVerification]);

  const applyFilters = (newQ: string, newFrom: string, newTo: string, newVerification?: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(keepParams)) {
      if (v) params.set(k, v);
    }
    const trimmed = newQ.trim();
    if (trimmed) params.set("q", trimmed);
    if (newFrom) params.set("from", newFrom);
    if (newTo) params.set("to", newTo);
    const ver = newVerification !== undefined ? newVerification : verification;
    if (ver) params.set("verification", ver);

    const qs = params.toString();
    const targetUrl = qs ? `${basePath}?${qs}` : basePath;
    startTransition(() => {
      router.replace(targetUrl, { scroll: false });
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (q !== initialQ) {
        applyFilters(q, from, to);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const resetParams = new URLSearchParams();
  for (const [k, v] of Object.entries(keepParams)) {
    if (v) resetParams.set(k, v);
  }
  const resetQs = resetParams.toString();
  const resetUrl = resetQs ? `${basePath}?${resetQs}` : basePath;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        applyFilters(q, from, to);
      }}
      className="no-print flex items-center gap-2 overflow-x-auto whitespace-nowrap py-2 px-3 no-scrollbar"
    >
      {/* ১. "খুঁজুন" ইনপুট (সংক্ষিপ্ত সাইজ, যেমন: w-32 text-xs py-1.5 বা min-w-[120px]) */}
      {showQ && (
        <div className="relative shrink-0">
          <input
            ref={inputRef}
            name="q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input h-8 w-32 sm:w-40 min-w-[120px] text-xs px-2.5 pr-6 py-1.5"
            placeholder={t("খুঁজুন")}
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
                applyFilters("", from, to);
                inputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 p-0.5"
              title={t("মুছে ফেলুন")}
            >
              ✕
            </button>
          ) : null}
        </div>
      )}

      {/* ২. "শুরু" তারিখ পিকার (w-28 text-xs py-1.5) */}
      {showRange && (
        <div className="flex items-center gap-1 shrink-0" title={t("শুরু")}>
          <span className="text-[11px] text-slate-500 font-medium">{t("শুরু")}:</span>
          <input
            type="date"
            name="from"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              applyFilters(q, e.target.value, to);
            }}
            className="input h-8 w-28 text-xs px-1.5 py-1.5"
          />
        </div>
      )}

      {/* ৩. "শেষ" তারিখ পিকার (w-28 text-xs py-1.5) */}
      {showRange && (
        <div className="flex items-center gap-1 shrink-0" title={t("শেষ")}>
          <span className="text-[11px] text-slate-500 font-medium">{t("শেষ")}:</span>
          <input
            type="date"
            name="to"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              applyFilters(q, from, e.target.value);
            }}
            className="input h-8 w-28 text-xs px-1.5 py-1.5"
          />
        </div>
      )}

      {/* ৪. "যাচাই অবস্থা" ড্রপডাউন */}
      {showVerification && (
        <div className="flex items-center gap-1 shrink-0">
          <select
            name="verification"
            value={verification}
            onChange={(e) => {
              setVerification(e.target.value);
              applyFilters(q, from, to, e.target.value);
            }}
            className="input h-8 text-xs px-2 py-1 bg-white shrink-0 border border-slate-300 font-medium"
            title={t("যাচাই অবস্থা")}
          >
            <option value="">{t("সকল লেনদেন")}</option>
            <option value="VERIFIED">{t("শুধু অনুমোদিত")}</option>
            <option value="UNVERIFIED">{t("অপেক্ষমাণ (Pending)")}</option>
            <option value="REJECTED">{t("রিজেক্টেড")}</option>
          </select>
        </div>
      )}

      {/* ৫. "রিসেট" ছোট বাটন/আইকন */}
      <Link
        prefetch={false}
        href={resetUrl}
        className="btn-ghost shrink-0 text-xs px-2 py-1 h-8 flex items-center gap-1 text-slate-500 hover:text-ink-900 font-medium rounded border border-transparent hover:border-slate-200"
        title={t("রিসেট")}
      >
        <span>🔄</span>
        <span>{t("রিসেট")}</span>
      </Link>
    </form>
  );
}
