import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { toBnDigits } from "@/lib/format";
import { Badge, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "ফিচার — সুপার অ্যাডমিন" };

/** Feature catalogue × plans. Plans are edited on /admin/plans; per-company overrides on the company page. */
export default async function AdminFeaturesPage() {
  const [features, plans, overrides, offCount] = await Promise.all([
    prisma.feature.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { features: { select: { featureKey: true } } } }),
    prisma.businessFeature.groupBy({ by: ["featureKey", "adminOverride"], where: { adminOverride: { not: null } }, _count: true }),
    prisma.businessFeature.groupBy({ by: ["featureKey"], where: { enabled: false }, _count: true }),
  ]);
  const has = new Map(plans.map((p) => [p.id, new Set(p.features.map((f) => f.featureKey))]));
  const ov = (k: string, v: boolean) => overrides.find((o) => o.featureKey === k && o.adminOverride === v)?._count ?? 0;
  return (
    <>
      <PageHeader title="ফিচার" description="কোন প্ল্যানে কোন ফিচার — পরিবর্তন করতে প্ল্যান খুলুন; কোনো কোম্পানির জন্য আলাদা চালু/বন্ধ কোম্পানির পাতায়" />
      <section className="panel">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th className="min-w-56">ফিচার</th><th>অবস্থা</th>
                {plans.map((p) => <th key={p.id} className="text-center"><Link prefetch={false} href={`/admin/plans/${p.id}`} className="hover:underline">{p.nameBn}</Link>{!p.isActive && <span className="block text-[10px] text-slate-400">নিষ্ক্রিয়</span>}</th>)}
                <th className="text-right" title="সুপার অ্যাডমিন কোম্পানির জন্য আলাদা চালু / বন্ধ করেছেন">ওভাররাইড</th>
                <th className="text-right" title="কোম্পানি নিজে বন্ধ রেখেছে">কোম্পানি বন্ধ</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.key}>
                  <td><span aria-hidden>{f.icon}</span> {f.nameBn} <span className="block text-xs text-slate-400">{f.nameEn} · <code>{f.key}</code></span></td>
                  <td>{f.status === "AVAILABLE" ? <Badge tone="green">চালু</Badge> : <Badge tone="slate">শীঘ্রই</Badge>}</td>
                  {plans.map((p) => <td key={p.id} className="text-center">{has.get(p.id)?.has(f.key) ? <span className="text-brand-700" aria-label="আছে">✓</span> : <span className="text-slate-300" aria-label="নেই">—</span>}</td>)}
                  <td className="num text-xs">+{toBnDigits(ov(f.key, true))} / −{toBnDigits(ov(f.key, false))}</td>
                  <td className="num text-xs">{toBnDigits(offCount.find((o) => o.featureKey === f.key)?._count ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
