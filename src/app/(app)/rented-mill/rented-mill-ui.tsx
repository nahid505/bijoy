"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RentedMillRole } from "@/lib/rented-mill-types";
export function RentedMillTabs({ role }: { role: RentedMillRole }) {
  const pathname = usePathname();

  const tabs = [
    { href: "/rented-mill", label: "📊 ড্যাশবোর্ড ও ৫০:৫০", exact: true },
    { href: "/rented-mill/profit-settlement", label: "⚖️ লাভ-ক্ষতি ও বণ্টন" },
    { href: "/rented-mill/bank-and-partners", label: "🏦 ব্যাংক ও মালিক হিসাব" },
    { href: "/rented-mill/party-ledger", label: "👥 পার্টি খতিয়ান" },
    { href: "/rented-mill/reports/daily-cash", label: "💵 দৈনিক জমা খরচ" },
    { href: "/rented-mill/reports/paddy-receipt", label: "🌾 ধান প্রাপ্তি" },
    { href: "/rented-mill/reports/dryer-milling", label: "♨️ ডায়ার ও ছাটাই" },
    { href: "/rented-mill/reports/expense-details", label: "📑 খরচ বিস্তারিত" },
    { href: "/rented-mill/milling-bills", label: "⚖️ ছাটাই বিল ও লেজার" },
    { href: "/rented-mill/byproduct-sales", label: "🌾 ভুষি ও কুঁড়া" },
    { href: "/rented-mill/expenses", label: "💸 মিল খরচ" },
    ...(role === "SUPER_ADMIN"
      ? [{ href: "/rented-mill/settings", label: "⚙️ সেটিংস ও হিসাবরক্ষক" }]
      : []),
  ];

  return (
    <div className="no-print mb-6 border-b border-rule pb-2">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-semibold transition ${
                active
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-ink-50 text-ink-700 hover:bg-ink-100 hover:text-ink-900"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function ReportPrintHeader({
  millName = "শুভংকর অটো রাইস মিল",
  millAddress = "দিনাজপুর",
  title,
  subTitle,
}: {
  millName?: string;
  millAddress?: string;
  title: string;
  subTitle?: string;
}) {
  return (
    <div className="hidden print:block text-center border-b border-black pb-3 mb-4">
      <h1 className="text-2xl font-black tracking-tight text-black">{millName}</h1>
      <p className="text-sm font-bold text-slate-800">{millAddress}</p>
      <div className="mt-2 inline-block border-y border-black py-1 px-4">
        <h2 className="text-base font-bold text-black">{title}</h2>
      </div>
      {subTitle && <p className="text-xs text-slate-700 mt-1">{subTitle}</p>}
    </div>
  );
}

export function PrintButton({ label = "প্রিন্ট করুন" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-outline flex items-center gap-1.5 text-xs print:hidden"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v8H6z" />
      </svg>
      {label}
    </button>
  );
}

export function AutoPrint() {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
