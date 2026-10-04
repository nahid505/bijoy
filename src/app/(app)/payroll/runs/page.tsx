import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { monthEnd, parsePeriod, PAYROLL_KIND_LABELS, periodKey, periodLabel } from "@/lib/payroll";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { readParams, type SearchParams } from "@/server/params";
import { calculatePayrollAction } from "@/server/actions/payroll";

export const metadata: Metadata = { title: "মাসিক বেতন" };

export default async function PayrollRunsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const cur = ctx.business.currencySymbol;
  const { year, month } = parsePeriod(p.period) ?? parsePeriod(toDateInput().slice(0, 7))!;
  const runs = await prisma.payrollRun.findMany({
    where: { businessId: ctx.business.id },
    orderBy: [{ year: "desc" }, { month: "desc" }, { kind: "asc" }],
    include: { _count: { select: { payslips: true } }, voucher: { select: { id: true, voucherNo: true } } },
    take: 60,
  });
  const paid = await prisma.payslip.groupBy({ by: ["runId"], where: { runId: { in: runs.map((r) => r.id) } }, _sum: { paidAmount: true } });
  const paidOf = new Map(paid.map((x) => [x.runId, num(x._sum.paidAmount)]));

  return (
    <>
      <PageHeader title="মাসিক বেতন" description="মাস নির্বাচন → বেতন হিসাব → যাচাই → পোস্ট (চূড়ান্ত) → পরিশোধ" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "মাসিক বেতন" }]} />
      {can(ctx, "payroll:process") && (
        <section className="panel mb-4 p-4">
          <h2 className="panel-title mb-3">বেতন হিসাব করুন</h2>
          <ActionForm action={calculatePayrollAction} className="flex flex-wrap items-end gap-3">
            <Field label="মাস" name="period"><input id="period" type="month" name="period" defaultValue={periodKey(year, month)} className="input w-44" /></Field>
            <Field label="ধরন" name="kind">
              <select id="kind" name="kind" defaultValue="REGULAR" className="input w-40">
                <option value="REGULAR">মাসিক বেতন</option><option value="BONUS">উৎসব ভাতা</option>
              </select>
            </Field>
            <Field label="পোস্টিং তারিখ" name="postingDate" hint="খাতায় যে তারিখে বেতন খরচ হিসাবে উঠবে">
              <input id="postingDate" type="date" name="postingDate" defaultValue={toDateInput(monthEnd(year, month))} className="input w-44" />
            </Field>
            <SubmitButton pendingText="হিসাব হচ্ছে…">হিসাব করুন</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">একই মাস ও ধরনের বেতন একবারই হয় — খসড়া থাকলে আবার হিসাব করলে সেটিই হালনাগাদ হবে; চূড়ান্ত (পোস্ট) হলে আর হিসাব করা যাবে না।</p>
        </section>
      )}
      <section className="panel">
        {runs.length === 0 ? (
          <EmptyState message="এখনো কোনো বেতন হিসাব হয়নি" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>মাস</th><th>ধরন</th><th>অবস্থা</th><th className="text-right">কর্মচারী</th><th className="text-right">মোট বেতন</th><th className="text-right">কর্তন</th><th className="text-right">নিট</th><th className="text-right">পরিশোধিত</th><th>ভাউচার</th><th>পোস্টিং</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td><Link prefetch={false} href={`/payroll/runs/${r.id}`} className="font-medium hover:text-brand-700 hover:underline">{periodLabel(r.year, r.month)}</Link></td>
                    <td>{PAYROLL_KIND_LABELS[r.kind]}</td>
                    <td>{r.status === "POSTED" ? <Badge tone="green">চূড়ান্ত</Badge> : <Badge tone="amber">খসড়া</Badge>}</td>
                    <td className="num">{toBnDigits(r._count.payslips)}</td>
                    <td className="num">{formatMoney(num(r.totalGross), cur)}</td>
                    <td className="num">{formatMoney(num(r.totalDeductions), cur)}</td>
                    <td className="num font-semibold">{formatMoney(num(r.totalNet), cur)}</td>
                    <td className="num">{formatMoney(paidOf.get(r.id) ?? 0, cur)}</td>
                    <td>{r.voucher ? <Link prefetch={false} href={`/vouchers/v/${r.voucher.id}`} className="font-mono text-xs hover:underline">{r.voucher.voucherNo}</Link> : "—"}</td>
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
