import type { Metadata } from "next";
import { businessModules, type BusinessModule } from "@/lib/business-types";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { REPORTS, reportOpenFor } from "@/server/reports/registry";
import { featureForPath } from "@/lib/features";
import { isDepot } from "@/lib/depot";

export const metadata: Metadata = { title: "রিপোর্ট" };

const SECTIONS: { title: string; slugs: string[]; depotOnly?: boolean; module?: BusinessModule }[] = [
  { title: "অটো রাইস মিল", slugs: ["daily-milling", "rice-mill"], module: "RICE_MILL" },
  { title: "ডিপো ব্যবস্থাপনা", slugs: ["depot-deliveries", "depot-market-dues", "depot-commission", "depot-company-ledger", "depot-profit-loss", "depot-cash-book", "depot-free"], depotOnly: true },
  { title: "দৈনিক ও হিসাব বই", slugs: ["daily-cash", "daily-summary", "day-book", "ledger", "cash-book", "bank-book"] },
  { title: "আর্থিক বিবরণী", slugs: ["trial-balance", "profit-loss", "balance-sheet", "cash-flow", "income-expense", "expenses", "integrity"] },
  { title: "বিক্রয়, ক্রয় ও মজুদ", slugs: ["daily-sales", "daily-purchase", "daily-stock", "sales", "purchases", "collection", "stock", "stock-valuation"] },
  { title: "পণ্যের মেয়াদ (Expiry)", slugs: ["expired-stock", "expiring-stock", "expiry", "product-expiry", "expiry-value"] },
  { title: "বাকি ও পার্টি", slugs: ["customer-dues", "supplier-dues", "customer-statement", "supplier-statement", "customers", "suppliers"] },
  { title: "বেতন (Payroll)", slugs: ["payroll-monthly", "payroll-employee-history", "payroll-payable", "payroll-payments", "payroll-department", "payroll-components"] },
];

export default async function ReportsIndex() {
  const ctx = await requirePermission("reports:view");
  // each report has its own permission (payroll reports need payroll:view)
  const depot = isDepot(ctx.business.businessType);
  const modules = businessModules(ctx.business.businessTypes);
  const sections = SECTIONS.filter((s) => (!s.depotOnly || depot) && (!s.module || modules.has(s.module))).map((s) => ({ ...s, slugs: s.slugs.filter((slug) => {
    const gate = featureForPath(`/reports/${slug}`);
    return can(ctx, REPORTS.find((x) => x.slug === slug)!.permission) && reportOpenFor(ctx, slug) && (!gate || ctx.features.includes(gate));
  }) })).filter((s) => s.slugs.length);
  return (
    <>
      <PageHeader title="রিপোর্ট" description="সকল রিপোর্ট সরাসরি হিসাবের জার্নাল এন্ট্রি থেকে তৈরি — তারিখ, খোঁজ, প্রিন্ট/PDF ও এক্সেল এক্সপোর্টসহ" />
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
        {ctx.group && (
          <section className="panel border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
            <div className="panel-head flex items-center justify-between">
              <h2 className="panel-title text-primary">এন্টারপ্রাইজ ও গ্রুপ</h2>
              <span className="badge badge-info text-xs">{ctx.group.name}</span>
            </div>
            <ul className="divide-y divide-rule">
              <li>
                <Link prefetch={false} href="/reports/consolidated" className="block px-4 py-3 hover:bg-brand-50/50">
                  <p className="text-sm font-semibold text-ink-900">সম্মিলিত গ্রুপ রিপোর্ট ও এলিমিনেশন</p>
                  <p className="text-xs text-slate-500">গ্রুপের সকল সিস্টার কনসার্নের ব্যালেন্স শীট, লাভ-ক্ষতি ও অভ্যন্তরীণ সেলস-বাকি সমন্বয়</p>
                </Link>
              </li>
              <li>
                <Link prefetch={false} href="/intercompany/reconciliation" className="block px-4 py-3 hover:bg-brand-50/50">
                  <p className="text-sm font-semibold text-ink-900">আন্তঃপ্রতিষ্ঠান রিকনসিলিয়েশন ড্যাশবোর্ড</p>
                  <p className="text-xs text-slate-500">সিস্টার কনসার্নগুলোর দ্বিপাক্ষিক লেনদেন ভেরিফিকেশন ও কন্ট্রা হিসাব</p>
                </Link>
              </li>
            </ul>
          </section>
        )}
        {sections.map((s) => (
          <section key={s.title} className="panel">
            <div className="panel-head"><h2 className="panel-title">{s.title}</h2></div>
            <ul className="divide-y divide-rule">
              {s.slugs.map((slug) => {
                const r = REPORTS.find((x) => x.slug === slug)!;
                return (
                  <li key={slug}>
                    <Link prefetch={false} href={`/reports/${slug}`} className="block px-4 py-3 hover:bg-brand-50/50">
                      <p className="text-sm font-semibold text-ink-900">{r.title}</p>
                      <p className="text-xs text-slate-500">{r.description}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
