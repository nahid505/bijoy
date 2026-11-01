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

export const PLAN_HIGHLIGHT_FEATURES: Record<string, string[]> = {
  FREE: [
    "১ জন ব্যবহারকারী",
    "মৌলিক হিসাব ও ক্যাশ বুক",
    "সীমিত বিক্রয় ও ক্রয় এন্ট্রি",
    "সাধারণ ইনভেন্টরি ট্র্যাকিং",
  ],
  BASIC: [
    "৩ জন ব্যবহারকারী",
    "পূর্ণাঙ্গ হিসাব ও ইনভেন্টরি",
    "পিওএস (POS) ও চালান তৈরি",
    "কাস্টমার ও সাপ্লায়ার লেজার",
    "স্ট্যান্ডার্ড রিপোর্ট",
  ],
  BUSINESS: [
    "৮ জন ব্যবহারকারী",
    "মাল্টি-ইউজার রোল পারমিশন",
    "ডিপো ও ডিলার ডেলিভারি ম্যানেজমেন্ট",
    "অ্যাডভান্সড ইনভেন্টরি ও এক্সপায়ারি ট্র্যাকিং",
    "লাভ-ক্ষতি ও পূর্ণাঙ্গ আর্থিক রিপোর্ট",
  ],
  PREMIUM: [
    "২৫ জন ব্যবহারকারী",
    "বিজনেস প্ল্যানের সব ফিচার",
    "মাল্টি-ব্রাঞ্চ / অটো রাইস মিল মডিউল",
    "কাস্টম রোল ও ভিআইপি সাপোর্ট",
    "আনলিমিটেড ভাউচার ও রিপোর্ট এক্সপোর্ট",
  ],
};

export function PlanCards({
  plans,
  features,
  cycle,
  currency = "৳",
  current,
  cta,
  highlight = "BUSINESS",
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
    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
      {plans.map((p) => {
        const price = cycle === "YEARLY" ? p.priceYearly : p.priceMonthly;
        const top = p.code === highlight;
        const highlights =
          PLAN_HIGHLIGHT_FEATURES[p.code] ??
          (p.features
            .map((k) => byKey.get(k)?.nameBn)
            .filter(Boolean)
            .slice(0, 5) as string[]);

        return (
          <li
            key={p.id}
            className={`relative flex flex-col justify-between h-full rounded-2xl p-5 sm:p-6 transition-all duration-200 ${
              top
                ? "bg-white border-2 border-brand-600 shadow-md ring-1 ring-brand-600/20"
                : "bg-white border border-slate-200 shadow-xs hover:border-slate-300 hover:shadow-md"
            } ${current === p.id ? "ring-2 ring-sky-500" : ""}`}
            aria-label={`${p.nameBn} (${p.nameEn})`}
          >
            {top && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-0.5 text-xs font-bold text-white shadow-xs tracking-wide">
                জনপ্রিয়
              </span>
            )}
            {current === p.id && (
              <span className="absolute -top-3 right-4 rounded-full bg-sky-600 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-xs">
                বর্তমান প্ল্যান
              </span>
            )}

            <div>
              <div className="flex items-baseline justify-between gap-1">
                <h3 className="text-lg font-bold text-ink-900">{p.nameBn}</h3>
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  {p.nameEn}
                </span>
              </div>
              <p className="mt-1 min-h-[2.5rem] text-xs text-slate-600 leading-relaxed">
                {p.descriptionBn}
              </p>

              <div className="mt-4 pb-4 border-b border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold tracking-tight tabular-nums text-ink-900">
                    {p.free ? "ফ্রি" : formatMoney(price, currency)}
                  </span>
                  {!p.free && (
                    <span className="text-xs font-medium text-slate-500">
                      / {cycle === "YEARLY" ? "বছর" : "মাস"}
                    </span>
                  )}
                </div>
                {!p.free &&
                cycle === "YEARLY" &&
                p.priceMonthly > 0 &&
                p.priceYearly < p.priceMonthly * 12 ? (
                  <p className="mt-1 text-xs font-medium text-brand-700">
                    বার্ষিক নিলে{" "}
                    {formatMoney(p.priceMonthly * 12 - p.priceYearly, currency)}{" "}
                    সাশ্রয়
                  </p>
                ) : (
                  <p
                    className="mt-1 text-xs text-transparent select-none"
                    aria-hidden="true"
                  >
                    &nbsp;
                  </p>
                )}
              </div>

              <ul className="mt-4 space-y-2.5 text-sm text-slate-700">
                {highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-0.5 shrink-0 font-bold text-brand-600 text-xs"
                    >
                      ✓
                    </span>
                    <span className="leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 pt-2">{cta(p)}</div>
          </li>
        );
      })}
    </ul>
  );
}

export function FeatureComparison({
  plans,
  features,
}: {
  plans: PlanCardData[];
  features: FeatureRow[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="min-w-56">ফিচার</th>
            {plans.map((p) => (
              <th key={p.id} className="text-center">
                {p.nameBn}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-medium">ব্যবহারকারী</td>
            {plans.map((p) => (
              <td key={p.id} className="text-center">
                {p.userLimit === null ? "সীমাহীন" : toBnDigits(p.userLimit)}
              </td>
            ))}
          </tr>
          {features.map((f) => (
            <tr key={f.key}>
              <td>
                <span aria-hidden>{f.icon}</span> {f.nameBn}{" "}
                <span className="text-xs text-slate-400">{f.nameEn}</span>
                {f.soon && (
                  <span className="ml-1 text-[11px] text-slate-400">
                    (শীঘ্রই)
                  </span>
                )}
              </td>
              {plans.map((p) => (
                <td key={p.id} className="text-center">
                  {p.features.includes(f.key) ? (
                    <span
                      className="font-bold text-brand-600"
                      aria-label="আছে"
                    >
                      ✓
                    </span>
                  ) : (
                    <span className="text-slate-300" aria-label="নেই">
                      —
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
