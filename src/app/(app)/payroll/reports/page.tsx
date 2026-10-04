import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { PAYROLL_REPORTS } from "@/server/reports/payroll";

export const metadata: Metadata = { title: "বেতন রিপোর্ট" };

export default async function PayrollReportsPage() {
  await requirePayroll("payroll:view");
  return (
    <>
      <PageHeader title="বেতন রিপোর্ট" description="মাস, বিভাগ ও কর্মচারী অনুযায়ী ফিল্টার, প্রিন্ট/PDF ও এক্সেল এক্সপোর্টসহ" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "রিপোর্ট" }]} />
      <section className="panel">
        <ul className="divide-y divide-rule">
          {PAYROLL_REPORTS.map((r) => (
            <li key={r.slug}>
              <Link prefetch={false} href={`/reports/${r.slug}`} className="block px-4 py-3 hover:bg-brand-50/50">
                <p className="text-sm font-semibold text-ink-900">{r.title}</p>
                <p className="text-xs text-slate-500">{r.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
