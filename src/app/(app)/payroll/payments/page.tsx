import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { periodLabel } from "@/lib/payroll";
import { ActionButton } from "@/components/forms";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { SearchSelectField } from "@/components/search-select";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { reportPeriod } from "@/server/period";
import { deleteSalaryPaymentAction } from "@/server/actions/payroll";
import { searchEmployees } from "@/server/lookup";

export const metadata: Metadata = { title: "বেতন পরিশোধ" };

export default async function SalaryPaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  const cur = ctx.business.currencySymbol;
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const where = { businessId: biz, sourceKey: { startsWith: "payroll:payment:" }, date: range, ...(p.employeeId ? { salaryPayments: { some: { employeeId: p.employeeId } } } : {}) };
  const page = pageOf(p);
  const [vouchers, total, picked] = await Promise.all([
    prisma.voucher.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: page.skip,
      take: page.take,
      include: { cashAccount: { select: { name: true } }, salaryPayments: { include: { payslip: { select: { employeeCode: true, employeeName: true, year: true, month: true } } } } },
    }),
    prisma.voucher.count({ where }),
    p.employeeId ? searchEmployees(biz, "", { ids: [p.employeeId] }) : Promise.resolve([]),
  ]);
  const pay = can(ctx, "payroll:pay");

  return (
    <>
      <PageHeader
        title="বেতন পরিশোধ"
        description="প্রতিটি পরিশোধ একটি পেমেন্ট ভাউচার (ডেবিট: বেতন প্রদেয়, ক্রেডিট: নগদ/ব্যাংক)"
        crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "বেতন পরিশোধ" }]}
        actions={pay ? <Link prefetch={false} href="/payroll/payments/new" className="btn-primary">+ বেতন পরিশোধ</Link> : undefined}
      />
      <section className="panel">
        <FilterBar action="/payroll/payments">
          <FilterField label="শুরু"><input type="date" name="from" defaultValue={from} className="input w-40" /></FilterField>
          <FilterField label="শেষ"><input type="date" name="to" defaultValue={to} className="input w-40" /></FilterField>
          <FilterField label="কর্মচারী"><SearchSelectField kind="employees" name="employeeId" id="filter-employee" initial={picked[0] ?? null} noneLabel="সব কর্মচারী" className="w-60" /></FilterField>
        </FilterBar>
        {vouchers.length === 0 ? (
          <EmptyState message="এই সময়ে কোনো বেতন পরিশোধ নেই" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>কর্মচারী (বেতনের মাস)</th><th>মাধ্যম</th><th className="text-right">টাকা</th><th /></tr></thead>
              <tbody>
                {vouchers.map((v) => {
                  const byEmp = new Map<string, string[]>();
                  for (const x of v.salaryPayments) {
                    const k = `${x.payslip.employeeCode} ${x.payslip.employeeName}`;
                    byEmp.set(k, [...(byEmp.get(k) ?? []), `${periodLabel(x.payslip.year, x.payslip.month)}: ${formatMoney(num(x.amount), cur)}`]);
                  }
                  return (
                    <tr key={v.id}>
                      <td>{formatDate(v.date)}</td>
                      <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-mono text-xs hover:underline">{v.voucherNo}</Link>{v.reference && <span className="block text-xs text-slate-400">{v.reference}</span>}</td>
                      <td className="text-sm">
                        {[...byEmp].slice(0, 4).map(([k, months]) => <span key={k} className="block">{k} <span className="text-xs text-slate-500">({months.join(", ")})</span></span>)}
                        {byEmp.size > 4 && <span className="text-xs text-slate-500">আরও {toBnDigits(byEmp.size - 4)} জন</span>}
                      </td>
                      <td className="text-sm">{v.cashAccount?.name}</td>
                      <td className="num font-semibold">{formatMoney(num(v.amount), cur)}</td>
                      <td>{pay && <ActionButton action={deleteSalaryPaymentAction.bind(null, v.id)} label="বাতিল" className="btn-ghost btn-sm text-credit" confirmText="এই বেতন পরিশোধ বাতিল হবে (ভাউচার মুছে যাবে, বেতন আবার প্রদেয় হবে)। নিশ্চিত?" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/payroll/payments" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
