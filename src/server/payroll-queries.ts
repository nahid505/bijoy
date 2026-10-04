import "server-only";
// Read models for the payroll pages, payslips and reports (no writes).
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { payslipStatus, workingDaysInMonth } from "@/lib/payroll";
import { advanceOutstanding, AUTO_COMPONENTS, employeePayables, payrollConfig } from "./services/payroll";

export type PayslipLineView = { name: string; amount: number; note: string | null; isManual: boolean };

/** Everything a payslip shows: company, employee, month, earnings, deductions, net and payment status. */
export async function getPayslipDetail(businessId: string, id: string) {
  const s = await prisma.payslip.findFirst({
    where: { id, businessId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      run: { select: { id: true, status: true, postingDate: true, kind: true, voucherId: true, voucher: { select: { voucherNo: true } } } },
      employee: { select: { id: true, mobile: true, nid: true, tin: true, joiningDate: true, bankName: true, bankAccountNo: true, paymentMethod: true } },
      payments: { orderBy: { date: "asc" }, include: { voucher: { select: { id: true, voucherNo: true, cashAccount: { select: { name: true } } } } } },
    },
  });
  if (!s) return null;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, address: true, mobile: true, email: true, logo: true, binNumber: true, tinNumber: true, currencySymbol: true } });
  const view = (kind: string) => s.lines.filter((l) => l.kind === kind).map((l) => ({ name: l.name, amount: num(l.amount), note: l.note, isManual: l.isManual }));
  const net = num(s.net);
  const paid = num(s.paidAmount);
  return {
    business,
    payslip: s,
    earnings: view("EARNING"),
    deductions: view("DEDUCTION"),
    employer: view("EMPLOYER"),
    gross: num(s.gross),
    totalDeductions: num(s.totalDeductions),
    net,
    paid,
    due: round2(net - paid),
    // a draft is not payable yet
    status: s.run.status === "POSTED" ? payslipStatus(net, paid) : ("DRAFT" as const),
  };
}

/** Employee profile: payable balance, advances, payslip history, salary revisions. */
export async function getEmployeeProfile(businessId: string, id: string) {
  const e = await prisma.employee.findFirst({
    where: { id, businessId },
    include: {
      department: true,
      components: { include: { component: true }, orderBy: { component: { sortOrder: "asc" } } },
      revisions: { orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], take: 24 },
      payslips: { orderBy: [{ year: "desc" }, { month: "desc" }, { kind: "asc" }], take: 36, include: { run: { select: { status: true } } } },
    },
  });
  if (!e) return null;
  const [payable, advances, paidTotal] = await Promise.all([
    employeePayables(businessId, [id]),
    advanceOutstanding(prisma, businessId, [id]),
    prisma.salaryPayment.aggregate({ where: { businessId, employeeId: id }, _sum: { amount: true } }),
  ]);
  return { employee: e, payable: payable.get(id) ?? 0, advances, paidTotal: num(paidTotal._sum.amount) };
}

/** Departments, assignable pay components and payroll settings for the employee form. */
export async function employeeFormData(businessId: string) {
  const [departments, components, cfg] = await Promise.all([
    prisma.department.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.payComponent.findMany({ where: { businessId, isActive: true, kind: { in: ["EARNING", "DEDUCTION", "EMPLOYER"] }, OR: [{ systemKey: null }, { systemKey: { notIn: [...AUTO_COMPONENTS] } }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    payrollConfig(prisma, businessId),
  ]);
  const now = new Date();
  return {
    departments,
    components: components.map((c) => ({ id: c.id, name: c.name, kind: c.kind, calcType: c.calcType, defaultValue: num(c.defaultValue), appliesTo: c.appliesTo })),
    settings: { ...cfg.settings, workingDays: workingDaysInMonth(now.getUTCFullYear(), now.getUTCMonth() + 1, cfg.settings) },
  };
}
