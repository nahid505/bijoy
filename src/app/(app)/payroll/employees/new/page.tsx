import type { Metadata } from "next";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { saveEmployeeAction } from "@/server/actions/payroll";
import { employeeFormData } from "@/server/payroll-queries";
import { EmployeeForm } from "../../payroll-forms";

export const metadata: Metadata = { title: "নতুন কর্মচারী" };

export default async function NewEmployeePage() {
  const ctx = await requirePayroll("payroll:manage");
  const data = await employeeFormData(ctx.business.id);
  return (
    <>
      <PageHeader title="নতুন কর্মচারী" description="ব্যক্তিগত তথ্য, বিভাগ ও মাসিক বেতন কাঠামো" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "কর্মচারী", href: "/payroll/employees" }, { label: "নতুন" }]} />
      <EmployeeForm
        action={saveEmployeeAction.bind(null, null)}
        {...data}
        currency={ctx.business.currencySymbol}
        cancelHref="/payroll/employees"
        isEdit={false}
        defaults={{
          code: "", name: "", mobile: "", email: "", address: "", nid: "", tin: "", departmentId: "", designation: "", joiningDate: toDateInput(), exitDate: "",
          status: "ACTIVE", basicSalary: 0, overtimeEligible: true, overtimeRate: "", paymentMethod: "", bankName: "", bankAccountNo: "", notes: "",
          components: data.components.filter((c) => c.kind === "EARNING" && c.appliesTo === "REGULAR" && c.defaultValue > 0).map((c) => ({ componentId: c.id, calcType: c.calcType, value: c.defaultValue })),
        }}
      />
    </>
  );
}
