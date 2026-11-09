import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, toBnDigits } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { listBagReturnVouchers } from "@/server/services/bag-tracking";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "খালি বস্তা ফেরত ব্যবস্থাপনা" };

const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);

export default async function BagReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("auto_rice_mill:bag_return:view");
  const p = await readParams(searchParams);
  const page = pageOf(p);

  const { rows, total, sums } = await listBagReturnVouchers(ctx.business.id, {
    from: day(p.from),
    to: day(p.to),
    skip: page.skip,
    take: page.take,
  });

  return (
    <>
      <PageHeader
        title="খালি বস্তা ফেরত ব্যবস্থাপনা"
        description="ধান সরবরাহকারীদের গৃহীত খালি চটের ও প্লাস্টিক বস্তা ফেরত চালান ও লেজার ট্র্যাকিং"
        crumbs={[{ label: "অটো রাইস মিল", href: "/purchases/paddy" }, { label: "খালি বস্তা ফেরত" }]}
        actions={
          can(ctx, "auto_rice_mill:bag_return:create") ? (
            <Link prefetch={false} href="/auto-rice-mill/bag-returns/new" className="btn-primary">
              + নতুন বস্তা ফেরত চালান
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="মোট ফেরত বস্তা" value={`${toBnDigits(sums.total)} টি`} tone="blue" />
        <StatCard label="ফেরত চটের বস্তা" value={`${toBnDigits(sums.jute)} টি`} />
        <StatCard label="ফেরত প্লাস্টিক বস্তা" value={`${toBnDigits(sums.plastic)} টি`} />
        <StatCard label="মোট চালান সংখ্যা" value={`${toBnDigits(total)} টি`} tone="green" />
      </div>

      <section className="panel">
        <FilterBar action="/auto-rice-mill/bag-returns">
          <FilterField label="তারিখ থেকে">
            <input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" />
          </FilterField>
          <FilterField label="পর্যন্ত">
            <input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" />
          </FilterField>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState message="এখনও কোনো বস্তা ফেরত চালান তৈরি হয়নি" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>চালান নং / তারিখ</th>
                  <th>সরবরাহকারী</th>
                  <th className="text-right">চটের বস্তা</th>
                  <th className="text-right">প্লাস্টিক বস্তা</th>
                  <th className="text-right">মোট ফেরত</th>
                  <th>গাড়ি ও ড্রাইভার</th>
                  <th>তৈরি করেছেন</th>
                  <th>নোট</th>
                  <th className="text-center">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const totalBags = r.returnedJuteBags + r.returnedPlasticBags;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link
                          prefetch={false}
                          href={`/auto-rice-mill/bag-returns/${r.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {r.voucherNo}
                        </Link>
                        <span className="block text-xs text-slate-500">{formatDate(r.date)}</span>
                      </td>
                      <td>
                        <Link
                          prefetch={false}
                          href={`/suppliers/${r.supplier.id}/ledger`}
                          className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                        >
                          {r.supplier.name}
                        </Link>
                        {r.supplier.mobile && (
                          <span className="block text-xs text-slate-500">{r.supplier.mobile}</span>
                        )}
                      </td>
                      <td className="num font-medium text-amber-900">{toBnDigits(r.returnedJuteBags)} টি</td>
                      <td className="num font-medium text-blue-900">{toBnDigits(r.returnedPlasticBags)} টি</td>
                      <td className="num font-bold text-ink-900 text-base">{toBnDigits(totalBags)} টি</td>
                      <td className="text-xs text-slate-700">
                        {r.vehicleNo && <span className="font-semibold">{r.vehicleNo}</span>}
                        {r.vehicleNo && r.driverName && <span className="text-slate-400"> · </span>}
                        {r.driverName && <span>ড্রাইভার: {r.driverName}</span>}
                        {!r.vehicleNo && !r.driverName && "—"}
                      </td>
                      <td className="text-xs text-slate-600">{r.createdBy.name}</td>
                      <td className="max-w-[14rem] truncate text-xs text-slate-600" title={r.note ?? ""}>
                        {r.note ?? "—"}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <Link
                          prefetch={false}
                          href={`/auto-rice-mill/bag-returns/${r.id}/print`}
                          className="btn-secondary py-1 px-2.5 text-xs inline-flex items-center gap-1"
                        >
                          🖨 প্রিন্ট চালান
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}

        <Pagination
          basePath="/auto-rice-mill/bag-returns"
          params={p}
          page={page.page}
          totalPages={totalPages(total)}
          total={total}
        />
      </section>
    </>
  );
}
