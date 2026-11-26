"use client";

import { useState } from "react";
import Link from "next/link";
import { toBnDigits } from "@/lib/format";

export interface SupplierBagBalanceData {
  receivedJuteBags: number;
  receivedPlasticBags: number;
  receivedTotalBags: number;
  returnedJuteBags: number;
  returnedPlasticBags: number;
  returnedTotalBags: number;
  dueJuteBags: number;
  duePlasticBags: number;
  dueTotalBags: number;
}

export function BagLedgerCollapsibleCard({
  bagBal,
  partyId,
  canCreateReturn,
}: {
  bagBal: SupplierBagBalanceData;
  partyId: string;
  canCreateReturn: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* ── DESKTOP VIEW (Always Expanded on >= 768px) ── */}
      <section className="panel mb-2 sm:mb-3 p-3 sm:p-4 border-2 border-amber-300 bg-amber-50/60 shadow-xs hidden md:block">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base sm:text-lg">📦</span>
              <h3 className="text-xs sm:text-sm font-bold text-amber-950">
                খালি বস্তা লেজার হিসাব (অটো রাইস মিল)
              </h3>
            </div>
            <p className="text-[11px] sm:text-xs text-amber-800 mt-0.5">
              ধান ক্রয়ের সময় গৃহীত খালি বস্তা ও মিল কর্তৃক ফেরত প্রদানের চলমান স্থিতি
            </p>
          </div>
          {canCreateReturn && (
            <Link
              prefetch={false}
              href={`/auto-rice-mill/bag-returns/new?supplierId=${partyId}`}
              className="btn-primary text-xs py-1 px-2.5 sm:py-1.5 sm:px-3 flex items-center gap-1 shrink-0 font-medium"
            >
              <span>+</span>
              <span>বস্তা ফেরত দিন</span>
            </Link>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2.5">
          <div className="rounded bg-white p-2.5 border border-amber-200">
            <span className="text-[11px] text-slate-500 block leading-tight">মোট গৃহীত বস্তা</span>
            <span className="text-base font-bold text-ink-900 tabular-nums">
              {toBnDigits(bagBal.receivedTotalBags)} <span className="text-xs font-normal text-slate-500">টি</span>
            </span>
            <span className="text-[10px] text-slate-400 block truncate">
              চট: {toBnDigits(bagBal.receivedJuteBags)}, প্লা: {toBnDigits(bagBal.receivedPlasticBags)}
            </span>
          </div>
          <div className="rounded bg-white p-2.5 border border-amber-200">
            <span className="text-[11px] text-slate-500 block leading-tight">মোট ফেরত প্রদান</span>
            <span className="text-base font-bold text-emerald-800 tabular-nums">
              {toBnDigits(bagBal.returnedTotalBags)} <span className="text-xs font-normal text-slate-500">টি</span>
            </span>
            <span className="text-[10px] text-slate-400 block truncate">
              চট: {toBnDigits(bagBal.returnedJuteBags)}, প্লা: {toBnDigits(bagBal.returnedPlasticBags)}
            </span>
          </div>
          <div className="rounded bg-amber-100/70 p-2.5 border border-amber-300">
            <span className="text-[11px] font-semibold text-amber-900 block leading-tight">অবশিষ্ট চটের বস্তা পাওনা</span>
            <span className="text-lg font-black text-amber-950 tabular-nums">
              {toBnDigits(bagBal.dueJuteBags)} <span className="text-xs font-normal text-amber-900">টি</span>
            </span>
          </div>
          <div className="rounded bg-blue-50 p-2.5 border border-blue-200">
            <span className="text-[11px] font-semibold text-blue-900 block leading-tight">অবশিষ্ট প্লাস্টিক বস্তা পাওনা</span>
            <span className="text-lg font-black text-blue-950 tabular-nums">
              {toBnDigits(bagBal.duePlasticBags)} <span className="text-xs font-normal text-blue-900">টি</span>
            </span>
          </div>
        </div>
      </section>

      {/* ── MOBILE VIEW (Compact Collapsible Bar on < 768px) ── */}
      <section className="panel mb-1.5 border border-amber-300 bg-amber-50/90 shadow-xs md:hidden overflow-hidden transition-all">
        {/* Compact Clickable Summary Row */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsOpen((prev) => !prev);
            }
          }}
          className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 cursor-pointer select-none active:bg-amber-100/60"
          aria-expanded={isOpen}
        >
          {/* Left: 📦 খালি বস্তা: চট ৫২৫, প্লাস্টিক ০ */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm shrink-0">📦</span>
            <div className="text-xs font-bold text-amber-950 truncate">
              <span>খালি বস্তা: </span>
              <span className="tabular-nums font-semibold text-amber-900">
                চট {toBnDigits(bagBal.dueJuteBags)}, প্লাস্টিক {toBnDigits(bagBal.duePlasticBags)}
              </span>
            </div>
          </div>

          {/* Right: + ফেরত button & বিস্তারিত দেখুন ▾ / বন্ধ করুন ▴ */}
          <div className="flex items-center gap-1.5 shrink-0">
            {canCreateReturn && (
              <Link
                prefetch={false}
                href={`/auto-rice-mill/bag-returns/new?supplierId=${partyId}`}
                onClick={(e) => e.stopPropagation()}
                className="btn-primary text-[10px] py-0.5 px-2 font-semibold leading-tight rounded shrink-0 shadow-xs"
                title="নতুন খালি বস্তা ফেরত দিন"
              >
                + ফেরত
              </Link>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen((prev) => !prev);
              }}
              className="text-[11px] font-bold text-amber-800 hover:text-amber-950 inline-flex items-center gap-0.5 px-1 py-0.5 rounded"
            >
              <span>{isOpen ? "বন্ধ করুন" : "বিস্তারিত দেখুন"}</span>
              <span className="text-[10px] font-black">{isOpen ? "▴" : "▾"}</span>
            </button>
          </div>
        </div>

        {/* Expanded Content on Mobile */}
        {isOpen && (
          <div className="border-t border-amber-200/80 p-2 bg-white/80 space-y-2 animate-in fade-in duration-150">
            <p className="text-[10px] text-amber-800 leading-tight">
              ধান ক্রয়ের সময় গৃহীত খালি বস্তা ও মিল কর্তৃক ফেরত প্রদানের চলমান স্থিতি
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded bg-white p-1.5 border border-amber-200 shadow-2xs">
                <span className="text-[10px] text-slate-500 block leading-tight">মোট গৃহীত বস্তা</span>
                <span className="text-xs font-bold text-ink-900 tabular-nums">
                  {toBnDigits(bagBal.receivedTotalBags)} <span className="text-[10px] font-normal text-slate-500">টি</span>
                </span>
                <span className="text-[9px] text-slate-400 block truncate">
                  চট {toBnDigits(bagBal.receivedJuteBags)} · প্লা {toBnDigits(bagBal.receivedPlasticBags)}
                </span>
              </div>
              <div className="rounded bg-white p-1.5 border border-amber-200 shadow-2xs">
                <span className="text-[10px] text-slate-500 block leading-tight">মোট ফেরত প্রদান</span>
                <span className="text-xs font-bold text-emerald-800 tabular-nums">
                  {toBnDigits(bagBal.returnedTotalBags)} <span className="text-[10px] font-normal text-slate-500">টি</span>
                </span>
                <span className="text-[9px] text-slate-400 block truncate">
                  চট {toBnDigits(bagBal.returnedJuteBags)} · প্লা {toBnDigits(bagBal.returnedPlasticBags)}
                </span>
              </div>
              <div className="rounded bg-amber-100/70 p-1.5 border border-amber-300 shadow-2xs">
                <span className="text-[10px] font-semibold text-amber-900 block leading-tight">অবশিষ্ট চটের বস্তা পাওনা</span>
                <span className="text-sm font-black text-amber-950 tabular-nums">
                  {toBnDigits(bagBal.dueJuteBags)} <span className="text-[10px] font-normal text-amber-900">টি</span>
                </span>
              </div>
              <div className="rounded bg-blue-50 p-1.5 border border-blue-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-blue-900 block leading-tight">অবশিষ্ট প্লাস্টিক বস্তা পাওনা</span>
                <span className="text-sm font-black text-blue-950 tabular-nums">
                  {toBnDigits(bagBal.duePlasticBags)} <span className="text-[10px] font-normal text-blue-900">টি</span>
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
