import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney, toBnDigits } from "@/lib/format";
import { Badge, PageHeader, TableWrap } from "@/components/ui";
import { loadPlans } from "@/server/billing/plans";

export const metadata: Metadata = { title: "প্ল্যান — সুপার অ্যাডমিন" };

export default async function PlansPage() {
  const [{ plans, settings }, counts] = await Promise.all([loadPlans(), prisma.subscription.groupBy({ by: ["planId"], _count: true })]);
  const used = new Map(counts.map((c) => [c.planId, c._count]));
  return (
    <>
      <PageHeader title="প্ল্যান" description="মূল্য, ব্যবহারকারী সীমা ও ফিচার — সব ডেটাবেস থেকে, এখান থেকে পরিবর্তনযোগ্য" actions={<Link prefetch={false} href="/admin/plans/new" className="btn-primary">+ নতুন প্ল্যান</Link>} />
      <section className="panel">
        <TableWrap>
          <table className="table">
            <thead><tr><th>প্ল্যান</th><th>কোড</th><th className="text-right">মাসিক</th><th className="text-right">বার্ষিক</th><th className="text-right">ব্যবহারকারী</th><th className="text-right">ফিচার</th><th className="text-right">কোম্পানি</th><th>অবস্থা</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><Link prefetch={false} href={`/admin/plans/${p.id}`} className="font-medium hover:text-brand-700 hover:underline">{p.nameBn}</Link> <span className="text-xs text-slate-400">{p.nameEn}</span></td>
                  <td className="font-mono text-xs">{p.code}{p.code === settings.trialPlanCode && <span className="ml-1 text-[11px] text-sky-700">ট্রায়াল</span>}{p.code === settings.fallbackPlanCode && <span className="ml-1 text-[11px] text-slate-500">ফলব্যাক</span>}</td>
                  <td className="num">{formatMoney(p.priceMonthly, "৳")}</td>
                  <td className="num">{formatMoney(p.priceYearly, "৳")}</td>
                  <td className="num">{p.userLimit === null ? "সীমাহীন" : toBnDigits(p.userLimit)}</td>
                  <td className="num">{toBnDigits(p.features.length)}</td>
                  <td className="num">{toBnDigits(used.get(p.id) ?? 0)}</td>
                  <td>{p.isActive ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="slate">নিষ্ক্রিয়</Badge>}{!p.isPublic && <span className="ml-1 text-xs text-slate-400">(লুকানো)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
