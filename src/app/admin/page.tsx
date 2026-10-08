import type { Metadata } from "next";
import Link from "next/link";
import { num } from "@/lib/db";
import { formatDate, formatMoney, MONTH_NAMES, toBnDigits } from "@/lib/format";
import { SUB_STATUS_LABELS } from "@/lib/subscription";
import { GroupedBars } from "@/components/month-bars";
import { Badge, EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { platformDashboard } from "@/server/services/platform-admin";

export const metadata: Metadata = { title: "সুপার অ্যাডমিন" };

export default async function AdminDashboard() {
  const d = await platformDashboard();
  return (
    <>
      <PageHeader title="প্ল্যাটফর্ম ড্যাশবোর্ড" description="সব কোম্পানি, সাবস্ক্রিপশন, ব্যবহারকারী ও আয়" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        <StatCard label="মোট কোম্পানি" value={toBnDigits(d.companies)} tone="blue" />
        <StatCard label="সক্রিয় কোম্পানি" value={toBnDigits(d.active)} tone="green" />
        <StatCard label="ট্রায়ালে" value={toBnDigits(d.counts.TRIAL)} />
        <StatCard label="মেয়াদোত্তীর্ণ" value={toBnDigits(d.counts.EXPIRED)} tone="red" hint={d.counts.SUSPENDED ? `স্থগিত ${toBnDigits(d.counts.SUSPENDED)}` : undefined} />
        <StatCard label="মোট ব্যবহারকারী" value={toBnDigits(d.users)} hint={`সক্রিয় (৩০ দিনে লগইন) ${toBnDigits(d.activeUsers)}`} />
        <StatCard label="যাচাইয়ের অপেক্ষায় পেমেন্ট" value={toBnDigits(d.pending)} tone={d.pending ? "amber" : "slate"} />
        <StatCard label="এই মাসের আয়" value={formatMoney(d.monthRevenue, "৳")} tone="green" />
        <StatCard label="এই বছরের আয়" value={formatMoney(d.yearRevenue, "৳")} tone="green" />
      </div>
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <GroupedBars
          title="মাসিক আয় ও নতুন কোম্পানি (১২ মাস)"
          points={d.months.map((m) => ({ key: m.key, label: MONTH_NAMES[m.date.getUTCMonth()].slice(0, 3), fullLabel: `${MONTH_NAMES[m.date.getUTCMonth()]} ${m.date.getUTCFullYear()}`, a: m.revenue, b: m.registrations }))}
          labelA="আয় (৳)"
          labelB="নতুন কোম্পানি"
          colorA="#0e8a5d"
          colorB="#1d4f91"
          currency="৳"
        />
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">শীঘ্রই মেয়াদ শেষ (১৪ দিন)</h2></div>
          {d.expiringSoon.length === 0 ? <EmptyState message="কোনো সাবস্ক্রিপশন শীঘ্রই শেষ হচ্ছে না" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>কোম্পানি</th><th>প্ল্যান</th><th>অবস্থা</th><th>শেষ</th></tr></thead>
                <tbody>
                  {d.expiringSoon.map((e) => (
                    <tr key={e.businessId}>
                      <td><Link prefetch={false} href={`/admin/companies/${e.businessId}`} className="hover:underline">{e.name}</Link></td>
                      <td>{e.plan}</td>
                      <td><Badge tone={SUB_STATUS_LABELS[e.status].tone}>{SUB_STATUS_LABELS[e.status].bn}</Badge></td>
                      <td>{formatDate(e.end)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">সাম্প্রতিক নিবন্ধন</h2></div>
          <TableWrap>
            <table className="table">
              <thead><tr><th>কোম্পানি</th><th>প্ল্যান</th><th>অবস্থা</th><th>তারিখ</th></tr></thead>
              <tbody>
                {d.recentBiz.map((b) => (
                  <tr key={b.id}>
                    <td><Link prefetch={false} href={`/admin/companies/${b.id}`} className="font-medium hover:underline">{b.name}</Link></td>
                    <td>{b.subscription?.plan.nameBn ?? "—"}</td>
                    <td>{b.subscription ? SUB_STATUS_LABELS[b.subscription.status].bn : "—"}</td>
                    <td>{formatDate(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">সাম্প্রতিক পেমেন্ট</h2></div>
          {d.recentPay.length === 0 ? <EmptyState message="এখনো কোনো পেমেন্ট নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>কোম্পানি</th><th>প্ল্যান</th><th>মাধ্যম</th><th className="text-right">টাকা</th><th>তারিখ</th></tr></thead>
                <tbody>
                  {d.recentPay.map((p) => (
                    <tr key={p.id}>
                      <td><Link prefetch={false} href={`/admin/companies/${p.businessId}`} className="hover:underline">{p.businessName}</Link></td>
                      <td>{p.transaction.plan.nameBn}</td>
                      <td className="text-sm">{p.transaction.provider}</td>
                      <td className="num">{formatMoney(num(p.amount), "৳")}</td>
                      <td>{formatDate(p.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
      </div>
    </>
  );
}
