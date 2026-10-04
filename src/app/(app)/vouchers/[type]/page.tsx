import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { paymentStatus, PAYMENT_STATUS_LABELS } from "@/lib/calc";
import { TRADE_TYPES, VOUCHER_TYPES, voucherTypeFromSlug } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterField, PageHeader, Pagination, SortHeader, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { reportPeriod } from "@/server/period";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { voucherPermission } from "@/server/voucher-permissions";

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const t = voucherTypeFromSlug((await params).type);
  return { title: t ? VOUCHER_TYPES[t].long : "ভাউচার" };
}

export default async function VoucherListPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: SearchParams }) {
  const { type: slug } = await params;
  const type = voucherTypeFromSlug(slug);
  if (!type) notFound();
  const ctx = await requirePermission(voucherPermission(type, "view"));
  const p = await readParams(searchParams);
  const { page, skip, take } = pageOf(p);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const meta = VOUCHER_TYPES[type];
  const trade = TRADE_TYPES.includes(type);
  const q = p.q?.trim();

  const where: Prisma.VoucherWhereInput = {
    businessId: ctx.business.id,
    type,
    date: range,
    ...(q ? { OR: [{ voucherNo: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { narration: { contains: q, mode: "insensitive" } }, { partyAccount: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.voucher.findMany({
      where,
      orderBy: (() => {
        const dir = p.dir === "asc" ? "asc" : "desc";
        if (p.sort === "amount") return [{ amount: dir }, { createdAt: "desc" }];
        if (p.sort === "no") return [{ voucherNo: dir }];
        return [{ date: dir }, { createdAt: dir }];
      })() as Prisma.VoucherOrderByWithRelationInput[],
      skip,
      take,
      include: { partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.voucher.count({ where }),
    prisma.voucher.aggregate({ where, _sum: { amount: true, paidAmount: true } }),
  ]);
  const sumAmount = num(sums._sum.amount);
  const sumPaid = num(sums._sum.paidAmount);

  return (
    <>
      <PageHeader
        title={meta.long}
        crumbs={[{ label: "লেনদেন" }, { label: meta.label }]}
        actions={can(ctx, voucherPermission(type, "create")) && <Link prefetch={false} href={`/vouchers/${slug}/new`} className="btn-primary">+ নতুন {meta.label}</Link>}
      />
      <section className="panel">
        <form method="get" className="no-print flex flex-wrap items-end gap-2 border-b border-rule p-3">
          <FilterField label="শুরু"><input type="date" name="from" defaultValue={from} className="input w-40" /></FilterField>
          <FilterField label="শেষ"><input type="date" name="to" defaultValue={to} className="input w-40" /></FilterField>
          <FilterField label="খুঁজুন"><input name="q" defaultValue={q} placeholder="নম্বর, পার্টি, রেফারেন্স…" className="input w-56" /></FilterField>
          <button type="submit" className="btn-secondary">খুঁজুন</button>
          <Link prefetch={false} href={`/vouchers/${slug}`} className="btn-ghost">রিসেট</Link>
        </form>
        <div className="grid grid-cols-2 divide-x divide-rule border-b border-rule sm:grid-cols-4">
          <div className="px-4 py-2.5"><p className="text-[11px] text-slate-500">ভাউচার</p><p className="text-sm font-bold">{total.toLocaleString("bn-BD")} টি</p></div>
          <div className="px-4 py-2.5"><p className="text-[11px] text-slate-500">মোট টাকা</p><p className="text-sm font-bold tabular-nums">{formatMoney(sumAmount, cur)}</p></div>
          {trade && <div className="px-4 py-2.5"><p className="text-[11px] text-slate-500">নগদে লেনদেন</p><p className="text-sm font-bold tabular-nums text-brand-700">{formatMoney(sumPaid, cur)}</p></div>}
          {trade && <div className="px-4 py-2.5"><p className="text-[11px] text-slate-500">বাকি</p><p className="text-sm font-bold tabular-nums text-credit">{formatMoney(sumAmount - sumPaid, cur)}</p></div>}
        </div>
        {rows.length === 0 ? (
          <EmptyState message="এই সময়ে কোনো ভাউচার নেই" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <SortHeader basePath={`/vouchers/${slug}`} params={p} field="date" label="তারিখ" />
                  <SortHeader basePath={`/vouchers/${slug}`} params={p} field="no" label="ভাউচার নং" />
                  <th>{trade ? "পার্টি" : "হিসাব / বিবরণ"}</th>
                  <th>{trade ? "নগদ/ব্যাংক" : "রেফারেন্স"}</th>
                  <SortHeader basePath={`/vouchers/${slug}`} params={p} field="amount" label="টাকা" className="num" />
                  {trade && <th className="num">বাকি</th>}
                  {trade && <th>অবস্থা</th>}
                  <th>তৈরি করেছেন</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const amt = num(v.amount);
                  const paid = num(v.paidAmount);
                  const st = paymentStatus(amt, paid);
                  return (
                    <tr key={v.id}>
                      <td className="whitespace-nowrap">{formatDate(v.date)}</td>
                      <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link></td>
                      <td>{v.partyAccount?.name ?? (trade ? "নগদ" : v.narration ?? "—")}</td>
                      <td>{trade ? v.cashAccount?.name ?? "—" : v.reference ?? "—"}</td>
                      <td className="num font-semibold">{formatMoney(amt, cur)}</td>
                      {trade && <td className="num">{formatMoney(amt - paid, cur)}</td>}
                      {trade && <td><Badge tone={st === "PAID" ? "green" : st === "PARTIAL" ? "amber" : "red"}>{PAYMENT_STATUS_LABELS[st]}</Badge></td>}
                      <td className="text-xs text-slate-500">{v.createdBy.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath={`/vouchers/${slug}`} params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
