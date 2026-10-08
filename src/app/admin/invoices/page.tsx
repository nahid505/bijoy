import type { Metadata } from "next";
import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { dayRange } from "@/server/services/platform-admin";
import { ci } from "@/lib/dialect";

export const metadata: Metadata = { title: "ইনভয়েস — সুপার অ্যাডমিন" };
const STATUS: Record<InvoiceStatus, { label: string; tone: "green" | "amber" | "slate" | "blue" }> = { PAID: { label: "পরিশোধিত", tone: "green" }, UNPAID: { label: "অপরিশোধিত", tone: "amber" }, VOID: { label: "বাতিল", tone: "slate" }, REFUNDED: { label: "রিফান্ড", tone: "blue" } };

export default async function AdminInvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const range = dayRange(p.from, p.to);
  const status = (Object.keys(STATUS) as InvoiceStatus[]).find((s) => s === p.status);
  const where: Prisma.InvoiceWhereInput = {
    ...(p.q ? { OR: [{ number: { contains: p.q.toUpperCase() } }, { transactionRef: { contains: p.q } }, { business: { name: ci(p.q) } }] } : {}),
    ...(status ? { status } : {}),
    ...(p.plan ? { plan: { code: p.plan } } : {}),
    ...(range ? { createdAt: range } : {}),
  };
  const [rows, total, plans] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: page.skip, take: page.take, include: { business: { select: { id: true, name: true } }, plan: { select: { nameBn: true } } } }),
    prisma.invoice.count({ where }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, nameBn: true } }),
  ]);
  return (
    <>
      <PageHeader title="ইনভয়েস" description="সব সাবস্ক্রিপশন ইনভয়েস — খুলে প্রিন্ট / PDF করুন" />
      <section className="panel">
        <FilterBar action="/admin/invoices">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q ?? ""} placeholder="নম্বর, কোম্পানি, TrxID" className="input w-52" /></FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={status ?? ""} className="input w-32"><option value="">সব</option>{(Object.keys(STATUS) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select>
          </FilterField>
          <FilterField label="প্ল্যান">
            <select name="plan" defaultValue={p.plan ?? ""} className="input w-32"><option value="">সব</option>{plans.map((x) => <option key={x.code} value={x.code}>{x.nameBn}</option>)}</select>
          </FilterField>
          <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="কোনো ইনভয়েস নেই" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>নম্বর</th><th>তারিখ</th><th>কোম্পানি</th><th>প্ল্যান ও সময়কাল</th><th>মাধ্যম / TrxID</th><th className="text-right">মোট</th><th>অবস্থা</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td><Link prefetch={false} href={`/admin/invoices/${i.id}`} className="font-mono text-sm font-semibold text-brand-700 hover:underline">{i.number}</Link></td>
                    <td className="text-sm">{formatDate(i.createdAt)}</td>
                    <td><Link prefetch={false} href={`/admin/companies/${i.business.id}`} className="hover:underline">{i.business.name}</Link></td>
                    <td className="text-sm">{i.plan.nameBn}<span className="block text-xs text-slate-500">{formatDate(i.periodStart)} — {formatDate(i.periodEnd)}</span></td>
                    <td className="text-sm">{i.paymentMethod ?? "—"}<span className="block font-mono text-xs text-slate-500">{i.transactionRef ?? ""}</span></td>
                    <td className="num">{formatMoney(num(i.total), "৳")}</td>
                    <td><Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/invoices" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
