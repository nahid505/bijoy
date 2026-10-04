import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { toBnDigits } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { RestorePanel } from "./restore-form";

export const metadata: Metadata = { title: "ব্যাকআপ" };

export default async function BackupPage() {
  const ctx = await requirePermission("backup:manage");
  const businessId = ctx.business.id;
  const [accounts, vouchers, entries, products, customers, suppliers] = await Promise.all([
    prisma.account.count({ where: { businessId } }),
    prisma.voucher.count({ where: { businessId } }),
    prisma.journalEntry.count({ where: { businessId } }),
    prisma.product.count({ where: { businessId } }),
    prisma.customer.count({ where: { businessId } }),
    prisma.supplier.count({ where: { businessId } }),
  ]);
  const stats = [["হিসাব (লেজার)", accounts], ["ভাউচার", vouchers], ["জার্নাল এন্ট্রি", entries], ["পণ্য", products], ["কাস্টমার", customers], ["সরবরাহকারী", suppliers]] as const;

  return (
    <>
      <PageHeader title="ব্যাকআপ" description={`${ctx.business.name} — এর সম্পূর্ণ হিসাবের তথ্য ডাউনলোড করুন`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">ব্যবসার ডেটা এক্সপোর্ট (JSON)</h2></div>
          <div className="grid grid-cols-3 divide-x divide-y divide-rule border-b border-rule">
            {stats.map(([l, n]) => <div key={l} className="px-4 py-3"><p className="text-[11px] text-slate-500">{l}</p><p className="font-bold">{toBnDigits(n)}</p></div>)}
          </div>
          <div className="space-y-3 p-4 text-sm">
            <p>চার্ট অব অ্যাকাউন্টস, সকল ভাউচার, জার্নাল এন্ট্রি, পেমেন্ট, পণ্য, ব্যাচ ও স্টক মুভমেন্ট, কাস্টমার ও সরবরাহকারী, এবং কর্মচারী, হাজিরা, বেতন, পে-স্লিপ ও অগ্রিম (বেতনের তথ্য সংবেদনশীল — ফাইলটি নিরাপদে রাখুন) একটি সংস্করণযুক্ত JSON ফাইলে ডাউনলোড হবে। ফাইলে SHA-256 চেকসাম থাকে — পরিবর্তন হলে রিস্টোরের আগে ধরা পড়বে।</p>
            <a href="/api/backup" className="btn-primary">⬇ ব্যাকআপ ডাউনলোড করুন</a>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">ব্যাকআপ যাচাই ও রিস্টোর</h2></div>
          <RestorePanel />
        </section>
        <section className="panel lg:col-span-2">
          <div className="panel-head"><h2 className="panel-title">সম্পূর্ণ ডাটাবেস ব্যাকআপ (সার্ভার প্রশাসকের জন্য)</h2></div>
          <div className="space-y-2 p-4 text-sm">
            <p>সকল ব্যবসা ও ব্যবহারকারীসহ পূর্ণ ব্যাকআপের জন্য সার্ভারে নিচের কমান্ড চালান:</p>
            <pre className="overflow-x-auto rounded bg-ink-900 p-3 text-xs text-ink-100">docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB &gt; backup.sql</pre>
            <p>পুনরুদ্ধার:</p>
            <pre className="overflow-x-auto rounded bg-ink-900 p-3 text-xs text-ink-100">docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB &lt; backup.sql</pre>
          </div>
        </section>
      </div>
    </>
  );
}
