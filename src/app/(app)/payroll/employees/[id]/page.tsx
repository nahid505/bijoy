import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { CALC_TYPE_LABELS, COMPONENT_KIND_LABELS, EMPLOYMENT_STATUS_LABELS, PAYROLL_KIND_LABELS, PAYSLIP_STATUS_LABELS, payslipStatus, periodLabel } from "@/lib/payroll";
import { ActionButton } from "@/components/forms";
import { Badge, DetailRow, EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { deleteEmployeeAction } from "@/server/actions/payroll";
import { getEmployeeProfile } from "@/server/payroll-queries";

export const metadata: Metadata = { title: "কর্মচারী" };

type Structure = { basic: number; lines: { name: string; kind: string; calcType: string; value: number }[] };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePayroll("payroll:view");
  const data = await getEmployeeProfile(ctx.business.id, id);
  if (!data) notFound();
  const { employee: e, payable, advances, paidTotal } = data;
  const cur = ctx.business.currencySymbol;
  const outstanding = advances.reduce((s, a) => s + Math.max(0, a.outstanding), 0);
  const value = (calc: string, v: number) => (calc === "FIXED" ? formatMoney(v, cur) : calc === "RULE" ? "নিয়ম অনুযায়ী" : `${v}% (${CALC_TYPE_LABELS[calc as keyof typeof CALC_TYPE_LABELS]})`);

  return (
    <>
      <PageHeader
        title={e.name}
        description={[e.code, e.designation, e.department?.name].filter(Boolean).join(" · ")}
        crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "কর্মচারী", href: "/payroll/employees" }, { label: e.name }]}
        actions={
          <>
            {can(ctx, "payroll:manage") && <Link prefetch={false} href={`/payroll/employees/${e.id}/edit`} className="btn-primary">সম্পাদনা</Link>}
            {can(ctx, "payroll:pay") && payable > 0 && <Link prefetch={false} href={`/payroll/payments/new?employee=${e.id}`} className="btn-secondary">বেতন পরিশোধ</Link>}
            {can(ctx, "payroll:pay") && <Link prefetch={false} href={`/payroll/advances?employee=${e.id}`} className="btn-secondary">অগ্রিম / ঋণ</Link>}
            <Link prefetch={false} href={`/reports/payroll-employee-history?employeeId=${e.id}`} className="btn-ghost">বেতন ইতিহাস রিপোর্ট</Link>
            {can(ctx, "payroll:manage") && e.payslips.length === 0 && (
              <ActionButton action={deleteEmployeeAction.bind(null, e.id)} label="মুছুন" className="btn-danger" confirmText="কর্মচারী ও তার হাজিরার তথ্য মুছে যাবে। নিশ্চিত?" />
            )}
          </>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="মূল বেতন (মাসিক)" value={formatMoney(num(e.basicSalary), cur)} />
        <StatCard label="প্রদেয় বেতন" value={formatMoney(payable, cur)} tone={payable > 0 ? "red" : "slate"} />
        <StatCard label="মোট পরিশোধিত বেতন" value={formatMoney(paidTotal, cur)} tone="green" />
        <StatCard label="অনাদায়ী অগ্রিম / ঋণ" value={formatMoney(outstanding, cur)} tone={outstanding > 0 ? "amber" : "slate"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">তথ্য</h2></div>
          <dl className="p-4">
            <DetailRow label="কর্মচারী আইডি">{e.code}</DetailRow>
            <DetailRow label="অবস্থা"><Badge tone={e.status === "ACTIVE" ? "green" : e.status === "TERMINATED" ? "red" : "slate"}>{EMPLOYMENT_STATUS_LABELS[e.status]}</Badge></DetailRow>
            <DetailRow label="মোবাইল">{e.mobile ?? "—"}</DetailRow>
            <DetailRow label="জাতীয় পরিচয়পত্র">{e.nid ?? "—"}</DetailRow>
            {e.tin && <DetailRow label="টিআইএন">{e.tin}</DetailRow>}
            <DetailRow label="যোগদান">{formatDate(e.joiningDate)}</DetailRow>
            {e.exitDate && <DetailRow label="অব্যাহতি">{formatDate(e.exitDate)}</DetailRow>}
            <DetailRow label="ঠিকানা">{e.address ?? "—"}</DetailRow>
            <DetailRow label="বেতন প্রদান">{[{ CASH: "নগদ", BANK: "ব্যাংক", MOBILE: "মোবাইল ব্যাংকিং" }[e.paymentMethod ?? ""] ?? "—", e.bankName, e.bankAccountNo].filter(Boolean).join(" · ")}</DetailRow>
            <DetailRow label="ওভারটাইম">{e.overtimeEligible ? (e.overtimeRate ? `${formatMoney(num(e.overtimeRate), cur)} / ঘণ্টা` : "প্রযোজ্য (স্বয়ংক্রিয় হার)") : "প্রযোজ্য নয়"}</DetailRow>
          </dl>
        </section>
        <section className="panel lg:col-span-2">
          <div className="panel-head"><h2 className="panel-title">বেতন কাঠামো</h2></div>
          <TableWrap>
            <table className="table">
              <thead><tr><th>উপাদান</th><th>ধরন</th><th className="text-right">পরিমাণ</th></tr></thead>
              <tbody>
                <tr><td className="font-medium">মূল বেতন</td><td>{COMPONENT_KIND_LABELS.EARNING}</td><td className="num">{formatMoney(num(e.basicSalary), cur)}</td></tr>
                {e.components.map((c) => (
                  <tr key={c.id}>
                    <td>{c.component.name}{!c.component.isActive && <span className="ml-1 text-xs text-amber-700">(নিষ্ক্রিয়)</span>}{c.component.appliesTo === "BONUS" && <span className="ml-1 text-xs text-slate-500">(উৎসব ভাতায়)</span>}</td>
                    <td>{COMPONENT_KIND_LABELS[c.component.kind]}</td>
                    <td className="num">{value(c.calcType, num(c.value))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {advances.length > 0 && (
            <>
              <div className="panel-head border-t border-rule"><h3 className="panel-title">অগ্রিম ও ঋণ</h3></div>
              <TableWrap>
                <table className="table">
                  <thead><tr><th>তারিখ</th><th>ধরন</th><th className="text-right">টাকা</th><th className="text-right">কিস্তি</th><th className="text-right">আদায়</th><th className="text-right">বাকি</th></tr></thead>
                  <tbody>
                    {advances.map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.date)}</td><td>{a.kind === "LOAN" ? "ঋণ" : "অগ্রিম"}</td><td className="num">{formatMoney(a.amountN, cur)}</td>
                        <td className="num">{formatMoney(a.installmentN, cur)}</td><td className="num">{formatMoney(a.recovered, cur)}</td><td className="num font-semibold">{formatMoney(a.outstanding, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          )}
        </section>
      </div>
      <section className="panel mt-4">
        <div className="panel-head"><h2 className="panel-title">পে-স্লিপ ইতিহাস</h2></div>
        {e.payslips.length === 0 ? (
          <EmptyState message="এখনো কোনো বেতন হিসাব হয়নি" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>মাস</th><th>ধরন</th><th className="text-right">মোট বেতন</th><th className="text-right">কর্তন</th><th className="text-right">নিট</th><th className="text-right">পরিশোধিত</th><th>অবস্থা</th></tr></thead>
              <tbody>
                {e.payslips.map((s) => {
                  const st = s.run.status === "POSTED" ? payslipStatus(num(s.net), num(s.paidAmount)) : null;
                  return (
                    <tr key={s.id}>
                      <td><Link prefetch={false} href={`/payroll/payslips/${s.id}`} className="font-medium hover:text-brand-700 hover:underline">{periodLabel(s.year, s.month)}</Link></td>
                      <td>{PAYROLL_KIND_LABELS[s.kind]}</td>
                      <td className="num">{formatMoney(num(s.gross), cur)}</td>
                      <td className="num">{formatMoney(num(s.totalDeductions), cur)}</td>
                      <td className="num font-semibold">{formatMoney(num(s.net), cur)}</td>
                      <td className="num">{formatMoney(num(s.paidAmount), cur)}</td>
                      <td>{st ? <Badge tone={st === "PAID" ? "green" : st === "PARTIAL" ? "amber" : "red"}>{PAYSLIP_STATUS_LABELS[st]}</Badge> : <Badge tone="slate">খসড়া</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      <section className="panel mt-4">
        <div className="panel-head"><h2 className="panel-title">বেতন কাঠামোর ইতিহাস</h2></div>
        {e.revisions.length === 0 ? (
          <EmptyState message="কোনো পরিবর্তন নেই" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>কার্যকর</th><th className="text-right">মূল বেতন</th><th>ভাতা / কর্তন</th><th>কারণ</th></tr></thead>
              <tbody>
                {e.revisions.map((r) => {
                  const st = r.structure as unknown as Structure;
                  return (
                    <tr key={r.id}>
                      <td>{formatDate(r.effectiveFrom)}</td>
                      <td className="num">{formatMoney(num(r.basicSalary), cur)}</td>
                      <td className="text-xs text-slate-600">{st.lines?.map((l) => `${l.name}: ${l.calcType === "FIXED" ? formatMoney(l.value, cur) : `${l.value}%`}`).join(" · ") || "—"}</td>
                      <td className="text-sm">{r.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
