import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { PAYROLL_KIND_LABELS, PAYSLIP_STATUS_LABELS, payslipStatus, periodLabel } from "@/lib/payroll";
import { ActionButton } from "@/components/forms";
import { Badge, FilterBar, FilterField, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { readParams, type SearchParams } from "@/server/params";
import { deletePayrollAction, postPayrollAction, recalculatePayrollAction, reopenPayrollAction } from "@/server/actions/payroll";
import { staleReasons } from "@/server/services/payroll";

export const metadata: Metadata = { title: "বেতন যাচাই" };

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const run = await prisma.payrollRun.findFirst({ where: { id, businessId: ctx.business.id }, include: { voucher: { select: { id: true, voucherNo: true } } } });
  if (!run) notFound();
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim().toLowerCase();
  const all = await prisma.payslip.findMany({
    where: { runId: run.id },
    orderBy: { employeeCode: "asc" },
    include: { lines: { select: { kind: true, amount: true, isManual: true, component: { select: { systemKey: true } } } } },
  });
  const slips = all.filter((s) => (!p.department || s.departmentName === p.department) && (!q || `${s.employeeCode} ${s.employeeName}`.toLowerCase().includes(q)));
  const departments = [...new Set(all.map((s) => s.departmentName).filter(Boolean))] as string[];
  const draft = run.status === "DRAFT";
  const stale = draft ? await staleReasons(prisma, run) : [];
  const paid = all.reduce((s, x) => s + num(x.paidAmount), 0);
  const process = can(ctx, "payroll:process");
  const title = `${periodLabel(run.year, run.month)} — ${PAYROLL_KIND_LABELS[run.kind]}`;

  return (
    <>
      <PageHeader
        title={title}
        description={`${draft ? "খসড়া: যাচাই করে পোস্ট করুন" : `চূড়ান্ত · পোস্ট ${run.postedAt ? formatDateTime(run.postedAt) : ""}`} · পোস্টিং তারিখ ${formatDate(run.postingDate)} · কর্মদিবস ${toBnDigits(run.workingDays)}`}
        crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "মাসিক বেতন", href: "/payroll/runs" }, { label: periodLabel(run.year, run.month) }]}
        actions={
          <>
            {draft && process && <ActionButton action={recalculatePayrollAction.bind(null, run.id)} label="পুনরায় হিসাব" className="btn-secondary" />}
            {draft && process && all.length > 0 && (
              <ActionButton
                action={postPayrollAction.bind(null, run.id)}
                label="পোস্ট ও চূড়ান্ত করুন"
                className="btn-primary"
                confirmText={`${title}: ${all.length} জনের মোট ${formatMoney(num(run.totalGross), cur)} বেতন খরচ ও নিট ${formatMoney(num(run.totalNet), cur)} \"বেতন প্রদেয়\" হিসাবে খাতায় পোস্ট হবে এবং বেতন লক হবে। নিশ্চিত?`}
              />
            )}
            {draft && process && <ActionButton action={deletePayrollAction.bind(null, run.id)} label="খসড়া মুছুন" className="btn-ghost text-credit" confirmText="এই খসড়া বেতন হিসাব মুছে যাবে। নিশ্চিত?" />}
            {!draft && can(ctx, "payroll:pay") && paid < num(run.totalNet) && <Link prefetch={false} href={`/payroll/payments/new?run=${run.id}`} className="btn-primary">বেতন পরিশোধ</Link>}
            {!draft && run.voucher && <Link prefetch={false} href={`/vouchers/v/${run.voucher.id}`} className="btn-secondary">জার্নাল {run.voucher.voucherNo}</Link>}
            {!draft && process && paid === 0 && (
              <ActionButton action={reopenPayrollAction.bind(null, run.id)} label="পোস্টিং বাতিল" className="btn-ghost text-credit" confirmText="জার্নাল ভাউচার মুছে বেতন আবার খসড়া হবে (কোনো পরিশোধ না থাকলেই সম্ভব)। নিশ্চিত?" />
            )}
            <Link prefetch={false} href={`/reports/payroll-monthly?period=${run.year}-${String(run.month).padStart(2, "0")}`} className="btn-ghost">রিপোর্ট</Link>
          </>
        }
      />
      {stale.length > 0 && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">⚠ {stale.join("; ")} — পোস্ট করার আগে &quot;পুনরায় হিসাব&quot; করুন।</p>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="কর্মচারী" value={toBnDigits(all.length)} />
        <StatCard label="মোট বেতন" value={formatMoney(num(run.totalGross), cur)} tone="blue" />
        <StatCard label="কর্তন" value={formatMoney(num(run.totalDeductions), cur)} tone="red" />
        <StatCard label="নিট বেতন" value={formatMoney(num(run.totalNet), cur)} tone="green" hint={num(run.totalEmployer) ? `প্রতিষ্ঠানের অবদান ${formatMoney(num(run.totalEmployer), cur)}` : undefined} />
        <StatCard label="পরিশোধিত" value={formatMoney(paid, cur)} hint={draft ? "পোস্টের পরে পরিশোধ করা যায়" : `বাকি ${formatMoney(num(run.totalNet) - paid, cur)}`} />
      </div>
      <section className="panel">
        <FilterBar action={`/payroll/runs/${run.id}`}>
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q ?? ""} placeholder="নাম বা আইডি" className="input w-48" /></FilterField>
          {departments.length > 0 && (
            <FilterField label="বিভাগ">
              <select name="department" defaultValue={p.department ?? ""} className="input w-40">
                <option value="">সব বিভাগ</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </FilterField>
          )}
        </FilterBar>
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>কর্মচারী</th>{run.kind === "REGULAR" && <th className="text-right">বেতনযোগ্য দিন</th>}<th className="text-right">মূল বেতন</th><th className="text-right">ভাতা</th>
                {run.kind === "REGULAR" && <th className="text-right">ওভারটাইম</th>}<th className="text-right">মোট</th><th className="text-right">কর্তন</th><th className="text-right">নিট</th><th>অবস্থা</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => {
                const by = (k: string) => s.lines.filter((l) => l.component?.systemKey === k).reduce((t, l) => t + num(l.amount), 0);
                const basic = by("BASIC");
                const ot = by("OVERTIME");
                const st = draft ? null : payslipStatus(num(s.net), num(s.paidAmount));
                return (
                  <tr key={s.id}>
                    <td>
                      <Link prefetch={false} href={`/payroll/payslips/${s.id}`} className="font-medium hover:text-brand-700 hover:underline">{s.employeeName}</Link>
                      <span className="block text-xs text-slate-400">{[s.employeeCode, s.designation, s.departmentName].filter(Boolean).join(" · ")}{s.lines.some((l) => l.isManual) ? " · সমন্বয় আছে" : ""}</span>
                    </td>
                    {run.kind === "REGULAR" && <td className="num">{formatQty(num(s.payableDays))}{num(s.deductedDays) > 0 && <span className="block text-xs text-credit">−{formatQty(num(s.deductedDays))} দিন</span>}</td>}
                    <td className="num">{formatMoney(basic, cur)}</td>
                    <td className="num">{formatMoney(num(s.gross) - basic - ot, cur)}</td>
                    {run.kind === "REGULAR" && <td className="num">{ot ? <>{formatMoney(ot, cur)}<span className="block text-xs text-slate-400">{formatQty(num(s.overtimeHours))} ঘণ্টা</span></> : "—"}</td>}
                    <td className="num">{formatMoney(num(s.gross), cur)}</td>
                    <td className="num text-credit">{num(s.totalDeductions) ? formatMoney(num(s.totalDeductions), cur) : "—"}</td>
                    <td className="num font-semibold">{formatMoney(num(s.net), cur)}</td>
                    <td>{st ? <Badge tone={st === "PAID" ? "green" : st === "PARTIAL" ? "amber" : "red"}>{PAYSLIP_STATUS_LABELS[st]}</Badge> : <Badge tone="slate">খসড়া</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
