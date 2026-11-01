"use client";

import { useState } from "react";
import { useT } from "@/components/lang";

export function CollapsibleJournal({
  badge,
  children,
  defaultOpen = false,
  title = "ভাউচার তথ্য ও জার্নাল এন্ট্রি (জাবেদা হিসাব) দেখুন",
  titleHide = "ভাউচার তথ্য ও জার্নাল এন্ট্রি (জাবেদা হিসাব) লুকান",
}: {
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  title?: string;
  titleHide?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useT();

  return (
    <div className="mt-4 print:mt-2" id="collapsible-journal-wrapper">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 print:hidden"
        aria-expanded={open}
        id="toggle-journal-entries"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">📊</span>
          <span className="font-semibold text-slate-800">
            {open ? t(titleHide) : t(title)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {badge}
          <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {open ? t("বন্ধ করুন [ − ]") : t("বিস্তারিত [ + / ▼ ]")}
          </span>
        </div>
      </button>

      <div className={open ? "mt-4" : "hidden"} id="collapsible-journal-content">
        {children}
      </div>
    </div>
  );
}

export function CollapsibleDeliveryInfo({
  title = "Company Paid (DO Release) তথ্য দেখুন",
  titleHide = "Company Paid (DO Release) তথ্য লুকান",
  children,
  defaultOpen = false,
  badge,
}: {
  title?: string;
  titleHide?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useT();

  return (
    <div className="mt-4 print:mt-2" id="collapsible-delivery-info-wrapper">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 print:hidden"
        aria-expanded={open}
        id="toggle-delivery-info"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">📦</span>
          <span className="font-semibold text-slate-800">
            {open ? t(titleHide) : t(title)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {badge}
          <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {open ? t("বন্ধ করুন [ − ]") : t("বিস্তারিত [ + / ▼ ]")}
          </span>
        </div>
      </button>

      <div className={open ? "mt-4" : "hidden"} id="collapsible-delivery-info-content">
        {children}
      </div>
    </div>
  );
}
