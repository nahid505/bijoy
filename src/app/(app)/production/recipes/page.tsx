import type { Metadata } from "next";
import Link from "next/link";
import { num } from "@/lib/db";
import { formatQty, toBnDigits } from "@/lib/format";
import { processLoss, yieldPercent } from "@/lib/production";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { riceMillTemplateAction } from "@/server/actions/production";
import { listRecipes } from "@/server/services/production";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "রেসিপি (BOM)" };

export default async function RecipesPage() {
  const ctx = await requirePermission(RICE_MILL_ACCESS.millingView);
  const manage = can(ctx, RICE_MILL_ACCESS.milling);
  const recipes = await listRecipes(ctx.business.id);
  return (
    <>
      <PageHeader
        title="রেসিপি (BOM)"
        description="কোন কাঁচামাল থেকে কোন পণ্য ও বাই-প্রোডাক্ট কতটা পাওয়া যায় — প্রতি ব্যাচের হিসাব, খরচ-ভাগসহ"
        crumbs={[{ label: "উৎপাদন", href: "/production" }, { label: "রেসিপি" }]}
        actions={manage ? (
          <>
            <Link prefetch={false} href="/production/recipes/new" className="btn-primary">+ নতুন রেসিপি</Link>
            <ActionButton action={riceMillTemplateAction} label="🌾 রাইস মিল টেমপ্লেট" className="btn-secondary" />
          </>
        ) : undefined}
      />
      <section className="panel">
        {recipes.length === 0 ? <EmptyState message="এখনও কোনো রেসিপি নেই" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>রেসিপি</th><th>কাঁচামাল (প্রতি ব্যাচ)</th><th>উৎপাদন (ফলন · খরচ-ভাগ)</th><th className="text-right">প্রসেস লস</th><th className="text-right">ব্যবহার</th><th /></tr></thead>
              <tbody>
                {recipes.map((r) => {
                  const ins = r.lines.filter((l) => l.kind === "INPUT");
                  const outs = r.lines.filter((l) => l.kind === "OUTPUT");
                  const main = num(ins[0]?.quantity ?? 0);
                  const loss = processLoss(ins.map((l) => ({ quantity: num(l.quantity), unitId: l.product.unitId })), outs.map((l) => ({ quantity: num(l.quantity), unitId: l.product.unitId })));
                  return (
                    <tr key={r.id}>
                      <td><Link prefetch={false} href={`/production/recipes/${r.id}`} className="font-medium hover:text-brand-700 hover:underline">{r.name}</Link>{!r.isActive && <Badge tone="slate">নিষ্ক্রিয়</Badge>}{r.code && <span className="block font-mono text-xs text-slate-400">{r.code}</span>}</td>
                      <td className="text-sm">{ins.map((l) => <span key={l.id} className="block">{l.product.name}: {formatQty(num(l.quantity))} {l.product.unit.name}</span>)}</td>
                      <td className="text-sm">{outs.map((l) => <span key={l.id} className="block">{l.product.name}: {formatQty(num(l.quantity))} {l.product.unit.name} <span className="text-xs text-slate-500">({toBnDigits(yieldPercent(num(l.quantity), main))}% · ভাগ {toBnDigits(num(l.costShare))}%)</span></span>)}</td>
                      <td className="num">{loss ? `${formatQty(loss.quantity)} (${toBnDigits(loss.percent)}%)` : "—"}</td>
                      <td className="num">{toBnDigits(r._count.runs)} বার</td>
                      <td>{manage && r.isActive && <Link prefetch={false} href={`/production/new?recipe=${r.id}`} className="btn-primary btn-sm">উৎপাদন করুন</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
