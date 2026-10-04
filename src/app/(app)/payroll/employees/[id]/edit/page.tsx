import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { saveEmployeeAction } from "@/server/actions/payroll";
import { employeeFormData } from "@/server/payroll-queries";
import { EmployeeForm } from "../../../payroll-forms";

export const metadata: Metadata = { title: "কর্মচারী সম্পাদনা" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePayroll("payroll:manage");
  const e = await prisma.employee.findFirst({ where: { id, businessId: ctx.business.id }, include: { components: true } });
  if (!e) notFound();
  const data = await employeeFormData(ctx.business.id);
  // an inactive component still on the structure stays visible (and can be removed)
  const extra = await prisma.payComponent.findMany({ where: { id: { in: e.components.map((c) => c.componentId).filter((cid) => !data.components.some((x) => x.id === cid)) } } });
  const components = [...data.components, ...extra.map((c) => ({ id: c.id, name: `${c.name} (নিষ্ক্রিয়)`, kind: c.kind, calcType: c.calcType, defaultValue: num(c.defaultValue), appliesTo: c.appliesTo }))];
  return (
    <>
      <PageHeader title={`সম্পাদনা: ${e.name}`} description={e.code} crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "কর্মচারী", href: "/payroll/employees" }, { label: e.name, href: `/payroll/employees/${e.id}` }, { label: "সম্পাদনা" }]} />
      <EmployeeForm
        action={saveEmployeeAction.bind(null, e.id)}
        departments={data.departments}
        components={components}
        settings={data.settings}
        currency={ctx.business.currencySymbol}
        cancelHref={`/payroll/employees/${e.id}`}
        isEdit
        defaults={{
          code: e.code, name: e.name, mobile: e.mobile ?? "", email: e.email ?? "", address: e.address ?? "", nid: e.nid ?? "", tin: e.tin ?? "", departmentId: e.departmentId ?? "",
          designation: e.designation ?? "", joiningDate: toDateInput(e.joiningDate), exitDate: e.exitDate ? toDateInput(e.exitDate) : "", status: e.status, basicSalary: num(e.basicSalary),
          overtimeEligible: e.overtimeEligible, overtimeRate: e.overtimeRate === null ? "" : String(num(e.overtimeRate)), paymentMethod: e.paymentMethod ?? "", bankName: e.bankName ?? "",
          bankAccountNo: e.bankAccountNo ?? "", notes: e.notes ?? "", components: e.components.map((c) => ({ componentId: c.componentId, calcType: c.calcType, value: num(c.value) })),
        }}
      />
    </>
  );
}
