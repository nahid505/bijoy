"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchGlobalAction, type GlobalSearchResult, type GlobalVoucherHit, type GlobalAccountHit } from "@/server/actions/search";
import { useT } from "./lang";

interface SpotlightSearchProps {
  open?: boolean;
  onClose?: () => void;
}

export function SpotlightSearchModal({ open, onClose }: SpotlightSearchProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open !== undefined ? open : internalOpen;
  const setOpen = (val: boolean) => {
    if (onClose && !val) onClose();
    setInternalOpen(val);
  };

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult>({ vouchers: [], accounts: [] });
  const [isPending, startTransition] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const t = useT();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Listen to global open events and keyboard shortcuts (Cmd+K, Ctrl+K)
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener("open-spotlight", handleOpen);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("open-spotlight", handleOpen);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      setSelectedIndex(-1);
    } else {
      setQuery("");
      setResults({ vouchers: [], accounts: [] });
      setHasSearched(false);
    }
  }, [isOpen]);

  // 300ms Debounce search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const q = query.trim();
    if (!q) {
      setResults({ vouchers: [], accounts: [] });
      setHasSearched(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const data = await searchGlobalAction(q);
          setResults(data);
          setHasSearched(true);
          setSelectedIndex(-1);
        } catch (err) {
          console.error("Search failed:", err);
        }
      });
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  // Flattened items for keyboard navigation
  const allItems: { type: "voucher" | "account"; href: string }[] = [
    ...results.vouchers.map((v) => ({ type: "voucher" as const, href: v.href })),
    ...results.accounts.map((a) => ({ type: "account" as const, href: a.href })),
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (allItems.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 >= allItems.length ? 0 : prev + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 < 0 ? allItems.length - 1 : prev - 1));
    } else if (e.key === "Enter" && selectedIndex >= 0 && selectedIndex < allItems.length) {
      e.preventDefault();
      const item = allItems[selectedIndex];
      navigate(item.href);
    }
  };

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!isOpen) return null;

  const totalResults = results.vouchers.length + results.accounts.length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-start bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 pt-3 sm:pt-14 transition-all"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t("গ্লোবাল সার্চ")}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[82vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header Bar */}
        <div className="flex items-center gap-2.5 p-3 sm:p-4 border-b border-slate-100 bg-white">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 text-lg">
            🔍
          </div>

          <div className="relative flex-1 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("🔍 চালান নং, খতিয়ানের নাম বা মোবাইল...")}
              className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </div>

          {/* Loading spinner */}
          {isPending && (
            <div className="flex items-center justify-center h-6 w-6 text-brand-600 shrink-0">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
            </div>
          )}

          {/* Clear button */}
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0"
              aria-label={t("মুছুন")}
            >
              ✕
            </button>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition shrink-0"
          >
            {t("বাতিল")}
          </button>
        </div>

        {/* Results Body */}
        <div className="overflow-y-auto p-2 sm:p-3 space-y-4 flex-1 overscroll-contain">
          {/* Quick suggestions when query is empty */}
          {!query.trim() && (
            <div className="py-6 px-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl text-slate-500 mb-3">
                ⚡
              </div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">
                {t("দ্রুত যেকোনো চালান বা খতিয়ান খুঁজুন")}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
                {t("চালান নং (INV/DO), কাস্টমার বা সরবরাহকারীর নাম অথবা মোবাইল নম্বর টাইপ করুন।")}
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 max-w-md mx-auto">
                {["INV-", "কাস্টমার", "সরবরাহকারী", "ক্যাশ", "বিক্রয়", "ক্রয়"].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setQuery(tag);
                      inputRef.current?.focus();
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition"
                  >
                    <span>🔍</span>
                    <span>{tag}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty search results */}
          {hasSearched && query.trim() && totalResults === 0 && !isPending && (
            <div className="py-8 px-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-2xl text-amber-600 mb-3">
                🔍
              </div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">
                {t("কোনো ফলাফল পাওয়া যায়নি")}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                &ldquo;<span className="font-semibold text-slate-700">{query}</span>&rdquo; {t("এর সাথে মিলে এমন কোনো চালান বা খতিয়ান পাওয়া যায়নি। বানান অথবা মোবাইল নম্বর যাচাই করুন।")}
              </p>
            </div>
          )}

          {/* Category 1: চালান / লেনদেন (Vouchers & Invoices) */}
          {results.vouchers.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2.5 py-1 mb-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wide">
                  <span>🧾</span>
                  <span>{t("চালান / লেনদেন")}</span>
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  {results.vouchers.length} {t("টি")}
                </span>
              </div>
              <div className="space-y-1">
                {results.vouchers.map((v, idx) => {
                  const isSelected = selectedIndex === idx;
                  return (
                    <div
                      key={v.id}
                      onClick={() => navigate(v.href)}
                      className={`group flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border cursor-pointer transition ${
                        isSelected
                          ? "bg-brand-50/80 border-brand-300 shadow-xs"
                          : "bg-white border-slate-150 hover:bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                            v.type === "SALES"
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : v.type === "PURCHASE"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : v.type === "RECEIPT"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : v.type === "PAYMENT"
                              ? "bg-purple-50 text-purple-700 border-purple-200"
                              : v.type === "DEPOT_DELIVERY"
                              ? "bg-teal-50 text-teal-700 border-teal-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          }`}>
                            {v.typeLabel}
                          </span>
                          <span className="font-bold text-sm text-slate-900 group-hover:text-brand-700 transition">
                            {v.voucherNo}
                          </span>
                          {v.reference && (
                            <span className="text-xs text-slate-400 font-mono">
                              ({v.reference})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
                          {v.partyName && (
                            <span className="font-medium text-slate-700 truncate">
                              {v.partyName}
                            </span>
                          )}
                          {v.partyName && <span>·</span>}
                          <span>{v.formattedDate}</span>
                          {v.narration && (
                            <>
                              <span>·</span>
                              <span className="truncate text-slate-400">{v.narration}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-bold text-sm text-slate-900">
                          {v.formattedAmount}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          {v.verificationStatus === "VERIFIED" ? (
                            <span className="inline-flex items-center text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full">
                              🛡️ {t("অনুমোদিত")}
                            </span>
                          ) : v.verificationStatus === "REJECTED" ? (
                            <span className="inline-flex items-center text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded-full">
                              ✕ {t("বাতিল")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded-full">
                              ⏳ {t("অপেক্ষমাণ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category 2: খতিয়ান / পার্টি (Customers, Suppliers, Ledgers) */}
          {results.accounts.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2.5 py-1 mb-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wide">
                  <span>👥</span>
                  <span>{t("খতিয়ান / পার্টি")}</span>
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  {results.accounts.length} {t("টি")}
                </span>
              </div>
              <div className="space-y-1">
                {results.accounts.map((a, idx) => {
                  const globalIdx = results.vouchers.length + idx;
                  const isSelected = selectedIndex === globalIdx;
                  return (
                    <div
                      key={a.id}
                      onClick={() => navigate(a.href)}
                      className={`group flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border cursor-pointer transition ${
                        isSelected
                          ? "bg-brand-50/80 border-brand-300 shadow-xs"
                          : "bg-white border-slate-150 hover:bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                          a.kind === "CUSTOMER"
                            ? "bg-blue-100 text-blue-700"
                            : a.kind === "SUPPLIER"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-purple-100 text-purple-700"
                        }`}>
                          {a.kind === "CUSTOMER" ? "👤" : a.kind === "SUPPLIER" ? "🏢" : "💳"}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 group-hover:text-brand-700 transition truncate">
                              {a.name}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded-md">
                              {a.kindLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 truncate">
                            {a.mobile && (
                              <span className="font-mono text-slate-600 font-medium">
                                📞 {a.mobile}
                              </span>
                            )}
                            {a.mobile && a.groupName && <span>·</span>}
                            {a.groupName && (
                              <span className="text-slate-400 truncate">{a.groupName}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${
                          a.balanceTone === "red"
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : a.balanceTone === "green"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-50 text-slate-600 border border-slate-200"
                        }`}>
                          {a.balanceLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-3 sm:px-4 py-2 bg-slate-50 border-t border-slate-150 flex items-center justify-between text-[11px] text-slate-400">
          <div className="hidden sm:flex items-center gap-3">
            <span><kbd className="bg-white border px-1 py-0.5 rounded text-slate-500 font-mono">↑↓</kbd> নেভিগেট</span>
            <span><kbd className="bg-white border px-1 py-0.5 rounded text-slate-500 font-mono">Enter</kbd> নির্বাচন</span>
            <span><kbd className="bg-white border px-1 py-0.5 rounded text-slate-500 font-mono">Esc</kbd> বন্ধ</span>
          </div>
          <div className="text-right sm:text-right w-full sm:w-auto">
            {t("বিজয় লেনদেন স্পটলাইট সার্চ")}
          </div>
        </div>
      </div>
    </div>
  );
}

export function openSpotlightSearch() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-spotlight"));
  }
}

export function SpotlightHeaderTrigger() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={openSpotlightSearch}
      className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:border-slate-300 transition text-xs w-48 lg:w-60 shrink-0"
      aria-label={t("সার্চ")}
    >
      <span className="text-slate-400">🔍</span>
      <span className="truncate text-slate-500">{t("চালান নং, খতিয়ানের নাম...")}</span>
      <kbd className="ml-auto text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-400 font-mono">⌘K</kbd>
    </button>
  );
}

