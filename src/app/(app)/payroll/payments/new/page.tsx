import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { toDateInput } from "@/lib/format";
import { periodLabel } from "@/lib/payroll";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { canChangeEntryDate } from "@/server/entry-date";
import { readParams, type SearchParams } from "@/server/params";
import { paySalariesAction } from "@/server/actions/payroll";
import { accountOptions } from "@/server/voucher-editor";
import { unpaidPayslips } from "@/server/services/payroll";
import { SalaryPaymentForm } from "../../payroll-forms";

export const metadata: Metadata = { title: "বেতন পরিশোধ" };

export default async function NewSalaryPaymentPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:pay");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  // ?run= pays that month's employees, ?employee= one employee; otherwise everyone with payable salary
  const runEmployees = p.run ? (await prisma.payslip.findMany({ where: { runId: p.run, businessId: biz }, select: { employeeId: true } })).map((s) => s.employeeId) : undefined;
  const ids = p.employee ? [p.employee] : runEmployees;
  const [unpaid, cashAccounts] = await Promise.all([unpaidPayslips(prisma, biz, ids), accountOptions(biz, { kind: { in: ["CASH", "BANK"] } })]);
  const emps = await prisma.employee.findMany({ where: { businessId: biz, id: { in: [...new Set(unpaid.map((u) => u.employeeId))] } }, include: { department: { select: { name: true } } }, orderBy: { code: "asc" } });
  const rows = emps.map((e) => {
    const mine = unpaid.filter((u) => u.employeeId === e.id);
    return { id: e.id, code: e.code, name: e.name, department: e.department?.name ?? null, payable: round2(mine.reduce((s, u) => s + u.due, 0)), months: mine.map((u) => `${periodLabel(u.year, u.month)}${u.kind === "BONUS" ? " (উৎসব)" : ""}`).join(", ") };
  });

  return (
    <>
      <PageHeader title="বেতন পরিশোধ" description="নির্বাচিত কর্মচারীদের প্রদেয় বেতন একটি ভাউচারে পরিশোধ — আগের মাসের বাকি আগে সমন্বয় হয়" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "বেতন পরিশোধ", href: "/payroll/payments" }, { label: "নতুন" }]} />
      {rows.length === 0 ? (
        <section className="panel"><EmptyState message="কোনো প্রদেয় বেতন নেই — আগে মাসিক বেতন পোস্ট (চূড়ান্ত) করুন" /></section>
      ) : (
        <SalaryPaymentForm action={paySalariesAction} employees={rows} cashAccounts={cashAccounts} today={toDateInput()} currency={ctx.business.currencySymbol} dateLocked={!canChangeEntryDate(ctx)} />
      )}
    </>
  );
}
