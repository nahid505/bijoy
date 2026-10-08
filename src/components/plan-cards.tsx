// Plan cards and the feature comparison table (pricing page, landing page, company billing).
import { formatMoney, toBnDigits } from "@/lib/format";

export interface PlanCardData {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string | null;
  priceMonthly: number;
  priceYearly: number;
  userLimit: number | null;
  free: boolean;
  features: string[];
}
export interface FeatureRow {
  key: string;
  nameBn: string;
  nameEn: string;
  icon: string;
  soon: boolean;
}

export function PlanCards({
  plans, features, cycle, currency = "৳", current, cta, highlight = "BUSINESS",
}: {
  plans: PlanCardData[];
  features: FeatureRow[];
  cycle: "MONTHLY" | "YEARLY";
  currency?: string;
  current?: string | null;
  cta: (plan: PlanCardData) => React.ReactNode;
  highlight?: string;
}) {
  const byKey = new Map(features.map((f) => [f.key, f]));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((p) => {
        const price = cycle === "YEARLY" ? p.priceYearly : p.priceMonthly;
        const top = p.code === highlight;
        return (
          <li key={p.id} className={`panel relative flex flex-col p-5 ${top ? "ring-2 ring-brand-500" : ""} ${current === p.id ? "ring-2 ring-sky-400" : ""}`} aria-label={`${p.nameBn} (${p.nameEn})`}>
            {top && <span className="absolute -top-2.5 left-4 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">জনপ্রিয়</span>}
            {current === p.id && <span className="absolute -top-2.5 right-4 rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white">বর্তমান প্ল্যান</span>}
            <h3 className="text-lg font-bold text-ink-900">{p.nameBn} <span className="text-sm font-medium text-slate-500">{p.nameEn}</span></h3>
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-600">{p.descriptionBn}</p>
            <p className="mt-3">
              <span className="text-3xl font-bold tabular-nums text-ink-900">{p.free ? "ফ্রি" : formatMoney(price, currency)}</span>
              {!p.free && <span className="text-sm text-slate-500"> / {cycle === "YEARLY" ? "বছর" : "মাস"}</span>}
            </p>
            {!p.free && cycle === "YEARLY" && p.priceMonthly > 0 && p.priceYearly < p.priceMonthly * 12 && (
              <p className="text-xs font-medium text-brand-700">বার্ষিক নিলে {formatMoney(p.priceMonthly * 12 - p.priceYearly, currency)} সাশ্রয়</p>
            )}
            <p className="mt-2 text-sm font-medium text-ink-800">👥 {p.userLimit === null ? "সীমাহীন ব্যবহারকারী" : `${toBnDigits(p.userLimit)} জন ব্যবহারকারী`}</p>
            <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-700">
              {p.features.map((k) => byKey.get(k)).filter(Boolean).map((f) => (
                <li key={f!.key} className="flex gap-1.5"><span aria-hidden className="text-brand-600">✓</span>{f!.nameBn}{f!.soon && <span className="text-[11px] text-slate-400"> (শীঘ্রই)</span>}</li>
              ))}
            </ul>
            <div className="mt-4">{cta(p)}</div>
          </li>
        );
      })}
    </ul>
  );
}

export function FeatureComparison({ plans, features }: { plans: PlanCardData[]; features: FeatureRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="min-w-56">ফিচার</th>
            {plans.map((p) => <th key={p.id} className="text-center">{p.nameBn}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-medium">ব্যবহারকারী</td>
            {plans.map((p) => <td key={p.id} className="text-center">{p.userLimit === null ? "সীমাহীন" : toBnDigits(p.userLimit)}</td>)}
          </tr>
          {features.map((f) => (
            <tr key={f.key}>
              <td><span aria-hidden>{f.icon}</span> {f.nameBn} <span className="text-xs text-slate-400">{f.nameEn}</span>{f.soon && <span className="ml-1 text-[11px] text-slate-400">(শীঘ্রই)</span>}</td>
              {plans.map((p) => (
                <td key={p.id} className="text-center">{p.features.includes(f.key) ? <span className="font-bold text-brand-600" aria-label="আছে">✓</span> : <span className="text-slate-300" aria-label="নেই">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
