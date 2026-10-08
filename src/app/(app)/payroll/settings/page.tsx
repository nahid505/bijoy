import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { CALC_TYPE_LABELS, COMPONENT_KIND_LABELS } from "@/lib/payroll";
import { Badge, PageHeader, TableWrap } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { deleteDepartmentAction, saveDepartmentAction, savePayrollSettingsAction } from "@/server/actions/payroll";
import { accountOptions } from "@/server/voucher-editor";
import { AUTO_COMPONENTS } from "@/server/services/payroll";
import { DepartmentManager, PayrollSettingsForm } from "../payroll-forms";
import { intList } from "@/lib/dialect";

export const metadata: Metadata = { title: "বেতন সেটিং" };

const isAuto = (key: string | null) => (AUTO_COMPONENTS as readonly string[]).includes(key ?? "");

export default async function PayrollSettingsPage() {
  const ctx = await requirePayroll("payroll:manage");
  const biz = ctx.business.id;
  const cur = ctx.business.currencySymbol;
  const [s, departments, components] = await Promise.all([
    prisma.payrollSettings.findUniqueOrThrow({ where: { businessId: biz } }),
    prisma.department.findMany({ where: { businessId: biz }, orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } }),
    prisma.payComponent.findMany({ where: { businessId: biz }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], include: { account: { select: { name: true } }, liabilityAccount: { select: { name: true } } } }),
  ]);
  const known = await accountOptions(biz, { id: { in: [s.salaryPayableAccountId, s.advanceAccountId].filter(Boolean) as string[] } }, false, true);

  return (
    <>
      <PageHeader title="বেতন সেটিং" description="কর্মদিবস, ওভারটাইম, অনুপস্থিতির নিয়ম, লেজার, বিভাগ ও বেতনের উপাদান" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "সেটিং" }]} />
      <section className="panel mb-4 p-4">
        <h2 className="panel-title mb-3">হিসাবের নিয়ম ও লেজার</h2>
        <PayrollSettingsForm
          action={savePayrollSettingsAction}
          known={known}
          currency={cur}
          defaults={{
            workingDaysMode: s.workingDaysMode, fixedWorkingDays: s.fixedWorkingDays, weeklyOffDays: intList(s.weeklyOffDays, [5]), hoursPerDay: num(s.hoursPerDay), overtimeMultiplier: num(s.overtimeMultiplier),
            lateDaysPerAbsence: s.lateDaysPerAbsence, absenceBasis: s.absenceBasis, salaryPayableAccountId: s.salaryPayableAccountId ?? "", advanceAccountId: s.advanceAccountId ?? "",
          }}
        />
      </section>
      <section className="panel mb-4 p-4">
        <h2 className="panel-title mb-3">বিভাগ</h2>
        <DepartmentManager
          departments={departments.map((d) => ({ id: d.id, name: d.name, employees: d._count.employees, rename: saveDepartmentAction.bind(null, d.id), remove: deleteDepartmentAction.bind(null, d.id) }))}
          addAction={saveDepartmentAction.bind(null, null)}
        />
      </section>
      <section id="components" className="panel">
        <div className="panel-head flex items-center justify-between">
          <h2 className="panel-title">বেতনের উপাদান (ভাতা, কর্তন, অবদান)</h2>
          <Link prefetch={false} href="/payroll/settings/components/new" className="btn-primary btn-sm">+ নতুন উপাদান</Link>
        </div>
        <TableWrap>
          <table className="table">
            <thead><tr><th>নাম</th><th>ধরন</th><th>হিসাব (ডিফল্ট)</th><th>লেজার</th><th>অবস্থা</th></tr></thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link prefetch={false} href={`/payroll/settings/components/${c.id}`} className="font-medium hover:text-brand-700 hover:underline">{c.name}</Link>
                    {isAuto(c.systemKey) && <span className="ml-1 text-xs text-slate-400">(স্বয়ংক্রিয়)</span>}
                    {c.appliesTo === "BONUS" && <span className="ml-1 text-xs text-slate-400">(উৎসব ভাতায়)</span>}
                  </td>
                  <td>{COMPONENT_KIND_LABELS[c.kind]}</td>
                  <td className="text-sm">
                    {isAuto(c.systemKey) ? "স্বয়ংক্রিয়" : c.calcType === "FIXED" ? (num(c.defaultValue) ? formatMoney(num(c.defaultValue), cur) : "কর্মচারী অনুযায়ী") : `${num(c.defaultValue)}% (${CALC_TYPE_LABELS[c.calcType]})`}
                  </td>
                  <td className="text-sm">
                    {c.account?.name ?? <span className="text-amber-700">নির্ধারিত নয়</span>}
                    {c.liabilityAccount && <span className="block text-xs text-slate-500">দায়: {c.liabilityAccount.name}</span>}
                  </td>
                  <td>{c.isActive ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="slate">নিষ্ক্রিয়</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="px-4 py-3 text-xs text-slate-500">
          বাংলাদেশের আয়কর (উৎসে কর), ভবিষ্য তহবিল ও গ্র্যাচুইটি উপাদান তৈরি আছে কিন্তু নিষ্ক্রিয় — হার যাচাই করে লেজার নির্ধারণের পর সক্রিয় করুন। উৎসব ভাতা আলাদা &quot;উৎসব ভাতা&quot; বেতন হিসাবে হয়।
        </p>
      </section>
    </>
  );
}
