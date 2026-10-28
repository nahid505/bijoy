"use client";

// Depot delivery challan block — on the voucher page and the printed challan.
import { DEPOT_MODE_LABELS, type DepotMode } from "@/lib/depot";
import { formatMoney } from "@/lib/format";
import { useT } from "./lang";

export interface DepotChallanData {
  mode: DepotMode;
  doNumber: string | null;
  company: string | null;
  dealer: string | null;
  route: string | null;
  dealerMobile: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  commission: number;
  notes: string | null;
}

export function DepotChallan({ d, currency }: { d: DepotChallanData; currency: string }) {
  const t = useT();
  const doRelease = d.mode === "COMPANY_PAID";
  const rows: [string, string | null][] = [
    [doRelease ? "ডিও / রিলিজ অর্ডার নং" : "চালান / রেফারেন্স নং", d.doNumber],
    ["কোম্পানি", doRelease ? d.company : null],
    ["ডিলার", d.dealer ?? t("নগদ বিক্রয়")],
    ["রুট / এরিয়া", d.route],
    ["ডিলারের মোবাইল", d.dealerMobile],
    ["গাড়ি নম্বর", d.vehicleNo],
    ["ড্রাইভার", d.driverName],
  ];
  return (
    <section className="my-3 rounded-lg border-2 border-ink-800 p-3 print:break-inside-avoid" aria-label={t("ডেলিভারি চালান")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-200 pb-2">
        <p className="text-base font-bold text-ink-900">{t(DEPOT_MODE_LABELS[d.mode])}</p>
        <p className="text-xs text-slate-500">{t("ডিপো ডেলিভারি চালান")}</p>
      </div>
      <dl className="mt-2 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2 print:grid-cols-2">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-slate-600">{t(k)}</dt><dd className="text-right font-medium">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-2 border-t border-ink-200 pt-2 text-sm">
        {doRelease
          ? <>{t("ডিলার কোম্পানিকে সরাসরি পরিশোধ করেছে — ডিলারের কোনো বকেয়া নেই। কোম্পানির কাছে ডিপো কমিশন প্রাপ্য:")} <b className="tabular-nums">{formatMoney(d.commission, currency)}</b></>
          : t("ডিপো নিজে বিক্রয় করেছে — নগদ কালেকশন বাদে বাকি টাকা ডিলারের মার্কেট বাকি।")}
      </p>
      {d.notes && <p className="mt-1 text-sm"><span className="font-semibold">{t("নোট")}:</span> {d.notes}</p>}
    </section>
  );
}
