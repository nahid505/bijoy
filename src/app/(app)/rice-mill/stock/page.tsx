import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { millStock, type MillStockRow } from "@/server/services/rice-mill";

export const metadata: Metadata = { title: "চাল ও উপজাত স্টক" };

function StockTable({ id, rows, currency }: { id: string; rows: MillStockRow[]; currency: string }) {
  return (
    <TableWrap>
      <table className="table" id={id}>
        <thead><tr><th>পণ্য</th><th className="num">মজুদ</th><th className="num">মণ</th><th className="num">গড় ক্রয়মূল্য</th><th className="num">মজুদ মূল্য</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link prefetch={false} href={`/products/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link>{r.code && <span className="block text-xs text-slate-400">{r.code}</span>}</td>
              <td className={`num ${r.stock < 0 ? "text-credit" : ""}`}>{formatQty(r.stock)} {r.unit}</td>
              <td className="num">{r.mon === null ? "—" : toBnDigits(r.mon.toFixed(2))}</td>
              <td className="num">{formatMoney(r.avgCost, currency)}</td>
              <td className="num font-semibold">{formatMoney(r.value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** Paddy (raw material) and rice / by-products (চাল, খুদ, কুঁড়া, তুষ …) in stock now. */
export default async function RiceMillStockPage() {
  const ctx = await requirePermission("inventory:view");
  const cur = ctx.business.currencySymbol;
  const s = await millStock(ctx.business.id);
  const paddyKg = s.paddy.filter((r) => r.mon !== null).reduce((t, r) => t + r.stock, 0);
  return (
    <>
      <PageHeader
        title="চাল ও উপজাত স্টক"
        description="ধান (কাঁচামাল) এবং মিলিংয়ে তৈরি চাল ও উপজাত (খুদ, কুঁড়া, তুষ/ভূসি) — বর্তমান মজুদ ও মূল্য"
        crumbs={[{ label: "অটো রাইস মিল ব্যবস্থাপনা" }, { label: "চাল ও উপজাত স্টক" }]}
        actions={
          <>
            {can(ctx, "purchases:create") && <Link prefetch={false} href="/purchases/paddy/new" className="btn-secondary">+ ধান ক্রয়</Link>}
            {can(ctx, "production:manage") && <Link prefetch={false} href="/production/new" className="btn-primary">+ মিলিং ব্যাচ</Link>}
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="ধানের মজুদ" value={`${formatQty(paddyKg)} কেজি`} hint={`${toBnDigits((paddyKg / 40).toFixed(2))} মণ`} />
        <StatCard label="ধানের মজুদ মূল্য" value={formatMoney(s.paddyValue, cur)} tone="blue" />
        <StatCard label="চাল ও উপজাতের মজুদ মূল্য" value={formatMoney(s.outputValue, cur)} tone="green" />
      </div>
      {s.paddy.length + s.outputs.length === 0 ? (
        <section className="panel p-5 text-sm text-slate-600">
          <EmptyState message="এখনও মিলের কোনো পণ্য নেই" />
          <p className="text-center">ধান ক্রয়ের স্লিপ এন্ট্রি করুন এবং <Link prefetch={false} href="/production/recipes" className="text-brand-700 hover:underline">রাইস মিল রেসিপি</Link> (ধান → চাল, খুদ, কুঁড়া, তুষ) তৈরি করুন — তারপর এখানে মজুদ দেখাবে।</p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">ধান (কাঁচামাল)</h2></div>
            {s.paddy.length ? <StockTable id="mill-paddy" rows={s.paddy} currency={cur} /> : <EmptyState message="ধান নেই" />}
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">চাল ও উপজাত</h2></div>
            {s.outputs.length ? <StockTable id="mill-outputs" rows={s.outputs} currency={cur} /> : <EmptyState message="এখনও মিলিং হয়নি" />}
          </section>
        </div>
      )}
    </>
  );
}
