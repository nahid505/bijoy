import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { CYCLE_LABELS, effectiveStatus, SUB_STATUS_LABELS, type SubStatus } from "@/lib/subscription";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { dayRange, isPaymentStatus } from "@/server/services/platform-admin";
import { platformSettings } from "@/server/services/subscriptions";
import { ci } from "@/lib/dialect";

export const metadata: Metadata = { title: "সাবস্ক্রিপশন — সুপার অ্যাডমিন" };

export default async function AdminSubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const ends = dayRange(p.from, p.to);
  const now = new Date();
  const where: Prisma.SubscriptionWhereInput = {
    ...(p.q ? { business: { name: ci(p.q) } } : {}),
    ...(p.plan ? { plan: { code: p.plan } } : {}),
    ...(isPaymentStatus(p.payment) ? { paymentStatus: p.payment } : {}),
    ...(ends ? { endDate: ends } : {}),
  };
  const [settings, all, plans] = await Promise.all([
    platformSettings(),
    prisma.subscription.findMany({ where, orderBy: [{ endDate: "asc" }], include: { plan: { select: { nameBn: true, code: true } }, business: { select: { id: true, name: true } } } }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, nameBn: true } }),
  ]);
  const rows = all.map((s) => ({ ...s, eff: effectiveStatus(s, now, { graceDays: settings.graceDays, reminderDays: settings.reminderWindow }) }))
    .filter((s) => !p.status || s.eff.status === p.status);
  const shown = rows.slice(page.skip, page.skip + page.take);
  return (
    <>
      <PageHeader title="সাবস্ক্রিপশন" description="সব কোম্পানির সাবস্ক্রিপশন — অবস্থা, মেয়াদ, স্বয়ংক্রিয় নবায়ন ও শেষ পেমেন্ট" />
      <section className="panel">
        <FilterBar action="/admin/subscriptions">
          <FilterField label="কোম্পানি"><input name="q" defaultValue={p.q ?? ""} className="input w-48" /></FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={p.status ?? ""} className="input w-36"><option value="">সব</option>{(Object.keys(SUB_STATUS_LABELS) as SubStatus[]).map((s) => <option key={s} value={s}>{SUB_STATUS_LABELS[s].bn}</option>)}</select>
          </FilterField>
          <FilterField label="প্ল্যান">
            <select name="plan" defaultValue={p.plan ?? ""} className="input w-32"><option value="">সব</option>{plans.map((x) => <option key={x.code} value={x.code}>{x.nameBn}</option>)}</select>
          </FilterField>
          <FilterField label="পেমেন্ট">
            <select name="payment" defaultValue={p.payment ?? ""} className="input w-32"><option value="">সব</option>{["SUCCESS", "PENDING", "FAILED", "CANCELLED", "REFUNDED"].map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </FilterField>
          <FilterField label="মেয়াদ শেষ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
        </FilterBar>
        {shown.length === 0 ? <EmptyState message="কোনো সাবস্ক্রিপশন পাওয়া যায়নি" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>কোম্পানি</th><th>প্ল্যান</th><th>অবস্থা</th><th>শুরু</th><th>শেষ</th><th>নবায়ন</th><th className="text-right">মূল্য</th><th>পেমেন্ট</th></tr></thead>
              <tbody>
                {shown.map((s) => {
                  const st = SUB_STATUS_LABELS[s.eff.status];
                  const end = s.status === "TRIAL" ? s.trialEndsAt : s.endDate;
                  return (
                    <tr key={s.id}>
                      <td><Link prefetch={false} href={`/admin/companies/${s.business.id}`} className="font-medium hover:underline">{s.business.name}</Link></td>
                      <td>{s.plan.nameBn} <span className="text-xs text-slate-400">{CYCLE_LABELS[s.billingCycle]}</span></td>
                      <td><Badge tone={st.tone}>{st.bn}</Badge>{s.eff.inGrace && <span className="block text-[11px] text-amber-700">গ্রেস পিরিয়ড</span>}</td>
                      <td className="text-sm">{formatDate(s.startDate)}</td>
                      <td className="text-sm">{end ? formatDate(end) : "চলমান"}</td>
                      <td className="text-sm">{s.autoRenew ? "স্বয়ংক্রিয়" : "—"}</td>
                      <td className="num">{s.amount === null ? "—" : formatMoney(num(s.amount), "৳")}</td>
                      <td className="text-xs">{s.paymentStatus ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/subscriptions" params={p} page={page.page} totalPages={totalPages(rows.length)} total={rows.length} />
      </section>
    </>
  );
}
