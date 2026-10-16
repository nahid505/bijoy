import type { Metadata } from "next";
import Link from "next/link";
import { num } from "@/lib/db";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { yieldPercent } from "@/lib/production";
import { ActionButton } from "@/components/forms";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { riceMillTemplateAction } from "@/server/actions/production";
import { listProductions, listRecipes, productionSummary } from "@/server/services/production";

export const metadata: Metadata = { title: "উৎপাদন ব্যবস্থাপনা" };

const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);

export default async function ProductionPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("production:view");
  const manage = can(ctx, "production:manage");
  const cur = ctx.business.currencySymbol;
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = day(p.from) ?? monthStart;
  const to = day(p.to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [summary, { rows, total }, recipes] = await Promise.all([
    productionSummary(ctx.business.id, from, to),
    listProductions(ctx.business.id, { from: day(p.from), to: day(p.to), recipeId: p.recipe || undefined, skip: page.skip, take: page.take }),
    listRecipes(ctx.business.id),
  ]);
  const producedValue = summary.produced.reduce((s, x) => s + x.value, 0);
  return (
    <>
      <PageHeader
        title="উৎপাদন ব্যবস্থাপনা"
        description="কাঁচামাল থেকে তৈরি পণ্য — রেসিপি (BOM), উৎপাদন এন্ট্রি, বাই-প্রোডাক্ট, ফলন ও উৎপাদন ব্যয়"
        crumbs={[{ label: "উৎপাদন" }]}
        actions={manage ? (
          <>
            <Link prefetch={false} href="/production/new" className="btn-primary">+ নতুন উৎপাদন</Link>
            <Link prefetch={false} href="/production/recipes" className="btn-secondary">রেসিপি (BOM)</Link>
          </>
        ) : <Link prefetch={false} href="/production/recipes" className="btn-secondary">রেসিপি (BOM)</Link>}
      />

      {recipes.length === 0 && (
        <section className="panel mb-4 p-5">
          <h2 className="font-semibold text-ink-900">শুরু করুন</h2>
          <p className="mt-1 text-sm text-slate-600">প্রথমে একটি রেসিপি তৈরি করুন — কোন কাঁচামাল থেকে কোন পণ্য ও বাই-প্রোডাক্ট কতটা পাওয়া যায়। চাল মিলের জন্য তৈরি টেমপ্লেট ব্যবহার করতে পারেন: <strong>১০০ কেজি ধান → ৬৫ কেজি চাল, ৫ কেজি খুদ, ৮ কেজি কুঁড়া, ২০ কেজি তুষ</strong> (২ কেজি প্রসেস লস)।</p>
          {manage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton action={riceMillTemplateAction} label="🌾 রাইস মিল রেসিপি তৈরি করুন" className="btn-primary" />
              <Link prefetch={false} href="/production/recipes/new" className="btn-secondary">নিজের রেসিপি তৈরি করুন</Link>
            </div>
          )}
        </section>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`উৎপাদন এন্ট্রি (${formatDate(from)} – ${formatDate(to)})`} value={toBnDigits(summary.runs)} tone="blue" />
        <StatCard label="ব্যবহৃত কাঁচামাল" value={summary.consumed.map((c) => `${formatQty(c.quantity)} ${c.unit} ${c.product}`).join(", ") || "—"} />
        <StatCard label="উৎপাদিত পণ্যের মূল্য" value={formatMoney(producedValue, cur)} tone="green" />
        <StatCard label="অতিরিক্ত উৎপাদন খরচ" value={formatMoney(summary.extraCost, cur)} />
      </div>

      {summary.produced.length > 0 && (
        <section className="panel mb-4">
          <div className="panel-head"><h2 className="panel-title">উৎপাদিত পণ্য ও বাই-প্রোডাক্ট (এই সময়ে)</h2></div>
          <TableWrap>
            <table className="table">
              <thead><tr><th>পণ্য</th><th className="text-right">পরিমাণ</th><th className="text-right">মূল্য</th><th className="text-right">গড় খরচ / একক</th></tr></thead>
              <tbody>
                {summary.produced.map((x) => (
                  <tr key={x.product}><td>{x.product}</td><td className="num">{formatQty(x.quantity)} {x.unit}</td><td className="num">{formatMoney(x.value, cur)}</td><td className="num">{formatMoney(x.quantity ? x.value / x.quantity : 0, cur)}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">উৎপাদন এন্ট্রি</h2></div>
        <FilterBar action="/production">
          <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
          <FilterField label="রেসিপি">
            <select name="recipe" defaultValue={p.recipe ?? ""} className="input w-52"><option value="">সব</option>{recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="এখনও কোনো উৎপাদন এন্ট্রি নেই" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>নং / তারিখ</th><th>রেসিপি</th><th>কাঁচামাল</th><th>উৎপাদন (ফলন)</th><th className="text-right">মোট ব্যয়</th></tr></thead>
              <tbody>
                {rows.map((v) => {
                  const ins = v.items.filter((i) => i.direction === -1);
                  const outs = v.items.filter((i) => i.direction === 1);
                  const main = num(ins[0]?.baseQuantity ?? 0);
                  return (
                    <tr key={v.id}>
                      <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link><span className="block text-xs text-slate-500">{formatDate(v.date)}</span></td>
                      <td className="text-sm">{v.productionRun?.recipe?.name ?? "—"}</td>
                      <td className="text-sm">{ins.map((i) => <span key={i.id} className="block">{i.product.name}: {formatQty(num(i.baseQuantity))} {i.product.unit.name}</span>)}</td>
                      <td className="text-sm">{outs.map((i) => <span key={i.id} className="block">{i.product.name}: {formatQty(num(i.baseQuantity))} {i.product.unit.name} <span className="text-xs text-slate-500">({toBnDigits(yieldPercent(num(i.baseQuantity), main))}%)</span></span>)}</td>
                      <td className="num">{formatMoney(num(v.amount), cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/production" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
