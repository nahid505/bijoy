import type { Metadata } from "next";
import Link from "next/link";
import { round2 } from "@/lib/calc";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { reportPeriod } from "@/server/period";
import { isRestricted } from "@/server/party-scope";
import { millSales } from "@/server/services/rice-mill";

export const metadata: Metadata = { title: "চাল ও কুঁড়া/ভূসি বিক্রয়" };

/**
 * Sales of rice and by-products: ordinary sales vouchers (the customer's ledger, cash and stock post as for every
 * sale) — this page lists those with a mill product and the totals per product.
 */
export default async function RiceMillSalesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("sales:view");
  const p = await readParams(searchParams);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  // business-wide totals: not for users restricted to their own customers
  const restricted = isRestricted(ctx);
  const s = restricted ? null : await millSales(ctx.business.id, range, { take: 300 });
  return (
    <>
      <PageHeader
        title="চাল ও কুঁড়া/ভূসি বিক্রয়"
        description="চাল, খুদ, কুঁড়া ও তুষ/ভূসি বিক্রয় — সাধারণ বিক্রয় ভাউচারে হয়, তাই কাস্টমারের লেজার, নগদ ও মজুদে নিজে থেকে এন্ট্রি হয়"
        crumbs={[{ label: "অটো রাইস মিল ব্যবস্থাপনা" }, { label: "চাল ও কুঁড়া/ভূসি বিক্রয়" }]}
        actions={
          <>
            {can(ctx, "reports:view") && !restricted && <Link prefetch={false} href={`/reports/rice-mill?from=${from}&to=${to}`} className="btn-secondary">মিল রিপোর্ট</Link>}
            {can(ctx, "sales:create") && <Link prefetch={false} href="/vouchers/sales/new" className="btn-primary">+ নতুন বিক্রয়</Link>}
          </>
        }
      />
      {!s ? (
        <section className="panel p-5 text-sm text-slate-600">মিলের সামগ্রিক বিক্রয় শুধু সব কাস্টমার দেখার অনুমতি থাকলে দেখা যায় — <Link prefetch={false} href="/vouchers/sales" className="text-brand-700 hover:underline">বিক্রয় তালিকা</Link> দেখুন।</section>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="এই সময়ে বিক্রয়" value={formatMoney(s.revenue, cur)} tone="green" hint={`${toBnDigits(s.voucherCount)} টি ভাউচার`} />
            <StatCard label="বিক্রিত পণ্যের খরচ" value={formatMoney(s.cost, cur)} />
            <StatCard label="মোট লাভ" value={formatMoney(round2(s.revenue - s.cost), cur)} tone={s.revenue - s.cost < 0 ? "red" : "blue"} />
          </div>
          <section className="panel mb-4">
            <FilterBar action="/rice-mill/sales">
              <FilterField label="শুরু"><input type="date" name="from" defaultValue={from} className="input w-40" /></FilterField>
              <FilterField label="শেষ"><input type="date" name="to" defaultValue={to} className="input w-40" /></FilterField>
            </FilterBar>
            {s.products.length === 0 ? <EmptyState message="এই সময়ে চাল বা উপজাত বিক্রয় হয়নি" /> : (
              <TableWrap>
                <table className="table" id="mill-sales-products">
                  <thead><tr><th>পণ্য</th><th className="num">পরিমাণ</th><th className="num">বিক্রয়</th><th className="num">খরচ</th><th className="num">লাভ</th></tr></thead>
                  <tbody>
                    {s.products.map((r) => (
                      <tr key={r.productId}>
                        <td className="font-semibold">{r.name}</td>
                        <td className="num">{formatQty(r.quantity)} {r.unit}</td>
                        <td className="num">{formatMoney(r.revenue, cur)}</td>
                        <td className="num">{formatMoney(r.cost, cur)}</td>
                        <td className="num font-semibold">{formatMoney(round2(r.revenue - r.cost), cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
          {s.vouchers.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title">বিক্রয় ভাউচার</h2></div>
              <TableWrap>
                <table className="table" id="mill-sales-vouchers">
                  <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>ধরন</th><th>কাস্টমার</th><th>পণ্য</th><th className="num">ভাউচারের মোট</th><th className="num">পরিশোধ</th></tr></thead>
                  <tbody>
                    {s.vouchers.map((v) => (
                      <tr key={v.id}>
                        <td className="whitespace-nowrap">{formatDate(v.date)}</td>
                        <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link></td>
                        <td className="text-sm">{VOUCHER_TYPES[v.type as keyof typeof VOUCHER_TYPES].label}</td>
                        <td>{v.party ?? "নগদ বিক্রয়"}</td>
                        <td className="text-sm">{[...new Set(v.lines)].join(", ")}</td>
                        <td className="num">{formatMoney(v.amount, cur)}</td>
                        <td className="num">{formatMoney(v.paid, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </section>
          )}
        </>
      )}
    </>
  );
}
