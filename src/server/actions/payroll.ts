"use server";

// Payroll server actions: permission check → validation → PayrollService → audit log.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { num, prisma } from "@/lib/db";
import { parsePeriod, PAYROLL_KIND_LABELS, periodLabel } from "@/lib/payroll";
import {
  advanceSchema, attendanceSchema, departmentSchema, employeeSchema, payComponentSchema, payrollRunSchema, payrollSettingsSchema, payslipAdjustSchema, salaryPaymentSchema,
} from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { guard, parseForm, parseJsonPayload, toResult, UserError, type ActionState } from "../action-utils";
import { assertEntryDate } from "../entry-date";
import { flash } from "../flash";
import {
  adjustPayslip, calculatePayrollRun, deleteAdvance, deleteDepartment, deleteEmployee, deletePayComponent, deletePayrollRun, deleteSalaryPayment, giveAdvance, paySalaries,
  postPayrollRun, reopenPayrollRun, saveAttendance, saveDepartment, saveEmployee, savePayComponent, savePayrollSettings,
} from "../services/payroll";

const done = async (message: string, path: string) => {
  await flash(message);
  revalidatePath("/payroll", "layout");
  redirect(path);
};

// ───────────────────────── employees ─────────────────────────

export async function saveEmployeeAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const input = parseJsonPayload(employeeSchema, fd);
    const e = await saveEmployee(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Employee", entityId: e.id,
      details: { code: e.code, name: e.name, status: e.status, basic: num(e.basicSalary), components: input.components.length },
    });
    return e.id;
  });
  if (!r.ok) return toResult(r);
  return done(id ? "কর্মচারীর তথ্য সংরক্ষণ হয়েছে" : "নতুন কর্মচারী যোগ হয়েছে", `/payroll/employees/${r.data}`);
}

export async function deleteEmployeeAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const e = await deleteEmployee(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Employee", entityId: id, details: { code: e.code, name: e.name } });
  });
  if (!r.ok) return toResult(r);
  return done("কর্মচারী মুছে ফেলা হয়েছে", "/payroll/employees");
}

// ───────────────────────── departments, components, settings ─────────────────────────

export async function saveDepartmentAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const { name } = parseForm(departmentSchema, fd);
    const d = await saveDepartment(ctx.svc, name, id ?? undefined);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Department", entityId: d.id, details: { name } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/payroll/settings");
  return { ok: true, message: "বিভাগ সংরক্ষণ হয়েছে" };
}

export async function deleteDepartmentAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const d = await deleteDepartment(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Department", entityId: id, details: { name: d.name } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/payroll/settings");
  return { ok: true, message: "বিভাগ মুছে ফেলা হয়েছে" };
}

export async function savePayComponentAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const input = parseJsonPayload(payComponentSchema, fd);
    const c = await savePayComponent(ctx.svc, input, id ?? undefined);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "PayComponent", entityId: c.id, details: { name: c.name, kind: c.kind, calcType: c.calcType, value: num(c.defaultValue), active: c.isActive, accountId: c.accountId } });
  });
  if (!r.ok) return toResult(r);
  return done("বেতন উপাদান সংরক্ষণ হয়েছে", "/payroll/settings#components");
}

export async function deletePayComponentAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const c = await deletePayComponent(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "PayComponent", entityId: id, details: { name: c.name } });
  });
  if (!r.ok) return toResult(r);
  return done("বেতন উপাদান মুছে ফেলা হয়েছে", "/payroll/settings#components");
}

export async function savePayrollSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:manage");
    const input = parseJsonPayload(payrollSettingsSchema, fd);
    await savePayrollSettings(ctx.svc, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "PayrollSettings", entityId: ctx.business.id, details: { ...input } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/payroll", "layout");
  return { ok: true, message: "বেতন সেটিং সংরক্ষণ হয়েছে" };
}

// ───────────────────────── attendance ─────────────────────────

export async function saveAttendanceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:attendance");
    const input = parseJsonPayload(attendanceSchema, fd);
    const saved = await saveAttendance(ctx.svc, input);
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Attendance", entityId: input.date.toISOString().slice(0, 10),
      details: { date: input.date.toISOString().slice(0, 10), marked: saved, cleared: input.rows.filter((x) => !x.status).length },
    });
    return saved;
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/payroll/attendance");
  return { ok: true, message: `হাজিরা সংরক্ষণ হয়েছে (${r.data} জন)` };
}

// ───────────────────────── payroll runs ─────────────────────────

export async function calculatePayrollAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:process");
    const input = parseForm(payrollRunSchema, fd);
    const p = parsePeriod(input.period)!;
    const res = await calculatePayrollRun(ctx.svc, { ...p, kind: input.kind, postingDate: input.postingDate, note: input.note });
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: res.recalculated ? "UPDATE" : "CREATE", entity: "PayrollRun", entityId: res.run.id,
      details: { period: input.period, kind: input.kind, employees: res.employees, gross: num(res.run.totalGross), net: num(res.run.totalNet), event: res.recalculated ? "recalculated" : "calculated" },
    });
    return res;
  });
  if (!r.ok) return toResult(r);
  const { run, employees, warnings } = r.data;
  return done(
    `${periodLabel(run.year, run.month)} (${PAYROLL_KIND_LABELS[run.kind]}): ${employees} জনের বেতন হিসাব হয়েছে — যাচাই করে পোস্ট করুন${warnings.length ? ` · ${warnings.length}টি সতর্কতা` : ""}`,
    `/payroll/runs/${run.id}`,
  );
}

/** Recalculate an existing draft (same month, kind and posting date). */
export async function recalculatePayrollAction(runId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:process");
    const run = await prisma.payrollRun.findFirst({ where: { id: runId, businessId: ctx.business.id } });
    if (!run) throw new UserError("বেতন হিসাব পাওয়া যায়নি");
    const res = await calculatePayrollRun(ctx.svc, { year: run.year, month: run.month, kind: run.kind, postingDate: run.postingDate });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "PayrollRun", entityId: runId, details: { event: "recalculated", employees: res.employees, net: num(res.run.totalNet) } });
    return res;
  });
  if (!r.ok) return toResult(r);
  return done(`পুনরায় হিসাব হয়েছে (${r.data.employees} জন)${r.data.warnings.length ? ` · ${r.data.warnings.length}টি সতর্কতা` : ""}`, `/payroll/runs/${runId}`);
}

export async function adjustPayslipAction(payslipId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:process");
    const input = parseJsonPayload(payslipAdjustSchema, fd);
    const res = await adjustPayslip(ctx.svc, payslipId, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Payslip", entityId: payslipId, details: { event: "adjusted", extraOvertimeHours: input.extraOvertimeHours, manual: input.manual, net: num(res.slip.net) } });
    return res;
  });
  if (!r.ok) return toResult(r);
  return done(`পে-স্লিপ হালনাগাদ হয়েছে${r.data.warnings.length ? ` · ${r.data.warnings.join("; ")}` : ""}`, `/payroll/payslips/${payslipId}`);
}

export async function postPayrollAction(runId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:process");
    const run = await postPayrollRun(ctx.svc, runId);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "PayrollRun", entityId: runId, details: { event: "posted", voucherId: run.voucherId, gross: num(run.totalGross), net: num(run.totalNet) } });
    return run;
  });
  if (!r.ok) return toResult(r);
  return done("বেতন চূড়ান্ত (পোস্ট) হয়েছে — হিসাবের খাতায় জার্নাল ভাউচার তৈরি হয়েছে", `/payroll/runs/${runId}`);
}

export async function reopenPayrollAction(runId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:process");
    const run = await reopenPayrollRun(ctx.svc, runId);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "PayrollRun", entityId: runId, details: { event: "reopened", period: `${run.year}-${run.month}` } });
  });
  if (!r.ok) return toResult(r);
  return done("পোস্টিং বাতিল হয়েছে — বেতন আবার খসড়া অবস্থায়", `/payroll/runs/${runId}`);
}

export async function deletePayrollAction(runId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:process");
    const run = await deletePayrollRun(ctx.svc, runId);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "PayrollRun", entityId: runId, details: { period: `${run.year}-${run.month}`, kind: run.kind } });
  });
  if (!r.ok) return toResult(r);
  return done("খসড়া বেতন মুছে ফেলা হয়েছে", "/payroll/runs");
}

// ───────────────────────── payments & advances ─────────────────────────

export async function paySalariesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:pay");
    const input = parseJsonPayload(salaryPaymentSchema, fd);
    assertEntryDate(ctx, input.date);
    const v = await paySalaries(ctx.svc, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "SalaryPayment", entityId: v.id, details: { voucherNo: v.voucherNo, amount: num(v.amount), employees: input.items.length } });
    return v;
  });
  if (!r.ok) return toResult(r);
  return done(`বেতন পরিশোধ হয়েছে — ভাউচার ${r.data.voucherNo}`, "/payroll/payments");
}

export async function deleteSalaryPaymentAction(voucherId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:pay");
    const v = await deleteSalaryPayment(ctx.svc, voucherId);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "SalaryPayment", entityId: voucherId, details: { voucherNo: v.voucherNo, amount: num(v.amount) } });
  });
  if (!r.ok) return toResult(r);
  return done("বেতন পরিশোধ বাতিল হয়েছে", "/payroll/payments");
}

export async function giveAdvanceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:pay");
    const input = parseJsonPayload(advanceSchema, fd);
    assertEntryDate(ctx, input.date);
    const a = await giveAdvance(ctx.svc, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "EmployeeAdvance", entityId: a.id, details: { employeeId: a.employeeId, kind: a.kind, amount: num(a.amount), installment: num(a.installment) } });
  });
  if (!r.ok) return toResult(r);
  return done("অগ্রিম/ঋণ প্রদান হয়েছে", "/payroll/advances");
}

export async function deleteAdvanceAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("payroll:pay");
    const a = await deleteAdvance(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "EmployeeAdvance", entityId: id, details: { employeeId: a.employeeId, amount: num(a.amount) } });
  });
  if (!r.ok) return toResult(r);
  return done("অগ্রিম/ঋণ বাতিল হয়েছে", "/payroll/advances");
}
