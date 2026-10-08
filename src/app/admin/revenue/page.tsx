import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatMoney, MONTH_NAMES, toBnDigits } from "@/lib/format";
import { GroupedBars } from "@/components/month-bars";
import { EmptyState, FilterBar, FilterField, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { readParams, type SearchParams } from "@/server/params";
import { revenueReport } from "@/server/services/platform-admin";

export const metadata: Metadata = { title: "আয় — সুপার অ্যাডমিন" };
const STATUS_LABEL: Record<string, string> = { SUCCESS: "সফল", PENDING: "যাচাই বাকি", FAILED: "ব্যর্থ", INITIATED: "শুরু হয়েছে", CANCELLED: "বাতিল", REFUNDED: "রিফান্ড" };

export default async function RevenuePage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const [r, plans] = await Promise.all([revenueReport({ from: p.from, to: p.to, plan: p.plan }), prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, nameBn: true } })]);
  return (
    <>
      <PageHeader title="আয়" description="সফল পেমেন্ট থেকে আয় — মাসিক, বার্ষিক, প্ল্যান অনুযায়ী; রিফান্ড আলাদা দেখানো" />
      <section className="panel mb-4">
        <FilterBar action="/admin/revenue">
          <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
          <FilterField label="প্ল্যান">
            <select name="plan" defaultValue={p.plan ?? ""} className="input w-36"><option value="">সব</option>{plans.map((x) => <option key={x.code} value={x.code}>{x.nameBn}</option>)}</select>
          </FilterField>
        </FilterBar>
      </section>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="মোট আয় (নির্বাচিত সময়)" value={formatMoney(r.total, "৳")} tone="green" />
        <StatCard label="এই মাসের আয়" value={formatMoney(r.thisMonth, "৳")} tone="blue" />
        <StatCard label="এই বছরের আয়" value={formatMoney(r.thisYear, "৳")} tone="blue" />
        <StatCard label="রিফান্ড" value={formatMoney(r.refunded, "৳")} tone="red" />
      </div>
      <div className="mb-4">
        <GroupedBars
          title="মাসিক আয় (১২ মাস)"
          points={r.months.map((m) => ({ key: m.key, label: MONTH_NAMES[m.month].slice(0, 3), fullLabel: `${MONTH_NAMES[m.month]} ${m.key.slice(0, 4)}`, a: m.amount, b: m.count }))}
          labelA="আয় (৳)" labelB="পেমেন্ট সংখ্যা" colorA="#0e8a5d" colorB="#1d4f91" currency="৳"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">প্ল্যান অনুযায়ী</h2></div>
          {r.byPlan.length === 0 ? <EmptyState message="এই সময়ে কোনো আয় নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>প্ল্যান</th><th className="text-right">পেমেন্ট</th><th className="text-right">বার্ষিক</th><th className="text-right">আয়</th></tr></thead>
                <tbody>{r.byPlan.map((x) => <tr key={x.id}><td>{x.nameBn}</td><td className="num">{toBnDigits(x.count)}</td><td className="num">{toBnDigits(x.yearly)}</td><td className="num">{formatMoney(x.amount, "৳")}</td></tr>)}</tbody>
              </table>
            </TableWrap>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">অবস্থা অনুযায়ী পেমেন্ট</h2></div>
          {r.byStatus.length === 0 ? <EmptyState message="কোনো পেমেন্ট নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>অবস্থা</th><th className="text-right">সংখ্যা</th><th className="text-right">টাকা</th></tr></thead>
                <tbody>{r.byStatus.map((x) => <tr key={x.status}><td>{STATUS_LABEL[x.status] ?? x.status}</td><td className="num">{toBnDigits(x.count)}</td><td className="num">{formatMoney(x.amount, "৳")}</td></tr>)}</tbody>
              </table>
            </TableWrap>
          )}
        </section>
      </div>
    </>
  );
}
