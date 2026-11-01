"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatNumber, formatQty, toBnDigits } from "@/lib/format";
import { amountInBanglaWords, amountInEnglishWords } from "@/lib/words";
import { PrintButton } from "@/components/forms";
import { useLang, useT } from "@/components/lang";
import { PosPageSize } from "./pos-page-size";

export interface PrintSettings {
  ourBusiness: boolean; // আমাদের ব্যবসার তথ্য
  dealer: boolean; // ডিলার তথ্য
  company: boolean; // কোম্পানির তথ্য
  challanMeta: boolean; // চালানের বিবরণ (Challan No & Date)
  supplyBasis: boolean; // সরবরাহের ভিত্তি (Supply Basis / DO Basis)
  rateAndTotal: boolean; // দর ও মোট টাকার কলাম (Rate & Total Columns)
  signatures: boolean; // স্বাক্ষর সেকশন (Signatures)
  ecoPrint: boolean; // কালি সাশ্রয়ী প্রিন্ট (Eco Print)
}

const DEFAULT_SETTINGS: PrintSettings = {
  ourBusiness: true,
  dealer: true,
  company: true,
  challanMeta: true,
  supplyBasis: true,
  rateAndTotal: true,
  signatures: true,
  ecoPrint: true,
};

const STORAGE_KEY = "bl_depot_challan_print_settings";

export interface DealerChallanViewProps {
  business: {
    id: string;
    name: string;
    ownerName: string | null;
    mobile: string | null;
    address: string | null;
    email: string | null;
    logo: string | null;
    currencySymbol: string;
  };
  dealer: {
    name: string;
    ownerName: string | null;
    mobile: string | null;
    address: string | null;
    route: string | null;
  } | null;
  company: {
    name: string;
    contactPerson: string | null;
    mobile: string | null;
    address: string | null;
    email: string | null;
  } | null;
  delivery: {
    id: string;
    mode: "COMPANY_PAID" | "DEPOT_COLLECTION";
    doNumber: string | null;
    vehicleNo: string | null;
    driverName: string | null;
    notes: string | null;
  };
  voucher: {
    id: string;
    voucherNo: string;
    dateFormatted: string;
    paidAmount: number;
  };
  lines: Array<{
    id: string;
    name: string;
    code: string;
    unit: string;
    supplied: number;
    free: number;
    total: number;
    rate: number;
    amount: number;
  }>;
  pos: boolean;
}

export function DealerChallanView({
  business,
  dealer,
  company,
  delivery,
  voucher,
  lines,
  pos,
}: DealerChallanViewProps) {
  const t = useT();
  const lang = useLang();
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(true);

  // Load saved preferences if available
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore JSON parse or storage errors
    }
  }, []);

  const updateSetting = (key: keyof PrintSettings, val: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: val };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const setAll = (val: boolean) => {
    const next: PrintSettings = {
      ourBusiness: val,
      dealer: val,
      company: val,
      challanMeta: val,
      supplyBasis: val,
      rateAndTotal: val,
      signatures: val,
      ecoPrint: settings.ecoPrint,
    };
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const setPreset = (partial: Partial<PrintSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const cur = business.currencySymbol;
  const doRelease = delivery.mode === "COMPANY_PAID";
  const curPrefix = cur ? `${cur} ` : "৳ ";
  const money = (n: number) => `${curPrefix}${formatNumber(n)}`;

  const units = [...new Set(lines.map((l) => l.unit))];
  const sum = (k: "supplied" | "free" | "total") =>
    lines.reduce((s, l) => s + l[k], 0);
  const qtyTotal = (k: "supplied" | "free" | "total") =>
    units.length === 1
      ? `${formatQty(sum(k))} ${units[0]}`
      : formatQty(sum(k));
  const amount = lines.reduce((acc, l) => acc + l.amount, 0);
  const paid = voucher.paidAmount;
  const due = Math.max(amount - paid, 0);

  const amountWords =
    lang === "en" ? amountInEnglishWords(amount) : amountInBanglaWords(amount);

  const activeCount = [
    settings.ourBusiness,
    settings.dealer,
    settings.company,
    settings.challanMeta,
    settings.supplyBasis,
    settings.rateAndTotal,
    settings.signatures,
  ].filter(Boolean).length;

  const showCompanyCard = settings.company && Boolean(company);
  const showSupplyCard =
    settings.supplyBasis &&
    (doRelease || Boolean(delivery.doNumber) || Boolean(company));

  const toolbar = (
    <div className="no-print mx-auto mb-4 max-w-[210mm] print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule bg-white p-2.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton label={t("প্রিন্ট / PDF")} />
          <span
            className="inline-flex overflow-hidden rounded-md border border-rule text-sm"
            role="group"
            aria-label={t("প্রিন্ট ফরম্যাট")}
          >
            <Link
              prefetch={false}
              href={`/depot/deliveries/${voucher.id}/print`}
              aria-current={!pos ? "page" : undefined}
              className={`px-3 py-1.5 font-medium transition-colors ${
                !pos
                  ? "bg-brand-600 font-semibold text-white shadow-xs"
                  : "bg-white text-ink-700 hover:bg-brand-50"
              }`}
            >
              A4
            </Link>
            <Link
              prefetch={false}
              href={`/depot/deliveries/${voucher.id}/print?format=pos`}
              aria-current={pos ? "page" : undefined}
              className={`border-l border-rule px-3 py-1.5 font-medium transition-colors ${
                pos
                  ? "bg-brand-600 font-semibold text-white shadow-xs"
                  : "bg-white text-ink-700 hover:bg-brand-50"
              }`}
            >
              {t("POS স্লিপ (৮০ মিমি)")}
            </Link>
          </span>

          {/* Eco Print direct toggle in top bar */}
          <label
            className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              settings.ecoPrint
                ? "border-emerald-400 bg-emerald-50 text-emerald-900 shadow-xs"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            title={t("চিকন বর্ডার, ব্যাকগ্রাউন্ড ছাড়া ও হালকা ফন্ট")}
          >
            <input
              type="checkbox"
              checked={settings.ecoPrint}
              onChange={(e) => updateSetting("ecoPrint", e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="flex items-center gap-1">
              <span>🌱</span>
              <span>{t("কালি সাশ্রয়ী প্রিন্ট (Eco Print)")}</span>
            </span>
          </label>

          {/* Toggle Settings Dropdown / Panel */}
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              showSettings
                ? "border-brand-500 bg-brand-50 text-brand-700 shadow-xs"
                : "border-rule bg-white text-ink-700 hover:bg-slate-50"
            }`}
            aria-expanded={showSettings}
          >
            <span className="text-base leading-none">⚙️</span>
            <span>{t("প্রিন্ট সেটিংস")}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                activeCount === 7
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {toBnDigits(activeCount)} / {toBnDigits(7)}
            </span>
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${
                showSettings ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          <Link
            prefetch={false}
            href={`/vouchers/v/${voucher.id}`}
            className="btn-secondary"
          >
            {t("← চালানে ফিরুন")}
          </Link>

          <Link
            prefetch={false}
            href={`/depot/deliveries/${voucher.id}/edit`}
            className="btn-secondary"
          >
            {t("সম্পাদনা")}
          </Link>

          <Link
            prefetch={false}
            href="/depot/deliveries/new"
            className="btn-secondary"
          >
            {t("+ নতুন চালান")}
          </Link>

          <Link
            prefetch={false}
            href="/dashboard"
            className="btn-secondary"
          >
            {t("ড্যাশবোর্ড")}
          </Link>
        </div>

        <span className="text-xs text-slate-500">
          {t("ডিলার কপিতে কমিশন বা অভ্যন্তরীণ কোনো হিসাব থাকে না")}
        </span>
      </div>

      {/* Settings Control Panel */}
      {showSettings && (
        <div className="mt-2 rounded-lg border border-brand-200 bg-white p-3.5 shadow-sm">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <p className="text-sm font-medium text-ink-900">
                ⚙️ {t("চালানের প্রিন্ট পারমিশন কন্ট্রোল")}
              </p>
              <p className="text-xs text-slate-500">
                {t(
                  "যে সেকশনগুলো আনচেক করবেন, সেগুলো প্রিন্ট ও প্রিভিউ থেকে বাদ যাবে এবং স্পেসিং অ্যাডজাস্ট হবে"
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setAll(true)}
                className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("সব নির্বাচন")}
              </button>
              <button
                type="button"
                onClick={() =>
                  setPreset({
                    rateAndTotal: false,
                    ourBusiness: true,
                    dealer: true,
                    company: true,
                    challanMeta: true,
                    supplyBasis: true,
                    signatures: true,
                    ecoPrint: true,
                  })
                }
                className="rounded border border-amber-300 bg-amber-50 px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
                title={t("দর ও মোট টাকা ছাড়া শুধু পরিমাণের চালান")}
              >
                📦 {t("শুধু পরিমাণ (দর ছাড়া)")}
              </button>
              <button
                type="button"
                onClick={() =>
                  setPreset({
                    ourBusiness: false,
                    dealer: true,
                    company: true,
                    challanMeta: true,
                    supplyBasis: true,
                    rateAndTotal: true,
                    signatures: true,
                    ecoPrint: true,
                  })
                }
                className="rounded border border-blue-300 bg-blue-50 px-2 py-1 font-medium text-blue-900 hover:bg-blue-100"
                title={t("প্রি-প্রিন্টেড লেটারহেড প্যাডে প্রিন্টের জন্য")}
              >
                📄 {t("লেটারহেড মোড")}
              </button>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50"
              >
                {t("রিসেট")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
            <ToggleTile
              label={t("আমাদের ব্যবসার তথ্য")}
              sub={t("ডিপোর নাম, মালিক, ফোন")}
              checked={settings.ourBusiness}
              onChange={(c) => updateSetting("ourBusiness", c)}
            />
            <ToggleTile
              label={t("ডিলার তথ্য")}
              sub={t("ডিলার নাম, মালিক, ঠিকানা")}
              checked={settings.dealer}
              onChange={(c) => updateSetting("dealer", c)}
            />
            <ToggleTile
              label={t("কোম্পানির তথ্য")}
              sub={t("কোম্পানি নাম ও কন্টাক্ট")}
              checked={settings.company}
              disabled={!company}
              hint={!company ? t("কোম্পানি নেই") : undefined}
              onChange={(c) => updateSetting("company", c)}
            />
            <ToggleTile
              label={t("চালানের বিবরণ")}
              sub={t("চালান নং ও তারিখ")}
              checked={settings.challanMeta}
              onChange={(c) => updateSetting("challanMeta", c)}
            />
            <ToggleTile
              label={t("সরবরাহের ভিত্তি")}
              sub={t("ডিও / পেমেন্ট ভিত্তি")}
              checked={settings.supplyBasis}
              onChange={(c) => updateSetting("supplyBasis", c)}
            />
            <ToggleTile
              label={t("দর ও মোট টাকা")}
              sub={t("দর ও টাকার কলাম")}
              checked={settings.rateAndTotal}
              onChange={(c) => updateSetting("rateAndTotal", c)}
            />
            <ToggleTile
              label={t("স্বাক্ষর সেকশন")}
              sub={t("প্রতিনিধি ও ডিলারের স্বাক্ষর")}
              checked={settings.signatures}
              onChange={(c) => updateSetting("signatures", c)}
            />
            <ToggleTile
              label={t("কালি সাশ্রয়ী প্রিন্ট (Eco Print)")}
              sub={t("চিকন বর্ডার, ব্যাকগ্রাউন্ড ছাড়া ও হালকা ফন্ট")}
              checked={settings.ecoPrint}
              onChange={(c) => updateSetting("ecoPrint", c)}
            />
          </div>
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // POS Slip (80mm thermal roll)
  // ─────────────────────────────────────────────────────────────────────────────
  if (pos) {
    return (
      <>
        {toolbar}
        <PosPageSize targetId="challan-slip" />
        {settings.ecoPrint && (
          <style>{`
            @media print {
              .eco-print {
                color: #000 !important;
                background-color: #fff !important;
                -webkit-print-color-adjust: economy !important;
                print-color-adjust: economy !important;
              }
              .eco-print,
              .eco-print * {
                background-color: transparent !important;
                background-image: none !important;
                box-shadow: none !important;
                text-shadow: none !important;
                font-weight: 400 !important;
              }
              .eco-print .eco-medium {
                font-weight: 500 !important;
              }
            }
          `}</style>
        )}
        <article
          id="challan-slip"
          className={`challan-slip print-area mx-auto w-[76mm] bg-white p-2 text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none ${
            settings.ecoPrint ? "eco-print" : ""
          }`}
        >
          {/* Business Header */}
          {settings.ourBusiness && (
            <header className="border-b border-dashed border-slate-400 pb-1.5 text-center print:border-b-[0.5px] print:border-slate-400">
              <p className="text-sm font-medium eco-medium">{business.name}</p>
              {business.ownerName && (
                <p className="text-[10px] font-normal">
                  {t("স্বত্বাধিকারী")}: {business.ownerName}
                </p>
              )}
              {business.address && (
                <p className="text-[10px] font-normal whitespace-pre-line">
                  {business.address}
                </p>
              )}
              {business.mobile && (
                <p className="text-[10px] font-normal">
                  {t("মোবাইল")}: {business.mobile}
                </p>
              )}
              <p className="mt-1 text-xs font-medium uppercase eco-medium">
                {t("ডেলিভারি চালান (ডিলার কপি)")}
              </p>
            </header>
          )}

          {/* Details / Meta */}
          {(settings.challanMeta ||
            settings.dealer ||
            (settings.company && company) ||
            settings.supplyBasis) && (
            <div className="border-b border-dashed border-slate-400 py-1 space-y-0.5 text-[10px] font-normal print:border-b-[0.5px] print:border-slate-400">
              {settings.challanMeta && (
                <>
                  <p>
                    {t("চালান নং")}: <span className="font-medium eco-medium">{voucher.voucherNo}</span>
                  </p>
                  <p>
                    {t("তারিখ")}: <span>{voucher.dateFormatted}</span>
                  </p>
                  {delivery.doNumber && (
                    <p>
                      {doRelease ? t("ডিও নং") : t("রেফারেন্স")}:{" "}
                      <span>{delivery.doNumber}</span>
                    </p>
                  )}
                </>
              )}

              {settings.dealer && (
                <div className="border-t border-dotted border-slate-400 pt-0.5">
                  <p>
                    <span>{t("ডিলার")}:</span> <span className="font-medium eco-medium">{dealer?.name ?? t("নগদ বিক্রয়")}</span>
                  </p>
                  {dealer?.ownerName && (
                    <p>
                      {t("মালিক/প্রতিনিধি")}: {dealer.ownerName}
                    </p>
                  )}
                  {dealer?.mobile && (
                    <p>
                      {t("মোবাইল")}: {dealer.mobile}
                    </p>
                  )}
                  {dealer?.address && (
                    <p>
                      {t("ঠিকানা")}: {dealer.address}
                    </p>
                  )}
                  {dealer?.route && (
                    <p>
                      {t("রুট")}: {dealer.route}
                    </p>
                  )}
                </div>
              )}

              {settings.company && company && (
                <div className="border-t border-dotted border-slate-400 pt-0.5">
                  <p>
                    <span>{t("কোম্পানি")}:</span> <span className="font-medium eco-medium">{company.name}</span>
                  </p>
                  {company.contactPerson && (
                    <p>
                      {t("কন্টাক্ট/মালিক")}: {company.contactPerson}
                    </p>
                  )}
                  {company.mobile && (
                    <p>
                      {t("মোবাইল")}: {company.mobile}
                    </p>
                  )}
                  {company.address && (
                    <p>
                      {t("ঠিকানা")}: {company.address}
                    </p>
                  )}
                </div>
              )}

              {settings.supplyBasis && (
                <div className="border-t border-dotted border-slate-400 pt-0.5">
                  <p>
                    <span>{t("সরবরাহের ভিত্তি")}:</span>{" "}
                    <span>
                      {doRelease ? t("কোম্পানির ডিও") : t("মার্কেট সেলস")}
                    </span>
                  </p>
                  {doRelease && (
                    <p className="text-[9px]">
                      {t("মূল্য কোম্পানিতে পরিশোধিত")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Product Items */}
          <ol className="divide-y divide-dashed divide-slate-300 border-b border-slate-400 print:divide-slate-300 print:border-b-[0.5px] print:border-slate-400">
            {lines.map((l, i) => (
              <li key={l.id} className="py-1 font-normal">
                <p>
                  {toBnDigits(i + 1)}. {l.name}
                  {l.code && (
                    <span className="font-mono text-[9px]">
                      {" "}
                      [{l.code}]
                    </span>
                  )}
                </p>
                <p className="flex justify-between gap-2 text-[10px]">
                  <span>
                    {t("সরবরাহ")} {formatQty(l.supplied)}
                    {l.free > 0 && (
                      <>
                        {" "}
                        +{" "}
                        <span>
                          {t("ফ্রি")} {formatQty(l.free)}
                        </span>
                      </>
                    )}{" "}
                    = <span>{formatQty(l.total)} {l.unit}</span>
                  </span>
                </p>
                {settings.rateAndTotal && (
                  <p className="flex justify-between gap-2 text-[10px]">
                    <span>
                      {t("দর")} {money(l.rate)}
                    </span>
                    <span className="tabular-nums">{money(l.amount)}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>

          {/* Totals */}
          <div className="space-y-0.5 border-b border-slate-400 py-1 font-normal print:border-b-[0.5px] print:border-slate-400">
            <p className="flex justify-between">
              <span>{t("মোট সরবরাহ")}</span>
              <span>{qtyTotal("supplied")}</span>
            </p>
            <p className="flex justify-between">
              <span>{t("মোট ফ্রি")}</span>
              <span>{qtyTotal("free")}</span>
            </p>
            <p className="flex justify-between">
              <span>{t("মোট পরিমাণ")}</span>
              <span>{qtyTotal("total")}</span>
            </p>

            {settings.rateAndTotal && (
              <>
                <p className="flex justify-between border-t border-dotted border-slate-400 pt-0.5 text-[12px] font-medium eco-medium">
                  <span>{t("মোট টাকা")}</span>
                  <span className="tabular-nums">{money(amount)}</span>
                </p>
                {doRelease ? (
                  <p className="pt-0.5 text-[10px]">
                    {t("মূল্য কোম্পানির ডিও অনুযায়ী কোম্পানিতে পরিশোধিত")}
                  </p>
                ) : (
                  <>
                    <p className="flex justify-between">
                      <span>{t("আজ পরিশোধ")}</span>
                      <span className="tabular-nums">{money(paid)}</span>
                    </p>
                    <p className="flex justify-between font-medium eco-medium">
                      <span>{t("বাকি")}</span>
                      <span className="tabular-nums">{money(due)}</span>
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {/* Words */}
          {settings.rateAndTotal && (
            <p className="py-1 text-[10px] font-normal">
              <span>{t("কথায়")}:</span> <span>{amountWords}</span>
            </p>
          )}

          {/* Transport / Notes */}
          {(delivery.notes || delivery.driverName || delivery.vehicleNo) && (
            <div className="border-t border-dotted border-slate-400 py-1 text-[10px] font-normal print:border-slate-400">
              {delivery.notes && (
                <p>
                  <span>{t("নোট")}:</span> {delivery.notes}
                </p>
              )}
              {(delivery.driverName || delivery.vehicleNo) && (
                <p>
                  {delivery.driverName && (
                    <>
                      {t("ড্রাইভার")}: <span>{delivery.driverName}</span>
                    </>
                  )}
                  {delivery.driverName && delivery.vehicleNo && " · "}
                  {delivery.vehicleNo && (
                    <>
                      {t("গাড়ি")}: <span>{delivery.vehicleNo}</span>
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Signatures */}
          {settings.signatures && (
            <div className="mt-6 grid grid-cols-2 gap-3 text-center text-[10px] font-normal">
              <p className="border-t border-slate-400 pt-0.5 print:border-t-[0.5px] print:border-slate-400">
                {t("ডিপো প্রতিনিধি")}
              </p>
              <p className="border-t border-slate-400 pt-0.5 print:border-t-[0.5px] print:border-slate-400">
                {t("ডিলারের স্বাক্ষর")}
              </p>
            </div>
          )}
        </article>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Standard A4 Layout
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {toolbar}
      {settings.ecoPrint && (
        <style>{`
          @media print {
            .eco-print {
              color: #000 !important;
              background-color: #fff !important;
              -webkit-print-color-adjust: economy !important;
              print-color-adjust: economy !important;
            }
            .eco-print,
            .eco-print * {
              background-color: transparent !important;
              background-image: none !important;
              box-shadow: none !important;
              text-shadow: none !important;
              font-weight: 400 !important;
            }
            /* Clean thin ink-saver borders */
            .eco-print table,
            .eco-print th,
            .eco-print td {
              border-color: #94a3b8 !important;
              border-width: 0.5px !important;
            }
            .eco-print header,
            .eco-print section,
            .eco-print footer,
            .eco-print div.rounded {
              border-color: #94a3b8 !important;
              border-width: 0.5px !important;
            }
            .eco-print footer div {
              border-top-width: 0.5px !important;
              border-color: #94a3b8 !important;
            }
            .eco-print dl div.border-t {
              border-top-width: 0.5px !important;
              border-color: #94a3b8 !important;
            }
            .eco-print .eco-medium,
            .eco-print th,
            .eco-print h1,
            .eco-print h2 {
              font-weight: 500 !important;
            }
          }
        `}</style>
      )}

      <article
        id="challan-a4"
        className={`panel print-area mx-auto max-w-[210mm] bg-white p-6 text-sm shadow-sm print:m-0 print:w-full print:max-w-none print:border-none print:p-0 print:shadow-none ${
          settings.ecoPrint ? "eco-print" : ""
        }`}
      >
        {/* ── Optional Depot Business Banner (if ourBusiness enabled) ── */}
        {settings.ourBusiness && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-1.5 text-xs font-normal print:mb-1 print:border-b-[0.5px] print:border-slate-400 print:pb-1">
            <div className="flex items-center gap-2">
              {business.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={business.logo}
                  alt=""
                  className="h-7 w-7 object-contain print:h-5 print:w-5"
                />
              )}
              <span className="text-xs font-medium text-ink-900 print:text-black eco-medium">
                {business.name}
              </span>
              {business.ownerName && (
                <span className="text-slate-600 print:text-black text-[11px]">
                  ({t("স্বত্বাধিকারী")}: {business.ownerName})
                </span>
              )}
            </div>
            <div className="text-right text-[11px] text-slate-600 print:text-black">
              {[business.address, business.mobile, business.email]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        )}

        {/* ── Top Header: 2 Columns (Left: Dealer Info, Right: Challan Info) ── */}
        <header className="grid grid-cols-2 items-start justify-between gap-4 border-b border-slate-300 pb-2.5 print:border-b-[0.5px] print:border-slate-400 print:pb-1.5">
          {/* Left: Dealer Info */}
          <div>
            {settings.dealer ? (
              <div className="text-xs print:text-[11px] font-normal">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 print:text-black">
                  {t("ডিলার তথ্য")}
                </p>
                <p className="text-base font-medium text-ink-900 print:text-xs print:text-black eco-medium">
                  {dealer?.name ?? t("নগদ বিক্রয়")}
                </p>
                <div className="mt-0.5 space-y-0.5 text-slate-700 print:text-black font-normal">
                  {dealer?.ownerName && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("মালিক/প্রতিনিধি")}:
                      </span>{" "}
                      <span>{dealer.ownerName}</span>
                    </p>
                  )}
                  {dealer?.mobile && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("মোবাইল")}:
                      </span>{" "}
                      <span>{dealer.mobile}</span>
                    </p>
                  )}
                  {dealer?.address && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("ঠিকানা")}:
                      </span>{" "}
                      <span>{dealer.address}</span>
                    </p>
                  )}
                  {dealer?.route && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("রুট / এরিয়া")}:
                      </span>{" "}
                      <span>{dealer.route}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-h-[1px]" />
            )}
          </div>

          {/* Right: Delivery Challan Title & Meta */}
          <div className="text-right text-xs print:text-[11px] font-normal">
            <h2 className="text-xl font-medium tracking-tight text-ink-900 print:text-base print:font-medium print:text-black eco-medium">
              {t("ডেলিভারি চালান")}
            </h2>
            <p className="text-[11px] uppercase tracking-wider text-slate-600 print:text-[10px] print:text-black">
              {t("ডিলার কপি")}
            </p>
            {settings.challanMeta && (
              <div className="mt-1 space-y-0.5 text-slate-700 print:text-black font-normal">
                <p>
                  {t("চালান নং")}:{" "}
                  <span className="font-mono text-sm font-medium text-ink-900 print:text-xs print:font-medium print:text-black eco-medium">
                    {voucher.voucherNo}
                  </span>
                </p>
                <p>
                  {t("তারিখ")}: <span>{voucher.dateFormatted}</span>
                </p>
                {delivery.doNumber && (
                  <p>
                    {doRelease ? t("ডিও নং") : t("রেফারেন্স")}:{" "}
                    <span className="font-mono">{delivery.doNumber}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ── Sub-header: Company Info & Supply Basis (if active) ── */}
        {(showCompanyCard || showSupplyCard) && (
          <section
            className={`grid gap-3 py-1.5 border-b border-slate-300 print:border-b-[0.5px] print:border-slate-400 print:py-1 ${
              showCompanyCard && showSupplyCard
                ? "grid-cols-1 sm:grid-cols-2 print:grid-cols-2"
                : "grid-cols-1"
            }`}
          >
            {/* Company Info */}
            {showCompanyCard && company && (
              <div className="rounded border border-slate-300 bg-slate-50/70 p-2 text-xs font-normal print:rounded-none print:border-[0.5px] print:border-slate-400 print:bg-transparent print:p-1.5">
                <div className="border-b border-slate-200 pb-0.5 text-[10px] uppercase tracking-wider text-slate-600 print:border-b-[0.5px] print:border-slate-400 print:text-black">
                  {t("কোম্পানির তথ্য")}
                </div>
                <p className="mt-0.5 text-xs font-medium text-ink-900 print:text-black eco-medium">
                  {company.name}
                </p>
                <div className="mt-0.5 space-y-0.5 text-slate-700 print:text-[11px] font-normal print:text-black">
                  {company.contactPerson && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("কন্টাক্ট পারসন/মালিক")}:
                      </span>{" "}
                      <span>{company.contactPerson}</span>
                    </p>
                  )}
                  {company.mobile && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("মোবাইল")}:
                      </span>{" "}
                      <span>{company.mobile}</span>
                    </p>
                  )}
                  {company.address && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("ঠিকানা")}:
                      </span>{" "}
                      <span>{company.address}</span>
                    </p>
                  )}
                  {company.email && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("ইমেইল")}:
                      </span>{" "}
                      <span>{company.email}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Supply Basis */}
            {showSupplyCard && (
              <div className="rounded border border-slate-300 bg-slate-50/70 p-2 text-xs font-normal print:rounded-none print:border-[0.5px] print:border-slate-400 print:bg-transparent print:p-1.5">
                <div className="border-b border-slate-200 pb-0.5 text-[10px] uppercase tracking-wider text-slate-600 print:border-b-[0.5px] print:border-slate-400 print:text-black">
                  {t("সরবরাহের ভিত্তি")}
                </div>
                <p className="mt-0.5 text-xs font-medium text-ink-900 print:text-black eco-medium">
                  {doRelease
                    ? t("কোম্পানির ডিও")
                    : t("মার্কেট সেলস (ডিপো সরাসরি)")}
                  {company?.name && doRelease ? ` — ${company.name}` : ""}
                </p>
                <div className="mt-0.5 space-y-0.5 text-slate-700 print:text-[11px] font-normal print:text-black">
                  <p className="text-slate-600 print:text-black">
                    {doRelease
                      ? t("মূল্য কোম্পানিতে পরিশোধিত")
                      : t("মূল্য ডিপো কালেকশন")}
                  </p>
                  {delivery.doNumber && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {doRelease ? t("ডিও নং") : t("রেফারেন্স")}:
                      </span>{" "}
                      <span className="font-mono">{delivery.doNumber}</span>
                    </p>
                  )}
                  {(delivery.driverName || delivery.vehicleNo) && (
                    <p>
                      <span className="text-slate-500 print:text-black">
                        {t("পরিবহন")}:
                      </span>{" "}
                      <span>
                        {[
                          delivery.driverName &&
                            `${t("ড্রাইভার")}: ${delivery.driverName}`,
                          delivery.vehicleNo &&
                            `${t("গাড়ি")}: ${delivery.vehicleNo}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Table Section ── */}
        <div className="mt-2.5 overflow-x-auto print:mt-1.5 print:overflow-visible">
          <table
            className="w-full min-w-full border-collapse border border-slate-400 text-xs print:border-[0.5px] print:border-slate-400 print:text-[11px]"
            id="dealer-lines"
          >
            <thead>
              <tr className="border-b border-slate-400 bg-slate-50 text-slate-800 print:border-b-[0.5px] print:border-slate-400 print:bg-transparent print:text-black">
                <th className="w-12 min-w-[40px] max-w-[48px] border border-slate-400 px-1.5 py-1.5 text-center font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                  {t("ক্রমিক নং")}
                </th>
                <th className="w-20 min-w-[60px] max-w-[80px] border border-slate-400 px-1.5 py-1.5 text-center font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                  {t("পণ্যের কোড")}
                </th>
                <th className="w-2/5 min-w-[220px] border border-slate-400 px-3 py-1.5 text-left font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                  {t("পণ্যের নাম")}
                </th>
                <th className="w-24 min-w-[80px] border border-slate-400 px-2 py-1.5 text-right font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                  {t("সরবরাহ পরিমাণ")}
                </th>
                <th className="w-20 min-w-[70px] border border-slate-400 bg-amber-50 px-2 py-1.5 text-right font-medium text-amber-950 print:border-[0.5px] print:border-slate-400 print:bg-transparent print:text-black print:py-1">
                  {t("ফ্রি পরিমাণ")}
                </th>
                <th className="w-24 min-w-[80px] border border-slate-400 px-2 py-1.5 text-right font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                  {t("মোট পরিমাণ")}
                </th>
                {settings.rateAndTotal && (
                  <>
                    <th className="w-20 min-w-[70px] border border-slate-400 px-2 py-1.5 text-right font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                      {t("দর / রেট")}
                    </th>
                    <th className="w-24 min-w-[80px] border border-slate-400 px-2 py-1.5 text-right font-medium print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1">
                      {t("মোট টাকা")}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr
                  key={l.id}
                  className="border-b border-slate-300 print:border-b-[0.5px] print:border-slate-400 print:break-inside-avoid font-normal"
                >
                  <td className="w-12 min-w-[40px] max-w-[48px] border border-slate-300 px-1.5 py-1 text-center font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                    {toBnDigits(i + 1)}
                  </td>
                  <td className="w-20 min-w-[60px] max-w-[80px] whitespace-nowrap border border-slate-300 px-1.5 py-1 text-center font-mono text-[11px] font-normal text-slate-700 print:border-[0.5px] print:border-slate-400 print:text-black print:py-1">
                    {l.code || "—"}
                  </td>
                  <td className="w-2/5 min-w-[220px] border border-slate-300 px-3 py-1 text-left font-normal text-slate-900 print:border-[0.5px] print:border-slate-400 print:text-black whitespace-normal break-words leading-snug print:py-1">
                    {l.name}
                  </td>
                  <td className="w-24 min-w-[80px] whitespace-nowrap border border-slate-300 px-2 py-1 text-right font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                    {formatQty(l.supplied)} {l.unit}
                  </td>
                  <td className="w-20 min-w-[70px] whitespace-nowrap border border-slate-300 bg-amber-50/40 px-2 py-1 text-right font-normal tabular-nums text-amber-900 print:border-[0.5px] print:border-slate-400 print:bg-transparent print:text-black print:py-1">
                    {l.free > 0 ? `${formatQty(l.free)} ${l.unit}` : "০"}
                  </td>
                  <td className="w-24 min-w-[80px] whitespace-nowrap border border-slate-300 px-2 py-1 text-right font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                    {formatQty(l.total)} {l.unit}
                  </td>
                  {settings.rateAndTotal && (
                    <>
                      <td className="w-20 min-w-[70px] whitespace-nowrap border border-slate-300 px-2 py-1 text-right font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                        {money(l.rate)}
                      </td>
                      <td className="w-24 min-w-[80px] whitespace-nowrap border border-slate-300 px-2 py-1 text-right font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                        {money(l.amount)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                className="border-t border-slate-400 bg-slate-50 font-medium text-slate-800 print:border-t-[0.5px] print:border-slate-400 print:bg-transparent print:font-medium print:text-black"
                id="dealer-totals"
              >
                <td
                  className="border border-slate-400 px-3 py-1 text-right font-medium print:border-[0.5px] print:border-slate-400 print:py-1"
                  colSpan={3}
                >
                  {t("মোট")}
                </td>
                <td className="whitespace-nowrap border border-slate-400 px-2 py-1 text-right font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                  {qtyTotal("supplied")}
                </td>
                <td className="whitespace-nowrap border border-slate-400 bg-amber-50/50 px-2 py-1 text-right font-normal tabular-nums text-amber-950 print:border-[0.5px] print:border-slate-400 print:bg-transparent print:text-black print:py-1">
                  {qtyTotal("free")}
                </td>
                <td className="whitespace-nowrap border border-slate-400 px-2 py-1 text-right font-normal tabular-nums print:border-[0.5px] print:border-slate-400 print:py-1">
                  {qtyTotal("total")}
                </td>
                {settings.rateAndTotal && (
                  <>
                    <td className="border border-slate-400 px-2 py-1 print:border-[0.5px] print:border-slate-400 print:py-1" />
                    <td
                      className="whitespace-nowrap border border-slate-400 px-2 py-1 text-right font-medium tabular-nums text-ink-900 print:border-[0.5px] print:border-slate-400 print:font-medium print:py-1 print:text-black eco-medium"
                      id="dealer-total"
                    >
                      {money(amount)}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── Financial Summary ── */}
        {settings.rateAndTotal && (
          <div className="mt-2 flex justify-end print:mt-1.5">
            <dl className="w-72 space-y-1 text-xs">
              <div className="flex justify-between text-xs font-medium text-ink-900 print:font-medium print:text-black eco-medium">
                <dt>{t("সর্বমোট টাকা")}</dt>
                <dd className="tabular-nums">{money(amount)}</dd>
              </div>
              {doRelease ? (
                <div className="flex justify-between text-slate-600 print:text-black font-normal">
                  <dt>{t("পরিশোধ")}</dt>
                  <dd>{t("কোম্পানির ডিও-তে")}</dd>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-slate-700 print:text-black font-normal">
                    <dt>{t("আজ পরিশোধ")}</dt>
                    <dd className="tabular-nums">{money(paid)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-300 pt-1 text-xs font-medium text-ink-900 print:border-t-[0.5px] print:border-slate-400 print:pt-0.5 print:font-medium print:text-black eco-medium">
                    <dt>{t("বাকি")}</dt>
                    <dd className="tabular-nums">{money(due)}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        )}

        {/* ── Words ── */}
        {settings.rateAndTotal && (
          <p className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-normal print:rounded-none print:border-[0.5px] print:border-slate-400 print:bg-transparent print:py-1 print:text-black">
            <span>{t("কথায়")}:</span> <span>{amountWords}</span>
          </p>
        )}

        {/* ── Additional Notes / Transport (when not rendered in supply card) ── */}
        {(delivery.notes ||
          (!settings.supplyBasis &&
            (delivery.driverName || delivery.vehicleNo))) && (
          <div className="mt-2 space-y-0.5 text-xs font-normal text-slate-700 print:mt-1 print:text-[11px] print:text-black">
            {delivery.notes && (
              <p>
                <span>{t("নোট")}:</span> {delivery.notes}
              </p>
            )}
            {!settings.supplyBasis &&
              (delivery.driverName || delivery.vehicleNo) && (
                <p>
                  {delivery.driverName && (
                    <>
                      {t("ড্রাইভার")}: <span>{delivery.driverName}</span>
                    </>
                  )}
                  {delivery.driverName && delivery.vehicleNo && " · "}
                  {delivery.vehicleNo && (
                    <>
                      {t("গাড়ি নম্বর")}: <span>{delivery.vehicleNo}</span>
                    </>
                  )}
                </p>
              )}
          </div>
        )}

        {/* ── Signatures ── */}
        {settings.signatures && (
          <footer className="mt-10 grid grid-cols-2 gap-16 text-center text-xs text-slate-700 print:mt-6 print:text-black">
            <div className="border-t border-slate-400 pt-1 font-normal print:border-t-[0.5px] print:border-slate-400">
              {t("ডিপো প্রতিনিধির স্বাক্ষর")}
            </div>
            <div className="border-t border-slate-400 pt-1 font-normal print:border-t-[0.5px] print:border-slate-400">
              {t("ডিলারের স্বাক্ষর")}
            </div>
          </footer>
        )}
      </article>
    </>
  );
}

function ToggleTile({
  label,
  sub,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (val: boolean) => void;
}) {
  return (
    <label
      className={`flex select-none items-start gap-2 rounded-md border p-2 text-xs transition-colors ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-60"
          : checked
          ? "cursor-pointer border-brand-400 bg-brand-50/40 font-semibold text-ink-900 shadow-xs hover:border-brand-500"
          : "cursor-pointer border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"
      }`}
    >
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked && !disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <div className="min-w-0">
        <div className="leading-tight">
          {label}
          {hint && (
            <span className="ml-1 text-[10px] font-normal text-slate-400">
              ({hint})
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[10px] font-normal leading-tight text-slate-500">
          {sub}
        </div>
      </div>
    </label>
  );
}
