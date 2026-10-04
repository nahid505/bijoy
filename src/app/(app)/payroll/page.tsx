import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { formatDate, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { parsePeriod, PAYROLL_KIND_LABELS, periodKey, periodLabel } from "@/lib/payroll";
import { Badge, EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { readParams, type SearchParams } from "@/server/params";
import { advanceOutstanding, employeePayables, employedDuring, payableReconciliation } from "@/server/services/payroll";

export const metadata: Metadata = { title: "বেতন ড্যাশবোর্ড" };

export default async function PayrollDashboard({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const { year, month } = parsePeriod(p.period) ?? parsePeriod(toDateInput().slice(0, 7))!;
  const biz = ctx.business.id;
  const cur = ctx.business.currencySymbol;
  const [employees, runs, payables, advances, rec, recent, depts] = await Promise.all([
    prisma.employee.count({ where: employedDuring(biz, year, month) }),
    prisma.payrollRun.findMany({ where: { businessId: biz, year, month } }),
    employeePayables(biz),
    advanceOutstanding(prisma, biz),
    payableReconciliation(biz),
    prisma.payrollRun.findMany({ where: { businessId: biz }, orderBy: [{ year: "desc" }, { month: "desc" }, { kind: "asc" }], take: 8 }),
    prisma.department.count({ where: { businessId: biz } }),
  ]);
  const regular = runs.find((r) => r.kind === "REGULAR");
  const payable = round2([...payables.values()].reduce((s, v) => s + v, 0));
  const outstanding = round2(advances.reduce((s, a) => s + Math.max(0, a.outstanding), 0));
  const paidThisMonth = await prisma.salaryPayment.aggregate({ where: { businessId: biz, payslip: { year, month } }, _sum: { amount: true } });
  const prev = month === 1 ? periodKey(year - 1, 12) : periodKey(year, month - 1);
  const next = month === 12 ? periodKey(year + 1, 1) : periodKey(year, month + 1);

  return (
    <>
      <PageHeader
        title="বেতন (Payroll)"
        description="কর্মচারী, হাজিরা, মাসিক বেতন, পরিশোধ ও অগ্রিম — সবকিছু সরাসরি হিসাবের খাতায় পোস্ট হয়"
        crumbs={[{ label: "বেতন" }]}
        actions={
          <>
            {can(ctx, "payroll:process") && <Link prefetch={false} href={`/payroll/runs?period=${periodKey(year, month)}`} className="btn-primary">মাসিক বেতন হিসাব</Link>}
            {can(ctx, "payroll:attendance") && <Link prefetch={false} href="/payroll/attendance" className="btn-secondary">আজকের হাজিরা</Link>}
            {can(ctx, "payroll:manage") && <Link prefetch={false} href="/payroll/employees/new" className="btn-secondary">+ নতুন কর্মচারী</Link>}
          </>
        }
      />
      <nav className="mb-4 flex items-center gap-2 text-sm" aria-label="মাস">
        <Link prefetch={false} href={`/payroll?period=${prev}`} className="btn-ghost btn-sm">← আগের মাস</Link>
        <span className="font-semibold text-ink-900">{periodLabel(year, month)}</span>
        <Link prefetch={false} href={`/payroll?period=${next}`} className="btn-ghost btn-sm">পরের মাস →</Link>
      </nav>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="এই মাসে কর্মরত কর্মচারী" value={toBnDigits(employees)} hint={`${toBnDigits(depts)}টি বিভাগ`} />
        <StatCard
          label="এই মাসের বেতন"
          value={regular ? formatMoney(num(regular.totalNet), cur) : "হিসাব হয়নি"}
          hint={regular ? `${regular.status === "POSTED" ? "চূড়ান্ত" : "খসড়া"} · মোট ${formatMoney(num(regular.totalGross), cur)}` : undefined}
          tone={regular?.status === "POSTED" ? "green" : "amber"}
        />
        <StatCard label="এই মাসের বেতন থেকে পরিশোধ" value={formatMoney(num(paidThisMonth._sum.amount), cur)} tone="blue" />
        <StatCard label="মোট প্রদেয় বেতন (সব মাস)" value={formatMoney(payable, cur)} hint={`অনাদায়ী অগ্রিম/ঋণ ${formatMoney(outstanding, cur)}`} tone="red" />
      </div>
      {rec.difference !== 0 && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200" role="alert">
          ✘ &quot;বেতন প্রদেয়&quot; লেজার ({formatMoney(rec.ledgerBalance, cur)}) কর্মচারীদের প্রদেয়ের ({formatMoney(rec.employees, cur)}) সাথে মিলছে না — বেতন মডিউলের বাইরে থেকে ঐ লেজারে এন্ট্রি হয়েছে কিনা দেখুন।
        </p>
      )}
      <section className="panel">
        <div className="panel-head flex items-center justify-between"><h2 className="panel-title">সাম্প্রতিক বেতন হিসাব</h2><Link prefetch={false} href="/payroll/runs" className="text-sm text-brand-700 hover:underline">সব দেখুন</Link></div>
        {recent.length === 0 ? (
          <EmptyState message="এখনো কোনো বেতন হিসাব হয়নি — প্রথমে কর্মচারী যোগ করুন, তারপর মাসিক বেতন হিসাব করুন" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>মাস</th><th>ধরন</th><th>অবস্থা</th><th className="text-right">মোট বেতন</th><th className="text-right">নিট বেতন</th><th>পোস্টিং তারিখ</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td><Link prefetch={false} href={`/payroll/runs/${r.id}`} className="font-medium hover:text-brand-700 hover:underline">{periodLabel(r.year, r.month)}</Link></td>
                    <td>{PAYROLL_KIND_LABELS[r.kind]}</td>
                    <td>{r.status === "POSTED" ? <Badge tone="green">চূড়ান্ত</Badge> : <Badge tone="amber">খসড়া</Badge>}</td>
                    <td className="num">{formatMoney(num(r.totalGross), cur)}</td>
                    <td className="num font-semibold">{formatMoney(num(r.totalNet), cur)}</td>
                    <td>{formatDate(r.postingDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
