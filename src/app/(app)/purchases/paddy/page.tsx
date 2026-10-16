import type { Metadata } from "next";
import Link from "next/link";
import { num } from "@/lib/db";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { listPaddyPurchases } from "@/server/services/paddy";

export const metadata: Metadata = { title: "ধান ক্রয়" };
const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);

export default async function PaddyPurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("purchases:view");
  const cur = ctx.business.currencySymbol;
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const { rows, total, sums } = await listPaddyPurchases(ctx.business.id, { from: day(p.from), to: day(p.to), skip: page.skip, take: page.take });
  return (
    <>
      <PageHeader
        title="ধান ক্রয় (ওজন স্লিপ)"
        description="বস্তা, মোট ওজন, ঢলতা, নিট ওজন, মণ ও দর — সংরক্ষণ করলে সাধারণ ক্রয় ভাউচার হয়: স্টক, সরবরাহকারীর বাকি ও হিসাব একসাথে"
        crumbs={[{ label: "লেনদেন" }, { label: "ধান ক্রয়" }]}
        actions={can(ctx, "purchases:create") ? <Link prefetch={false} href="/purchases/paddy/new" className="btn-primary">+ নতুন ধান ক্রয়</Link> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="মোট বস্তা" value={toBnDigits(sums.bags)} />
        <StatCard label="মোট নিট ওজন" value={`${formatQty(sums.netKg)} কেজি`} />
        <StatCard label="মোট মণ" value={toBnDigits(sums.mon.toFixed(2))} tone="blue" />
        <StatCard label="মোট দাম" value={formatMoney(sums.total, cur)} tone="green" />
      </div>
      <section className="panel">
        <FilterBar action="/purchases/paddy">
          <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="এখনও কোনো ধান ক্রয় নেই" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>নং / তারিখ</th><th>সরবরাহকারী</th><th className="text-right">বস্তা</th><th className="text-right">মোট ওজন</th><th className="text-right">ঢলতা</th><th className="text-right">নিট (কেজি)</th><th className="text-right">মণ</th><th className="text-right">দর / মণ</th><th className="text-right">মোট দাম</th><th>নোট</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link prefetch={false} href={`/vouchers/v/${r.voucher.id}`} className="font-semibold text-brand-700 hover:underline">{r.voucher.voucherNo}</Link><span className="block text-xs text-slate-500">{formatDate(r.voucher.date)}</span></td>
                    <td className="text-sm">{r.voucher.partyAccount?.name ?? "নগদ ক্রয়"}</td>
                    <td className="num">{toBnDigits(r.bagCount)}</td>
                    <td className="num">{formatQty(num(r.grossKg))}</td>
                    <td className="num">{formatQty(num(r.dhaltaKg))}</td>
                    <td className="num">{formatQty(num(r.netKg))}</td>
                    <td className="num">{toBnDigits(num(r.mon).toFixed(2))}</td>
                    <td className="num">{formatMoney(num(r.ratePerMon), cur)}</td>
                    <td className="num font-semibold">{formatMoney(num(r.totalPrice), cur)}</td>
                    <td className="max-w-[16rem] truncate text-sm text-slate-600" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/purchases/paddy" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
