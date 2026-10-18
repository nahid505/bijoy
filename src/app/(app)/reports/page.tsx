import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { REPORTS, reportOpenFor } from "@/server/reports/registry";
import { featureForPath } from "@/lib/features";
import { isDepot } from "@/lib/depot";

export const metadata: Metadata = { title: "রিপোর্ট" };

const SECTIONS: { title: string; slugs: string[]; depotOnly?: boolean }[] = [
  { title: "ডিপো ব্যবস্থাপনা", slugs: ["depot-deliveries", "depot-market-dues", "depot-commission", "depot-company-ledger", "depot-profit-loss", "depot-cash-book", "depot-free"], depotOnly: true },
  { title: "দৈনিক ও হিসাব বই", slugs: ["daily-cash", "daily-summary", "day-book", "ledger", "cash-book", "bank-book"] },
  { title: "আর্থিক বিবরণী", slugs: ["trial-balance", "profit-loss", "balance-sheet", "cash-flow", "income-expense", "expenses", "integrity"] },
  { title: "বিক্রয়, ক্রয় ও মজুদ", slugs: ["daily-sales", "daily-purchase", "sales", "purchases", "collection", "stock", "stock-valuation"] },
  { title: "পণ্যের মেয়াদ (Expiry)", slugs: ["expired-stock", "expiring-stock", "expiry", "product-expiry", "expiry-value"] },
  { title: "বাকি ও পার্টি", slugs: ["customer-dues", "supplier-dues", "customer-statement", "supplier-statement", "customers", "suppliers"] },
  { title: "বেতন (Payroll)", slugs: ["payroll-monthly", "payroll-employee-history", "payroll-payable", "payroll-payments", "payroll-department", "payroll-components"] },
];

export default async function ReportsIndex() {
  const ctx = await requirePermission("reports:view");
  // each report has its own permission (payroll reports need payroll:view)
  const depot = isDepot(ctx.business.businessType);
  const sections = SECTIONS.filter((s) => !s.depotOnly || depot).map((s) => ({ ...s, slugs: s.slugs.filter((slug) => {
    const gate = featureForPath(`/reports/${slug}`);
    return can(ctx, REPORTS.find((x) => x.slug === slug)!.permission) && reportOpenFor(ctx, slug) && (!gate || ctx.features.includes(gate));
  }) })).filter((s) => s.slugs.length);
  return (
    <>
      <PageHeader title="রিপোর্ট" description="সকল রিপোর্ট সরাসরি হিসাবের জার্নাল এন্ট্রি থেকে তৈরি — তারিখ, খোঁজ, প্রিন্ট/PDF ও এক্সেল এক্সপোর্টসহ" />
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
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
