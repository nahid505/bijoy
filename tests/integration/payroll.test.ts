// Payroll end-to-end against the test database: setup, employees, attendance, overtime, advances,
// monthly payroll (calculate → review → post), the journal it posts, salary payment, duplicate
// prevention, finalized-payroll protection, period lock, permissions and business isolation.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma, num } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { registerAction } from "@/server/actions/auth";
import { calculatePayrollAction, saveAttendanceAction, paySalariesAction, postPayrollAction } from "@/server/actions/payroll";
import { BUSINESS_COOKIE, getContext } from "@/server/auth";
import { getPayslipDetail } from "@/server/payroll-queries";
import { findReport } from "@/server/reports/registry";
import { searchEmployees } from "@/server/lookup";
import { exportBusiness, restoreBackup, validateBackup } from "@/server/services/backup";
import { systemAccounts } from "@/server/services/accounting";
import { trialBalance } from "@/server/services/report";
import { createSession } from "@/server/services/sessions";
import { deleteVoucher, saveJournalVoucher } from "@/server/services/voucher";
import {
  adjustPayslip, advanceOutstanding, calculatePayrollRun, deleteAdvance, deletePayrollRun, deleteSalaryPayment, ensurePayrollSetup, giveAdvance, payableReconciliation,
  paySalaries, postPayrollRun, reopenPayrollRun, saveAttendance, saveDepartment, saveEmployee, savePayComponent, unpaidPayslips,
} from "@/server/services/payroll";
import type { EmployeeInput } from "@/lib/validation";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";
let n = 0;
const freshMobile = () => `016${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};
const payload = (o: unknown) => form({ payload: JSON.stringify(o) });
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function newBusiness(name: string) {
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  try {
    await registerAction(null, form({ businessName: name, ownerName: "মালিক", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD }));
  } catch (e) {
    if ((e as Error).message !== "NEXT_REDIRECT") throw e;
  }
  if (prev === undefined) delete process.env.REGISTRATION_OTP;
  else process.env.REGISTRATION_OTP = prev;
  const ctx = (await getContext())!;
  return { ctx, cookies: new Map(req.cookies) };
}
async function staff(businessId: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { businessId, name: `role-${Date.now()}-${++n}`, permissions } });
  const user = await prisma.user.create({ data: { name: "স্টাফ", mobile: freshMobile(), passwordHash: "x" } });
  await prisma.membership.create({ data: { userId: user.id, businessId, roleId: role.id } });
  const s = await createSession(prisma, user.id);
  return new Map([[SESSION_COOKIE, await createSessionToken(user.id, s.id)], [BUSINESS_COOKIE, businessId]]);
}
const employee = (o: Partial<EmployeeInput>): EmployeeInput => ({
  code: null, name: "কর্মচারী", mobile: null, email: null, address: null, nid: null, tin: null, departmentId: null, designation: null, joiningDate: D("2025-01-01"),
  exitDate: null, status: "ACTIVE", basicSalary: 0, overtimeEligible: true, overtimeRate: null, paymentMethod: null, bankName: null, bankAccountNo: null, notes: null,
  components: [], revisionNote: null, effectiveFrom: null, ...o,
});
const balance = async (businessId: string, accountId: string) => {
  const a = await prisma.journalEntry.aggregate({ where: { businessId, accountId }, _sum: { debit: true, credit: true } });
  return Math.round((num(a._sum.debit) - num(a._sum.credit)) * 100) / 100;
};

run("payroll", () => {
  let A: Awaited<ReturnType<typeof newBusiness>>;
  let B: Awaited<ReturnType<typeof newBusiness>>;
  const acc = {} as Record<"CASH" | "SALARY" | "PAYABLE" | "ADVANCE" | "OTHER_INCOME", string>;
  const comp = {} as Record<string, string>;
  let e1: string; // full month, attendance exceptions, overtime, advance
  let e2: string; // joins mid-month
  let dept: string;
  let septRun: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    B = await newBusiness("পেরোল অন্য দোকান");
    await ensurePayrollSetup(B.ctx.business.id);
    A = await newBusiness("পেরোল টেস্ট স্টোর");
    const biz = A.ctx.business.id;
    await ensurePayrollSetup(biz);
    await ensurePayrollSetup(biz); // idempotent
    acc.CASH = (await prisma.$transaction((tx) => systemAccounts(tx, biz))).CASH;
    const key = async (k: string) => (await prisma.account.findFirstOrThrow({ where: { businessId: biz, systemKey: k } })).id;
    acc.SALARY = await key("SALARY");
    acc.PAYABLE = await key("SALARY_PAYABLE");
    acc.ADVANCE = await key("EMPLOYEE_ADVANCE");
    acc.OTHER_INCOME = await key("OTHER_INCOME");
    for (const c of await prisma.payComponent.findMany({ where: { businessId: biz } })) comp[c.systemKey ?? c.name] = c.id;
    dept = (await saveDepartment(A.ctx.svc, "বিক্রয়")).id;
  });
  beforeEach(() => {
    req.cookies = new Map(A.cookies);
  });

  it("setup: ledgers, settings and standard components (Bangladesh items inactive until configured)", async () => {
    const biz = A.ctx.business.id;
    const s = await prisma.payrollSettings.findUniqueOrThrow({ where: { businessId: biz } });
    expect(s).toMatchObject({ salaryPayableAccountId: acc.PAYABLE, advanceAccountId: acc.ADVANCE, fixedWorkingDays: 26, lateDaysPerAbsence: 3 });
    const payable = await prisma.account.findUniqueOrThrow({ where: { id: acc.PAYABLE }, include: { group: true } });
    expect(payable).toMatchObject({ name: "বেতন প্রদেয়", isSystem: true, nature: "LIABILITY" });
    const comps = await prisma.payComponent.findMany({ where: { businessId: biz } });
    expect(comps.length).toBe(17);
    expect(comps.filter((c) => ["INCOME_TAX", "PF_EMPLOYEE", "PF_EMPLOYER", "GRATUITY"].includes(c.systemKey!)).every((c) => !c.isActive && !c.accountId)).toBe(true);
    expect(comps.find((c) => c.systemKey === "FESTIVAL_BONUS")!.appliesTo).toBe("BONUS");
  });

  it("employees: auto employee ID, salary structure, validation, revision history", async () => {
    const one = await saveEmployee(A.ctx.svc, employee({
      name: "রহিম উদ্দিন", mobile: "01711-223344", nid: "১২৩৪৫৬৭৮৯০", departmentId: dept, designation: "বিক্রয়কর্মী", basicSalary: 20000,
      components: [
        { componentId: comp.HOUSE_RENT, calcType: "PERCENT_OF_BASIC", value: 50 },
        { componentId: comp.MEDICAL, calcType: "FIXED", value: 1500 },
        { componentId: comp.TRANSPORT, calcType: "FIXED", value: 1000 },
      ],
    }));
    e1 = one.id;
    expect(one.code).toMatch(/^EMP-\d{4}$/);
    expect(one.nid).toBe("১২৩৪৫৬৭৮৯০"); // stored as given: the form schema normalises digits before the service
    const two = await saveEmployee(A.ctx.svc, employee({ name: "করিম মিয়া", joiningDate: D("2026-09-17"), basicSalary: 15000, overtimeEligible: false, components: [{ componentId: comp.HOUSE_RENT, calcType: "PERCENT_OF_BASIC", value: 40 }] }));
    e2 = two.id;
    expect(two.code).not.toBe(one.code);
    expect(await prisma.salaryRevision.count({ where: { employeeId: e1 } })).toBe(1);
    // an automatic component can not be put on a structure
    await expect(saveEmployee(A.ctx.svc, employee({ name: "ভুল", components: [{ componentId: comp.OVERTIME, calcType: "FIXED", value: 1 }] }))).rejects.toThrow(/স্বয়ংক্রিয়/);
    // inactive (not yet configured) PF can not be assigned
    await expect(saveEmployee(A.ctx.svc, employee({ name: "ভুল", components: [{ componentId: comp.PF_EMPLOYEE, calcType: "PERCENT_OF_BASIC", value: 10 }] }))).rejects.toThrow(/নিষ্ক্রিয়/);
    // a department of another business
    const otherDept = await saveDepartment(B.ctx.svc, "বাহিরের");
    await expect(saveEmployee(A.ctx.svc, employee({ name: "ভুল", departmentId: otherDept.id }))).rejects.toThrow(/বিভাগ/);
    // structure change → new revision; unchanged save → none
    const again = await prisma.employee.findUniqueOrThrow({ where: { id: e2 } });
    await saveEmployee(A.ctx.svc, employee({ name: again.name, joiningDate: again.joiningDate, basicSalary: 15000, overtimeEligible: false, components: [{ componentId: comp.HOUSE_RENT, calcType: "PERCENT_OF_BASIC", value: 40 }] }), e2);
    expect(await prisma.salaryRevision.count({ where: { employeeId: e2 } })).toBe(1);
  });

  it("attendance: marked exceptions, overtime; another business's employee refused", async () => {
    const mark = (date: string, status: "ABSENT" | "HALF_DAY" | "LATE" | "PRESENT", ot = 0) => saveAttendance(A.ctx.svc, { date: D(date), rows: [{ employeeId: e1, status, overtimeHours: ot, lateMinutes: status === "LATE" ? 20 : 0, note: null }] });
    await mark("2026-09-01", "ABSENT");
    await mark("2026-09-02", "ABSENT");
    await mark("2026-09-03", "HALF_DAY");
    for (const d of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"]) await mark(d, "LATE");
    await mark("2026-09-10", "PRESENT", 6);
    await mark("2026-09-12", "PRESENT", 4);
    // clearing a mark
    await saveAttendance(A.ctx.svc, { date: D("2026-09-13"), rows: [{ employeeId: e1, status: "ABSENT", overtimeHours: 0, lateMinutes: 0, note: null }] });
    await saveAttendance(A.ctx.svc, { date: D("2026-09-13"), rows: [{ employeeId: e1, status: null, overtimeHours: 0, lateMinutes: 0, note: null }] });
    expect(await prisma.attendance.count({ where: { employeeId: e1 } })).toBe(9);
    const foreign = await saveEmployee(B.ctx.svc, employee({ name: "অন্য" }));
    await expect(saveAttendance(A.ctx.svc, { date: D("2026-09-01"), rows: [{ employeeId: foreign.id, status: "ABSENT", overtimeHours: 0, lateMinutes: 0, note: null }] })).rejects.toThrow(/কর্মচারী/);
  });

  it("advance: Dr employee advance, Cr cash", async () => {
    const before = await balance(A.ctx.business.id, acc.CASH);
    await giveAdvance(A.ctx.svc, { employeeId: e1, kind: "ADVANCE", date: D("2026-09-05"), amount: 5000, installment: 2000, cashAccountId: acc.CASH, note: "চিকিৎসা" });
    expect(await balance(A.ctx.business.id, acc.ADVANCE)).toBe(5000);
    expect(await balance(A.ctx.business.id, acc.CASH)).toBe(before - 5000);
    await expect(giveAdvance(A.ctx.svc, { employeeId: e1, kind: "LOAN", date: D("2026-09-05"), amount: 100, installment: 50, cashAccountId: acc.SALARY, note: null })).rejects.toThrow();
  });

  it("monthly payroll: calculation (attendance, overtime, proration, advance), review adjustments", async () => {
    const r = await calculatePayrollRun(A.ctx.svc, { year: 2026, month: 9, kind: "REGULAR", postingDate: D("2026-09-30") });
    septRun = r.run.id;
    expect(r.employees).toBe(2);
    const s1 = await prisma.payslip.findFirstOrThrow({ where: { runId: septRun, employeeId: e1 }, include: { lines: true } });
    // 20000 basic + 10000 HR + 1500 + 1000 + OT 10 h × 192.31
    expect(num(s1.overtimeHours)).toBe(10);
    expect(num(s1.overtimeRate)).toBe(192.31);
    expect(num(s1.gross)).toBe(34423.1);
    // absent 2 + half 0.5 + late 4 → 1 = 3.5 days × 20000 / 26 = 2692.31; advance installment 2000
    expect(num(s1.deductedDays)).toBe(3.5);
    expect(num(s1.totalDeductions)).toBe(4692.31);
    expect(num(s1.net)).toBe(29730.79);
    expect(s1.lines.find((l) => l.advanceId)?.accountId).toBe(acc.ADVANCE);
    // e2 joined 17 Sep: 14 / 30 of 15000 basic and 40% house rent; not overtime eligible
    const s2 = await prisma.payslip.findFirstOrThrow({ where: { runId: septRun, employeeId: e2 } });
    expect(num(s2.gross)).toBe(9800); // 15000 × 14/30 = 7000 basic + 40% = 2800 house rent
    expect(num(s2.payableDays)).toBe(12.13);

    // review: fine 300 and extra overtime on e1; recalculation keeps them
    await adjustPayslip(A.ctx.svc, s1.id, { extraOvertimeHours: 2, manual: [{ componentId: comp.FINE, amount: 300, note: "দেরিতে হিসাব জমা" }] });
    const adj = await prisma.payslip.findUniqueOrThrow({ where: { id: s1.id } });
    expect(num(adj.overtimeHours)).toBe(12);
    expect(num(adj.net)).toBe(Math.round((29730.79 + 2 * 192.31 - 300) * 100) / 100);
    const again = await calculatePayrollRun(A.ctx.svc, { year: 2026, month: 9, kind: "REGULAR", postingDate: D("2026-09-30") });
    expect(again.run.id).toBe(septRun);
    expect(again.recalculated).toBe(true);
    expect(num((await prisma.payslip.findUniqueOrThrow({ where: { id: s1.id } })).net)).toBe(num(adj.net));
    expect(await prisma.payslip.count({ where: { runId: septRun } })).toBe(2);
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: septRun } });
    const slips = await prisma.payslip.findMany({ where: { runId: septRun } });
    expect(num(run.totalNet)).toBe(Math.round(slips.reduce((s, x) => s + num(x.net), 0) * 100) / 100);
  });

  it("posting: refuses stale figures; posts one balanced journal; books stay balanced", async () => {
    const biz = A.ctx.business.id;
    // attendance changed after calculation → must recalculate first
    await saveAttendance(A.ctx.svc, { date: D("2026-09-20"), rows: [{ employeeId: e2, status: "PRESENT", overtimeHours: 0, lateMinutes: 0, note: null }] });
    await expect(postPayrollRun(A.ctx.svc, septRun)).rejects.toThrow(/হাজিরা পরিবর্তিত/);
    await calculatePayrollRun(A.ctx.svc, { year: 2026, month: 9, kind: "REGULAR", postingDate: D("2026-09-30") });
    const posted = await postPayrollRun(A.ctx.svc, septRun);
    expect(posted.status).toBe("POSTED");
    const v = await prisma.voucher.findUniqueOrThrow({ where: { id: posted.voucherId! }, include: { entries: true } });
    expect(v).toMatchObject({ type: "JOURNAL", sourceKey: `payroll:run:${septRun}` });
    const dr = v.entries.reduce((s, e) => s + num(e.debit), 0);
    const cr = v.entries.reduce((s, e) => s + num(e.credit), 0);
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
    const slips = await prisma.payslip.findMany({ where: { runId: septRun }, include: { lines: true } });
    const gross = slips.reduce((s, x) => s + num(x.gross), 0);
    const net = slips.reduce((s, x) => s + num(x.net), 0);
    // salary expense: Dr gross, Cr absence deduction · payable: Cr net · advance: Cr installment · fine → other income
    const sal = v.entries.filter((e) => e.accountId === acc.SALARY);
    expect(Math.round(sal.reduce((s, e) => s + num(e.debit), 0) * 100) / 100).toBe(Math.round(gross * 100) / 100);
    expect(sal.reduce((s, e) => s + num(e.credit), 0)).toBe(2692.31);
    expect(num(v.entries.find((e) => e.accountId === acc.PAYABLE)!.credit)).toBe(Math.round(net * 100) / 100);
    expect(num(v.entries.find((e) => e.accountId === acc.ADVANCE)!.credit)).toBe(2000);
    expect(num(v.entries.find((e) => e.accountId === acc.OTHER_INCOME)!.credit)).toBe(300);
    expect(await balance(biz, acc.PAYABLE)).toBe(-Math.round(net * 100) / 100);
    expect(await balance(biz, acc.ADVANCE)).toBe(3000);
    expect((await trialBalance(biz, {})).balanced).toBe(true);
    expect((await advanceOutstanding(prisma, biz, [e1]))[0].outstanding).toBe(3000);
    expect(await payableReconciliation(biz)).toMatchObject({ difference: 0 });
  });

  it("finalized payroll is protected: no recalculation, adjustment, attendance change, or voucher edit/delete", async () => {
    await expect(calculatePayrollRun(A.ctx.svc, { year: 2026, month: 9, kind: "REGULAR", postingDate: D("2026-09-30") })).rejects.toThrow(/দুবার/);
    const slip = await prisma.payslip.findFirstOrThrow({ where: { runId: septRun } });
    await expect(adjustPayslip(A.ctx.svc, slip.id, { extraOvertimeHours: 0, manual: [] })).rejects.toThrow(/চূড়ান্ত/);
    await expect(saveAttendance(A.ctx.svc, { date: D("2026-09-21"), rows: [{ employeeId: e1, status: "ABSENT", overtimeHours: 0, lateMinutes: 0, note: null }] })).rejects.toThrow(/চূড়ান্ত/);
    await expect(deletePayrollRun(A.ctx.svc, septRun)).rejects.toThrow();
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: septRun } });
    await expect(deleteVoucher(A.ctx.svc, run.voucherId!)).rejects.toThrow(/বেতন \(Payroll\)/);
    await expect(saveJournalVoucher(A.ctx.svc, { date: D("2026-09-30"), reference: null, narration: null, lines: [{ accountId: acc.SALARY, debit: 1, credit: 0, narration: null }, { accountId: acc.CASH, debit: 0, credit: 1, narration: null }] }, run.voucherId!)).rejects.toThrow(/বেতন \(Payroll\)/);
    // the database itself refuses a second payslip for the same employee and month
    await expect(prisma.payslip.create({ data: { ...slip, id: undefined, runId: septRun, lines: undefined } as never })).rejects.toMatchObject({ code: "P2002" });
  });

  it("salary payment: partial, full, over-payment refused; payable per employee; reopen only when nothing is paid", async () => {
    const biz = A.ctx.business.id;
    const s1 = await prisma.payslip.findFirstOrThrow({ where: { runId: septRun, employeeId: e1 } });
    const net1 = num(s1.net);
    const p1 = await paySalaries(A.ctx.svc, { date: D("2026-10-01"), cashAccountId: acc.CASH, reference: null, narration: null, items: [{ employeeId: e1, amount: 10000 }] });
    expect(p1).toMatchObject({ type: "PAYMENT" });
    expect(num((await prisma.payslip.findUniqueOrThrow({ where: { id: s1.id } })).paidAmount)).toBe(10000);
    expect((await getPayslipDetail(biz, s1.id))!.status).toBe("PARTIAL");
    await expect(paySalaries(A.ctx.svc, { date: D("2026-10-02"), cashAccountId: acc.CASH, reference: null, narration: null, items: [{ employeeId: e1, amount: net1 }] })).rejects.toThrow(/বেশি/);
    await expect(reopenPayrollRun(A.ctx.svc, septRun)).rejects.toThrow(/পরিশোধ/);
    const rest = Math.round((net1 - 10000) * 100) / 100;
    await paySalaries(A.ctx.svc, { date: D("2026-10-02"), cashAccountId: acc.CASH, reference: "BANK-1", narration: null, items: [{ employeeId: e1, amount: rest }] });
    expect((await getPayslipDetail(biz, s1.id))!.status).toBe("PAID");
    expect((await unpaidPayslips(prisma, biz, [e1])).length).toBe(0);
    expect(await payableReconciliation(biz)).toMatchObject({ difference: 0 });
    // the payment can be cancelled (books and payslip restored)
    const before = await balance(biz, acc.PAYABLE);
    await deleteSalaryPayment(A.ctx.svc, p1.id);
    expect(await balance(biz, acc.PAYABLE)).toBe(Math.round((before - 10000) * 100) / 100);
    expect((await getPayslipDetail(biz, s1.id))!.status).toBe("PARTIAL");
    expect((await trialBalance(biz, {})).balanced).toBe(true);
  });

  it("payslip: company, employee, month, basic, allowances, overtime, gross, deductions, net and payment status", async () => {
    const s1 = await prisma.payslip.findFirstOrThrow({ where: { runId: septRun, employeeId: e1 } });
    const d = (await getPayslipDetail(A.ctx.business.id, s1.id))!;
    expect(d.business.name).toBe("পেরোল টেস্ট স্টোর");
    expect(d.payslip).toMatchObject({ employeeName: "রহিম উদ্দিন", designation: "বিক্রয়কর্মী", departmentName: "বিক্রয়", year: 2026, month: 9 });
    expect(d.earnings.map((l) => l.name)).toEqual(expect.arrayContaining(["মূল বেতন", "বাড়ি ভাড়া ভাতা", "চিকিৎসা ভাতা", "যাতায়াত ভাতা"]));
    expect(d.earnings.some((l) => l.name.startsWith("ওভারটাইম"))).toBe(true);
    expect(d.deductions.map((l) => l.name)).toEqual(expect.arrayContaining(["অগ্রিম সমন্বয়", "জরিমানা"]));
    expect(d.gross - d.totalDeductions).toBeCloseTo(d.net, 2);
    expect(d.status).toBe("PARTIAL");
    expect(await getPayslipDetail(B.ctx.business.id, s1.id)).toBeNull(); // another business
  });

  it("next month recovers the next advance installment; a recovered advance can not be deleted; festival bonus run", async () => {
    const biz = A.ctx.business.id;
    const oct = await calculatePayrollRun(A.ctx.svc, { year: 2026, month: 10, kind: "REGULAR", postingDate: D("2026-10-31") });
    const s = await prisma.payslip.findFirstOrThrow({ where: { runId: oct.run.id, employeeId: e1 }, include: { lines: true } });
    expect(num(s.lines.find((l) => l.advanceId)!.amount)).toBe(2000);
    const adv = await prisma.employeeAdvance.findFirstOrThrow({ where: { employeeId: e1 } });
    await expect(deleteAdvance(A.ctx.svc, adv.id)).rejects.toThrow(/কাটা/);
    // e2 is now a full month
    expect(num((await prisma.payslip.findFirstOrThrow({ where: { runId: oct.run.id, employeeId: e2 } })).gross)).toBe(21000);
    // festival bonus: a separate run kind for the same month, 100% of basic
    const bonus = await calculatePayrollRun(A.ctx.svc, { year: 2026, month: 10, kind: "BONUS", postingDate: D("2026-10-15") });
    const b1 = await prisma.payslip.findFirstOrThrow({ where: { runId: bonus.run.id, employeeId: e1 }, include: { lines: true } });
    expect(b1.lines.map((l) => [l.name, num(l.amount)])).toEqual([["উৎসব ভাতা", 20000]]);
    await postPayrollRun(A.ctx.svc, bonus.run.id);
    expect((await trialBalance(biz, {})).balanced).toBe(true);
  });

  it("period lock: nothing is posted, paid or reopened in a closed period", async () => {
    const biz = A.ctx.business.id;
    const oct = await prisma.payrollRun.findFirstOrThrow({ where: { businessId: biz, year: 2026, month: 10, kind: "REGULAR" } });
    await prisma.business.update({ where: { id: biz }, data: { lockDate: D("2026-10-31") } });
    try {
      await expect(postPayrollRun(A.ctx.svc, oct.id)).rejects.toThrow(/লক/);
      await expect(reopenPayrollRun(A.ctx.svc, septRun)).rejects.toThrow(/লক/);
      await expect(paySalaries(A.ctx.svc, { date: D("2026-10-05"), cashAccountId: acc.CASH, reference: null, narration: null, items: [{ employeeId: e2, amount: 1 }] })).rejects.toThrow(/লক/);
    } finally {
      await prisma.business.update({ where: { id: biz }, data: { lockDate: null } });
    }
  });

  it("components: ledger rules for activation (PF employer needs an expense and a liability ledger)", async () => {
    const biz = A.ctx.business.id;
    const pf = await prisma.payComponent.findFirstOrThrow({ where: { businessId: biz, systemKey: "PF_EMPLOYER" } });
    const base = { name: pf.name, kind: "EMPLOYER" as const, calcType: "PERCENT_OF_BASIC" as const, defaultValue: 10, ruleKey: null, appliesTo: "REGULAR" as const, taxable: false, isActive: true, sortOrder: 170 };
    await expect(savePayComponent(A.ctx.svc, { ...base, accountId: acc.SALARY, liabilityAccountId: null }, pf.id)).rejects.toThrow(/দায়ের লেজার/);
    await expect(savePayComponent(A.ctx.svc, { ...base, accountId: acc.CASH, liabilityAccountId: acc.PAYABLE }, pf.id)).rejects.toThrow();
    await expect(savePayComponent(A.ctx.svc, { ...base, accountId: acc.PAYABLE, liabilityAccountId: acc.PAYABLE }, pf.id)).rejects.toThrow(/খরচের/);
    const ok = await savePayComponent(A.ctx.svc, { ...base, accountId: acc.SALARY, liabilityAccountId: acc.PAYABLE }, pf.id);
    expect(ok.isActive).toBe(true);
    await expect(savePayComponent(A.ctx.svc, { ...base, name: "মূল বেতন", kind: "EARNING", calcType: "FIXED", accountId: acc.SALARY, liabilityAccountId: null, isActive: false }, comp.BASIC)).rejects.toThrow(/স্বয়ংক্রিয়/);
    // switch it off again so later months are unaffected
    await savePayComponent(A.ctx.svc, { ...base, accountId: acc.SALARY, liabilityAccountId: acc.PAYABLE, isActive: false }, pf.id);
  });

  it("permissions: attendance clerk may mark attendance only; viewer may not process or pay", async () => {
    const biz = A.ctx.business.id;
    req.cookies = await staff(biz, ["payroll:attendance"]);
    const att = await saveAttendanceAction(null, payload({ date: "2026-11-02", rows: [{ employeeId: e2, status: "ABSENT", overtimeHours: 0, lateMinutes: 0, note: null }] }));
    expect(att?.ok).toBe(true);
    expect((await calculatePayrollAction(null, form({ period: "2026-11", kind: "REGULAR", postingDate: "2026-11-30" })))?.ok).toBe(false);
    req.cookies = await staff(biz, ["payroll:view"]);
    expect((await saveAttendanceAction(null, payload({ date: "2026-11-03", rows: [] })))?.ok).toBe(false);
    const oct = await prisma.payrollRun.findFirstOrThrow({ where: { businessId: biz, year: 2026, month: 10, kind: "REGULAR" } });
    expect((await postPayrollAction(oct.id, null, new FormData()))?.ok).toBe(false);
    expect((await paySalariesAction(null, payload({ date: "2026-10-05", cashAccountId: acc.CASH, items: [{ employeeId: e2, amount: 1 }] })))?.ok).toBe(false);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: oct.id } })).status).toBe("DRAFT");
  });

  it("isolation: another business can not see, post, pay or reopen this payroll", async () => {
    await expect(postPayrollRun(B.ctx.svc, septRun)).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(reopenPayrollRun(B.ctx.svc, septRun)).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(paySalaries(B.ctx.svc, { date: D("2026-10-05"), cashAccountId: acc.CASH, reference: null, narration: null, items: [{ employeeId: e1, amount: 1 }] })).rejects.toThrow();
    await expect(giveAdvance(B.ctx.svc, { employeeId: e1, kind: "ADVANCE", date: D("2026-10-05"), amount: 1, installment: 1, cashAccountId: acc.CASH, note: null })).rejects.toThrow(/কর্মচারী/);
    expect(await prisma.payrollRun.count({ where: { businessId: B.ctx.business.id } })).toBe(0);
  });

  it("actions write an audit trail", async () => {
    const biz = A.ctx.business.id;
    const r = await calculatePayrollAction(null, form({ period: "2026-11", kind: "REGULAR", postingDate: "2026-11-30" })).catch((e) => e);
    expect((r as { url?: string }).url).toMatch(/^\/payroll\/runs\//);
    expect(await prisma.auditLog.count({ where: { businessId: biz, entity: "PayrollRun" } })).toBeGreaterThanOrEqual(1);
  });

  it("reports: monthly, history, payable (reconciled), payments, department, allowances/deductions", async () => {
    const ctx = (await getContext())!;
    const run = async (slug: string, p: Record<string, string>) => (await findReport(slug)!.run(ctx, p));
    const monthly = await run("payroll-monthly", { period: "2026-09" });
    const total = monthly.rows.find((r) => r.kind === "total")!;
    const slips = await prisma.payslip.findMany({ where: { runId: septRun } });
    expect(total.cells.net).toBe(Math.round(slips.reduce((s, x) => s + num(x.net), 0) * 100) / 100);
    expect(monthly.rows.filter((r) => r.kind !== "total").length).toBe(2);
    expect((await run("payroll-monthly", { period: "2026-09", employeeId: e2 })).rows.filter((r) => r.kind !== "total").length).toBe(1);
    expect((await run("payroll-monthly", { period: "2026-09", departmentId: dept })).rows.filter((r) => r.kind !== "total").length).toBe(1); // only e1 is in the department
    expect((await run("payroll-monthly", { period: "2026-11" })).rows.length).toBe(0); // November is still a draft
    const history = await run("payroll-employee-history", { employeeId: e1, from: "2026-01-01", to: "2026-12-31" });
    expect(history.rows.filter((r) => r.kind !== "total").map((r) => r.cells.month)).toEqual(["সেপ্টেম্বর 2026", "অক্টোবর 2026"]); // Sept regular + Oct bonus (Oct regular is a draft)
    const payable = await run("payroll-payable", {});
    expect(payable.summary!.find((x) => x.label === "পার্থক্য")!.value).toContain("০.০০");
    const pays = await run("payroll-payments", { from: "2026-10-01", to: "2026-10-31" });
    expect(pays.rows.filter((r) => r.kind !== "total").length).toBeGreaterThanOrEqual(1);
    const dep = await run("payroll-department", { period: "2026-09" });
    expect(dep.rows.map((r) => r.cells.department)).toEqual(expect.arrayContaining(["বিক্রয়", "বিভাগহীন", "মোট"]));
    const comps = await run("payroll-components", { period: "2026-09" });
    expect(comps.rows.filter((r) => r.kind === "group").map((r) => r.cells.component)).toEqual(["আয় / ভাতা", "কর্তন"]);
    expect(comps.rows.some((r) => r.cells.component === "বাড়ি ভাড়া ভাতা")).toBe(true);
  });

  it("employee search (picker): name, ID, mobile; another business never returned", async () => {
    const biz = A.ctx.business.id;
    const one = await prisma.employee.findUniqueOrThrow({ where: { id: e1 } });
    expect((await searchEmployees(biz, "রহিম")).map((e) => e.id)).toEqual([e1]);
    expect((await searchEmployees(biz, one.code.toLowerCase())).map((e) => e.id)[0]).toBe(e1);
    expect((await searchEmployees(biz, "অন্য")).length).toBe(0);
    expect(await searchEmployees(B.ctx.business.id, "", { ids: [e1] })).toEqual([]);
  });

  it("backup → restore keeps payroll: employees, payslips, payables and books identical", async () => {
    const biz = A.ctx.business.id;
    const file = JSON.parse(JSON.stringify(await exportBusiness(biz)));
    expect(file.version).toBe(4);
    const report = validateBackup(file);
    expect(report.ok).toBe(true);
    expect(report.stats["payroll.payslips"]).toBeGreaterThanOrEqual(4);
    const { businessId } = await restoreBackup(file, A.ctx.user.id);
    const [a, b] = await Promise.all([trialBalance(biz, {}), trialBalance(businessId, {})]);
    expect(b.totals).toEqual(a.totals);
    expect(await prisma.employee.count({ where: { businessId } })).toBe(await prisma.employee.count({ where: { businessId: biz } }));
    expect(await prisma.payslip.count({ where: { businessId } })).toBe(await prisma.payslip.count({ where: { businessId: biz } }));
    expect((await payableReconciliation(businessId)).difference).toBe(0);
    // posted run → its journal voucher (source key remapped to the restored run)
    const restored = await prisma.payrollRun.findFirstOrThrow({ where: { businessId, year: 2026, month: 9, kind: "REGULAR" }, include: { voucher: true } });
    expect(restored.voucher!.sourceKey).toBe(`payroll:run:${restored.id}`);
    expect((await advanceOutstanding(prisma, businessId))[0].outstanding).toBe((await advanceOutstanding(prisma, biz))[0].outstanding);
    // a v3 file (no payroll) still validates
    const v3 = JSON.parse(JSON.stringify(file));
    v3.version = 3;
    delete v3.data.payroll;
    expect(validateBackup(v3).errors.join(" ")).toMatch(/চেকসাম/); // content changed, so only the checksum complains
  });
});
