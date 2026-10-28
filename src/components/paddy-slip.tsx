// Weighbridge slip block of a paddy purchase — on the voucher page and the printed চালান / invoice.
// The bag count is shown first and prominently (information only, not part of any calculation).
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { monAndKg } from "@/lib/paddy";

export interface PaddySlipData {
  bagCount: number;
  grossKg: number;
  dhaltaKg: number;
  netKg: number;
  mon: number;
  ratePerMon: number;
  totalPrice: number;
  notes: string | null;
  /** auto rice mill details (empty on older slips) */
  variety?: string | null;
  moisturePct?: number | null;
  vehicleGrossKg?: number | null;
  vehicleTareKg?: number | null;
  labourCost?: number;
}

type Dec = { toString(): string } | number | null;
const dec = (v: Dec | undefined) => (v === null || v === undefined ? null : Number(v));

/** A stored slip (PaddyPurchase row) → what the slip shows. */
export function toPaddySlipData(p: {
  bagCount: number; grossKg: Dec; dhaltaKg: Dec; netKg: Dec; mon: Dec; ratePerMon: Dec; totalPrice: Dec; notes: string | null;
  variety: string | null; moisturePct: Dec; vehicleGrossKg: Dec; vehicleTareKg: Dec; labourCost: Dec;
}): PaddySlipData {
  return {
    bagCount: p.bagCount, grossKg: dec(p.grossKg) ?? 0, dhaltaKg: dec(p.dhaltaKg) ?? 0, netKg: dec(p.netKg) ?? 0, mon: dec(p.mon) ?? 0,
    ratePerMon: dec(p.ratePerMon) ?? 0, totalPrice: dec(p.totalPrice) ?? 0, notes: p.notes,
    variety: p.variety, moisturePct: dec(p.moisturePct), vehicleGrossKg: dec(p.vehicleGrossKg), vehicleTareKg: dec(p.vehicleTareKg), labourCost: dec(p.labourCost) ?? 0,
  };
}

export function PaddySlip({ d, currency }: { d: PaddySlipData; currency: string }) {
  const split = monAndKg(d.netKg);
  const weighbridge = d.vehicleGrossKg && d.vehicleTareKg ? ` (গাড়িসহ ${formatQty(d.vehicleGrossKg)} − খালি ${formatQty(d.vehicleTareKg)})` : "";
  const rows: [string, string][] = [
    ["২. মোট ওজন", `${formatQty(d.grossKg)} কেজি${weighbridge}`],
    ["৩. ঢলতা (বাদ)", `− ${formatQty(d.dhaltaKg)} কেজি`],
    ["৪. নিট ওজন", `${formatQty(d.netKg)} কেজি (${toBnDigits(split.mon)} মণ ${formatQty(split.kg)} কেজি)`],
    ["৫. মণ (নিট ÷ ৪০)", toBnDigits(d.mon.toFixed(2))],
    ["৬. প্রতি মণের দর", formatMoney(d.ratePerMon, currency)],
    ["৭. মোট দাম (মণ × দর)", formatMoney(d.totalPrice, currency)],
    ...(d.variety ? [["ধানের জাত", d.variety] as [string, string]] : []),
    ...(d.moisturePct !== null && d.moisturePct !== undefined ? [["আর্দ্রতা", `${toBnDigits(d.moisturePct)}%`] as [string, string]] : []),
    ...(d.labourCost ? [["লেবার খরচ (আলাদা পরিশোধ)", formatMoney(d.labourCost, currency)] as [string, string]] : []),
  ];
  return (
    <section className="my-3 rounded-lg border-2 border-ink-800 p-3 print:break-inside-avoid" aria-label="ধান ক্রয়ের ওজন স্লিপ">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-200 pb-2">
        <p className="text-base font-bold text-ink-900">১. বস্তার সংখ্যা: <span className="text-2xl tabular-nums">{toBnDigits(d.bagCount)}</span> টি</p>
        <p className="text-xs text-slate-500">ধান ক্রয় — ওজন স্লিপ</p>
      </div>
      <dl className="mt-2 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className={`flex justify-between gap-3 ${k.startsWith("৭") ? "font-bold" : ""}`}><dt className="text-slate-600">{k}</dt><dd className="tabular-nums">{v}</dd></div>
        ))}
      </dl>
      {d.notes && <p className="mt-2 border-t border-ink-200 pt-2 text-sm"><span className="font-semibold">৮. নোট:</span> <span className="whitespace-pre-line">{d.notes}</span></p>}
    </section>
  );
}
