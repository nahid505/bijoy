import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { amountInBanglaWords } from "@/lib/words";
import { PAYROLL_KIND_LABELS, PAYSLIP_STATUS_LABELS, periodLabel } from "@/lib/payroll";
import { PrintButton } from "@/components/forms";
import { Badge } from "@/components/ui";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { adjustPayslipAction } from "@/server/actions/payroll";
import { getPayslipDetail } from "@/server/payroll-queries";
import { PayslipAdjustForm } from "../../payroll-forms";

export const metadata: Metadata = { title: "পে-স্লিপ" };

/** Printable payslip (A4 / A5 — "Save as PDF" from the browser print dialog). */
export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePayroll("payroll:view");
  const d = await getPayslipDetail(ctx.business.id, id);
  if (!d) notFound();
  const { business: b, payslip: s } = d;
  const cur = b.currencySymbol;
  const draft = s.run.status === "DRAFT";
  const regular = s.kind === "REGULAR";
  const statusLabel = d.status === "DRAFT" ? "খসড়া (চূড়ান্ত নয়)" : PAYSLIP_STATUS_LABELS[d.status];
  const manualComponents = draft && can(ctx, "payroll:process")
    ? await prisma.payComponent.findMany({ where: { businessId: ctx.business.id, isActive: true, kind: { in: ["EARNING", "DEDUCTION"] }, OR: [{ systemKey: null }, { systemKey: { notIn: ["BASIC", "OVERTIME", "ABSENCE", "ADVANCE", "LOAN"] } }] }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] })
    : [];
  const employeeRow = await prisma.employee.findUnique({ where: { id: s.employeeId }, select: { overtimeEligible: true } });
  const rows = Math.max(d.earnings.length, d.deductions.length);

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <PrintButton label="প্রিন্ট / PDF" />
        <Link prefetch={false} href={`/payroll/runs/${s.run.id}`} className="btn-secondary">← বেতন তালিকা</Link>
        <Link prefetch={false} href={`/payroll/employees/${s.employeeId}`} className="btn-ghost">কর্মচারীর প্রোফাইল</Link>
        {!draft && d.due > 0 && can(ctx, "payroll:pay") && <Link prefetch={false} href={`/payroll/payments/new?employee=${s.employeeId}`} className="btn-primary">পরিশোধ করুন</Link>}
      </div>

      <article className="panel print-area mx-auto max-w-[210mm] bg-white p-6 text-sm sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink-800 pb-3">
          <div className="flex items-start gap-3">
            {b.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo} alt="" className="h-12 w-12 object-contain" />
            )}
            <div>
              <h1 className="text-lg font-bold text-ink-900">{b.name}</h1>
              {b.address && <p className="whitespace-pre-line text-xs text-slate-600">{b.address}</p>}
              <p className="text-xs text-slate-600">{[b.mobile, b.email].filter(Boolean).join(" · ")}</p>
              {b.tinNumber && <p className="text-xs text-slate-600">TIN: {b.tinNumber}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-ink-900">পে-স্লিপ</p>
            <p className="font-semibold">{periodLabel(s.year, s.month)}{regular ? "" : ` · ${PAYROLL_KIND_LABELS[s.kind]}`}</p>
            <p className="text-xs">তারিখ: {formatDate(s.run.postingDate)}</p>
            <p className="mt-1"><Badge tone={d.status === "PAID" ? "green" : d.status === "PARTIAL" ? "amber" : d.status === "DRAFT" ? "slate" : "red"}>{statusLabel}</Badge></p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-rule py-3 text-xs sm:grid-cols-3">
          <p><span className="text-slate-500">কর্মচারী:</span> <b>{s.employeeName}</b></p>
          <p><span className="text-slate-500">আইডি:</span> {s.employeeCode}</p>
          <p><span className="text-slate-500">পদবি:</span> {s.designation ?? "—"}</p>
          <p><span className="text-slate-500">বিভাগ:</span> {s.departmentName ?? "—"}</p>
          <p><span className="text-slate-500">যোগদান:</span> {formatDate(s.employee.joiningDate)}</p>
          {s.employee.nid && <p><span className="text-slate-500">NID:</span> {s.employee.nid}</p>}
          {s.employee.bankAccountNo && <p><span className="text-slate-500">হিসাব:</span> {[s.employee.bankName, s.employee.bankAccountNo].filter(Boolean).join(" ")}</p>}
          {regular && (
            <>
              <p><span className="text-slate-500">কর্মদিবস:</span> {formatQty(num(s.workingDays))}</p>
              <p><span className="text-slate-500">বেতনযোগ্য দিন:</span> {formatQty(num(s.payableDays))}</p>
              <p><span className="text-slate-500">উপস্থিত / অনুপস্থিত:</span> {formatQty(num(s.presentDays))} / {formatQty(num(s.absentDays))}</p>
              <p><span className="text-slate-500">ছুটি / অর্ধদিবস / দেরি:</span> {formatQty(num(s.leaveDays) + num(s.unpaidLeaveDays))} / {formatQty(num(s.halfDays))} / {formatQty(num(s.lateDays))}</p>
              {num(s.overtimeHours) > 0 && <p><span className="text-slate-500">ওভারটাইম:</span> {formatQty(num(s.overtimeHours))} ঘণ্টা × {formatMoney(num(s.overtimeRate), cur)}</p>}
            </>
          )}
        </section>

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-800 text-left">
              <th className="py-1.5">আয় ও ভাতা</th><th className="py-1.5 text-right">টাকা</th>
              <th className="py-1.5 pl-6">কর্তন</th><th className="py-1.5 text-right">টাকা</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => {
              const e = d.earnings[i];
              const x = d.deductions[i];
              return (
                <tr key={i} className="border-b border-rule align-top">
                  <td className="py-1">{e ? <>{e.name}{e.note && <span className="block text-[11px] text-slate-500">{e.note}</span>}</> : ""}</td>
                  <td className="py-1 text-right tabular-nums">{e ? formatMoney(e.amount, cur) : ""}</td>
                  <td className="py-1 pl-6">{x ? <>{x.name}{x.note && <span className="block text-[11px] text-slate-500">{x.note}</span>}</> : ""}</td>
                  <td className="py-1 text-right tabular-nums">{x ? formatMoney(x.amount, cur) : ""}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-ink-800 font-semibold">
              <td className="py-1.5">মোট বেতন (Gross)</td><td className="py-1.5 text-right tabular-nums">{formatMoney(d.gross, cur)}</td>
              <td className="py-1.5 pl-6">মোট কর্তন</td><td className="py-1.5 text-right tabular-nums">{formatMoney(d.totalDeductions, cur)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-md bg-ink-50 px-4 py-3">
          <div>
            <p className="text-xs text-slate-500">নিট বেতন (Net)</p>
            <p className="text-2xl font-bold text-ink-900">{formatMoney(d.net, cur)}</p>
            <p className="text-xs">কথায়: {amountInBanglaWords(d.net)}</p>
          </div>
          {!draft && (
            <div className="text-right text-xs">
              <p>পরিশোধিত: <b>{formatMoney(d.paid, cur)}</b></p>
              <p>বাকি: <b className={d.due > 0 ? "text-credit" : ""}>{formatMoney(d.due, cur)}</b></p>
            </div>
          )}
        </div>
        {d.employer.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">প্রতিষ্ঠানের অবদান (বেতনের বাইরে): {d.employer.map((l) => `${l.name} ${formatMoney(l.amount, cur)}`).join(" · ")}</p>
        )}
        {s.payments.length > 0 && (
          <div className="mt-3 text-xs">
            <p className="font-semibold">পরিশোধ</p>
            <ul>
              {s.payments.map((pmt) => <li key={pmt.id}>{formatDate(pmt.date)} · {pmt.voucher.voucherNo} · {pmt.voucher.cashAccount?.name} · {formatMoney(num(pmt.amount), cur)}</li>)}
            </ul>
          </div>
        )}
        <footer className="mt-12 grid grid-cols-2 gap-10 text-center text-xs">
          <p className="border-t border-ink-800 pt-1">কর্মচারীর স্বাক্ষর</p>
          <p className="border-t border-ink-800 pt-1">কর্তৃপক্ষের স্বাক্ষর</p>
        </footer>
      </article>

      {manualComponents.length > 0 && (
        <section className="no-print panel mx-auto mt-4 max-w-[210mm] p-4">
          <h2 className="panel-title mb-3">যাচাই ও সমন্বয় (খসড়া)</h2>
          <PayslipAdjustForm
            action={adjustPayslipAction.bind(null, s.id)}
            extraOvertimeHours={num(s.extraOvertimeHours)}
            overtimeEligible={regular && !!employeeRow?.overtimeEligible}
            manual={s.lines.filter((l) => l.isManual && l.componentId).map((l) => ({ componentId: l.componentId!, amount: num(l.amount), note: l.note ?? "" }))}
            components={manualComponents.map((c) => ({ id: c.id, name: c.name, kind: c.kind, calcType: c.calcType, defaultValue: num(c.defaultValue), appliesTo: c.appliesTo }))}
          />
        </section>
      )}
    </>
  );
}
