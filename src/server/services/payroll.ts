// PayrollService — employees, salary structures, attendance, monthly payroll, salary payments and
// advances. It never writes the general ledger itself: posting a run, paying salaries and giving an
// advance each create a voucher through the accounting engine (writeEntries → Σ debit = Σ credit,
// period lock, voucher numbering). Those vouchers carry sourceKey "payroll:…" and can only be
// changed from here (the voucher screens refuse them).
import { randomUUID } from "node:crypto";
import type { AttendanceStatus, PayCalcType, PayComponentKind, PayrollKind, Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { UserError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import {
  calculatePayslip, employedFraction, monthEnd, monthStart, PAY_RULES, payrollJournalLines, PayrollCalcError, PAYROLL_KIND_LABELS, periodLabel,
  summarizeAttendance, workingDaysInMonth, type AdvanceDue, type ComponentRef, type ManualLine, type PayrollSettingsInput, type StructureLine,
} from "@/lib/payroll";
import type { EmployeeInput, PayComponentInput, PayrollSettingsFormInput } from "@/lib/validation";
import { assertAccounts, assertNotLocked, nextVoucherNo, writeEntries, type Ctx, type Tx } from "./accounting";

const TX = { timeout: 120_000, maxWait: 10_000 };

/** Components calculated by the engine (never assigned by hand on a salary structure). */
export const AUTO_COMPONENTS = ["BASIC", "OVERTIME", "ABSENCE", "ADVANCE", "LOAN"] as const;
const isAuto = (key: string | null | undefined) => (AUTO_COMPONENTS as readonly string[]).includes(key ?? "");

/** Business-wide serialisation of payroll writes (calculate / post / pay) — no double runs or payments. */
async function lockPayroll(tx: Tx, businessId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${businessId}`}))`;
}

// ───────────────────────── setup (idempotent) ─────────────────────────

type AccountSeed = { key: string; name: string; code: string; group: string; system: boolean };
const ACCOUNT_SEEDS: AccountSeed[] = [
  { key: "SALARY", name: "কর্মচারীর বেতন", code: "5202", group: "INDIRECT_EXPENSES", system: false },
  { key: "OTHER_INCOME", name: "বিবিধ আয়", code: "4109", group: "INDIRECT_INCOME", system: false },
  { key: "SALARY_PAYABLE", name: "বেতন প্রদেয়", code: "2201", group: "CURRENT_LIABILITIES", system: true },
  { key: "EMPLOYEE_ADVANCE", name: "কর্মচারী অগ্রিম ও ঋণ", code: "1402", group: "CURRENT_ASSETS", system: true },
];
type ComponentSeed = { key: string; name: string; kind: PayComponentKind; calc?: PayCalcType; value?: number; account: string | null; appliesTo?: PayrollKind; active?: boolean; sort: number };
const COMPONENT_SEEDS: ComponentSeed[] = [
  { key: "BASIC", name: "মূল বেতন", kind: "EARNING", account: "SALARY", sort: 0 },
  { key: "HOUSE_RENT", name: "বাড়ি ভাড়া ভাতা", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: 50, account: "SALARY", sort: 10 },
  { key: "MEDICAL", name: "চিকিৎসা ভাতা", kind: "EARNING", account: "SALARY", sort: 20 },
  { key: "TRANSPORT", name: "যাতায়াত ভাতা", kind: "EARNING", account: "SALARY", sort: 30 },
  { key: "FOOD", name: "খাদ্য ভাতা", kind: "EARNING", account: "SALARY", sort: 40 },
  { key: "OTHER_ALLOWANCE", name: "অন্যান্য ভাতা", kind: "EARNING", account: "SALARY", sort: 50 },
  { key: "OVERTIME", name: "ওভারটাইম", kind: "EARNING", account: "SALARY", sort: 60 },
  { key: "FESTIVAL_BONUS", name: "উৎসব ভাতা", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: 100, account: "SALARY", appliesTo: "BONUS", sort: 70 },
  { key: "ABSENCE", name: "অনুপস্থিতি কর্তন", kind: "DEDUCTION", account: "SALARY", sort: 100 },
  { key: "ADVANCE", name: "অগ্রিম সমন্বয়", kind: "DEDUCTION", account: "EMPLOYEE_ADVANCE", sort: 110 },
  { key: "LOAN", name: "ঋণের কিস্তি", kind: "DEDUCTION", account: "EMPLOYEE_ADVANCE", sort: 120 },
  { key: "FINE", name: "জরিমানা", kind: "DEDUCTION", account: "OTHER_INCOME", sort: 130 },
  { key: "OTHER_DEDUCTION", name: "অন্যান্য কর্তন", kind: "DEDUCTION", account: "SALARY", sort: 140 },
  // Bangladesh statutory items — need their ledgers chosen (and rates verified) before activation
  { key: "INCOME_TAX", name: "আয়কর (উৎসে কর)", kind: "DEDUCTION", account: null, active: false, sort: 150 },
  { key: "PF_EMPLOYEE", name: "ভবিষ্য তহবিল (কর্মচারীর অংশ)", kind: "DEDUCTION", calc: "PERCENT_OF_BASIC", value: 10, account: null, active: false, sort: 160 },
  { key: "PF_EMPLOYER", name: "ভবিষ্য তহবিল (প্রতিষ্ঠানের অংশ)", kind: "EMPLOYER", calc: "PERCENT_OF_BASIC", value: 10, account: null, active: false, sort: 170 },
  { key: "GRATUITY", name: "গ্র্যাচুইটি প্রভিশন", kind: "EMPLOYER", calc: "PERCENT_OF_BASIC", value: 0, account: null, active: false, sort: 180 },
];

async function ensureAccount(tx: Tx, businessId: string, seed: AccountSeed) {
  const found = await tx.account.findFirst({ where: { businessId, systemKey: seed.key }, select: { id: true } });
  if (found) return found.id;
  const group =
    (await tx.accountGroup.findFirst({ where: { businessId, systemKey: seed.group } })) ??
    (await tx.accountGroup.findFirstOrThrow({ where: { businessId, nature: seed.group.includes("EXPENSE") ? "EXPENSE" : seed.group.includes("INCOME") ? "INCOME" : seed.group.includes("LIABIL") ? "LIABILITY" : "ASSET" } }));
  const codeTaken = await tx.account.findFirst({ where: { businessId, code: seed.code }, select: { id: true } });
  const nameTaken = await tx.account.findFirst({ where: { businessId, name: seed.name }, select: { id: true } });
  const created = await tx.account.create({
    data: { businessId, groupId: group.id, nature: group.nature, name: nameTaken ? `${seed.name} (বেতন)` : seed.name, code: codeTaken ? null : seed.code, systemKey: seed.key, isSystem: seed.system },
  });
  return created.id;
}

/**
 * Makes sure a business has payroll settings, its ledgers (Salary Payable, Employee Advance …) and the
 * standard pay components. Safe to call any time; existing businesses are upgraded on first use.
 */
export async function ensurePayrollSetup(businessId: string) {
  const done = await prisma.payrollSettings.findUnique({ where: { businessId }, select: { businessId: true } });
  const count = done ? await prisma.payComponent.count({ where: { businessId, systemKey: { in: COMPONENT_SEEDS.map((c) => c.key) } } }) : 0;
  if (done && count === COMPONENT_SEEDS.length) return;
  await prisma.$transaction(async (tx) => {
    await lockPayroll(tx, businessId);
    const acc: Record<string, string> = {};
    for (const s of ACCOUNT_SEEDS) acc[s.key] = await ensureAccount(tx, businessId, s);
    await tx.payrollSettings.upsert({
      where: { businessId },
      create: { businessId, salaryPayableAccountId: acc.SALARY_PAYABLE, advanceAccountId: acc.EMPLOYEE_ADVANCE },
      update: {},
    });
    for (const c of COMPONENT_SEEDS) {
      if (await tx.payComponent.findFirst({ where: { businessId, systemKey: c.key }, select: { id: true } })) continue;
      const nameTaken = await tx.payComponent.findFirst({ where: { businessId, name: c.name }, select: { id: true } });
      await tx.payComponent.create({
        data: {
          businessId, systemKey: c.key, name: nameTaken ? `${c.name} (সিস্টেম)` : c.name, kind: c.kind, calcType: c.calc ?? "FIXED", defaultValue: c.value ?? 0,
          appliesTo: c.appliesTo ?? "REGULAR", accountId: c.account ? acc[c.account] : null, isActive: c.active ?? true, sortOrder: c.sort,
        },
      });
    }
  }, TX);
}

export interface PayrollConfig {
  settings: PayrollSettingsInput;
  payableAccountId: string;
  advanceAccountId: string;
  system: Record<(typeof AUTO_COMPONENTS)[number], ComponentRef & { componentId: string }>;
}

export async function payrollConfig(tx: Tx | typeof prisma, businessId: string): Promise<PayrollConfig> {
  if (tx === prisma) await ensurePayrollSetup(businessId); // reads outside a transaction (pages, reports) set up on first use
  const s = await tx.payrollSettings.findUnique({ where: { businessId } });
  if (!s) throw new UserError("বেতন মডিউল প্রস্তুত নয় — বেতন পাতাটি একবার খুলুন");
  const sys = await tx.payComponent.findMany({ where: { businessId, systemKey: { in: [...AUTO_COMPONENTS] } } });
  const system = Object.fromEntries(sys.map((c) => [c.systemKey, { componentId: c.id, name: c.name, accountId: c.accountId }])) as PayrollConfig["system"];
  for (const k of AUTO_COMPONENTS) if (!system[k]) throw new UserError("বেতন মডিউল প্রস্তুত নয় — বেতন পাতাটি একবার খুলুন");
  if (!s.salaryPayableAccountId || !s.advanceAccountId) throw new UserError("বেতন সেটিং-এ \"বেতন প্রদেয়\" ও \"কর্মচারী অগ্রিম\" লেজার নির্ধারণ করুন");
  return {
    settings: {
      workingDaysMode: s.workingDaysMode, fixedWorkingDays: s.fixedWorkingDays, weeklyOffDays: s.weeklyOffDays, hoursPerDay: num(s.hoursPerDay),
      overtimeMultiplier: num(s.overtimeMultiplier), lateDaysPerAbsence: s.lateDaysPerAbsence, absenceBasis: s.absenceBasis,
    },
    payableAccountId: s.salaryPayableAccountId,
    advanceAccountId: s.advanceAccountId,
    system,
  };
}

export async function savePayrollSettings(ctx: Ctx, input: PayrollSettingsFormInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.payrollSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId } });
    const payable = input.salaryPayableAccountId ?? current.salaryPayableAccountId;
    const advance = input.advanceAccountId ?? current.advanceAccountId;
    const accs = await assertAccounts(tx, ctx.businessId, [payable, advance].filter(Boolean) as string[]);
    for (const a of accs.values()) if (a.kind !== "GENERAL") throw new UserError(`"${a.name}" এখানে ব্যবহার করা যাবে না (নগদ/ব্যাংক/পার্টি হিসাব নয়)`);
    // unpaid salary sits on the current payable ledger: switching would split the balance
    if (payable && payable !== current.salaryPayableAccountId && (await unpaidPayslips(tx, ctx.businessId)).length) {
      throw new UserError("অপরিশোধিত বেতন থাকা অবস্থায় \"বেতন প্রদেয়\" লেজার পরিবর্তন করা যাবে না");
    }
    if (advance && advance !== current.advanceAccountId && (await advanceOutstanding(tx, ctx.businessId)).some((a) => a.outstanding > 0.004)) {
      throw new UserError("অনাদায়ী অগ্রিম/ঋণ থাকা অবস্থায় \"কর্মচারী অগ্রিম\" লেজার পরিবর্তন করা যাবে না");
    }
    return tx.payrollSettings.update({
      where: { businessId: ctx.businessId },
      data: {
        workingDaysMode: input.workingDaysMode, fixedWorkingDays: input.fixedWorkingDays, weeklyOffDays: [...new Set(input.weeklyOffDays)].sort(),
        hoursPerDay: input.hoursPerDay, overtimeMultiplier: input.overtimeMultiplier, lateDaysPerAbsence: input.lateDaysPerAbsence, absenceBasis: input.absenceBasis,
        salaryPayableAccountId: payable, advanceAccountId: advance,
      },
    });
  }, TX);
}

// ───────────────────────── departments ─────────────────────────

export async function saveDepartment(ctx: Ctx, name: string, id?: string) {
  if (id) {
    const d = await prisma.department.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!d) throw new UserError("বিভাগ পাওয়া যায়নি");
    return prisma.department.update({ where: { id }, data: { name } });
  }
  return prisma.department.create({ data: { businessId: ctx.businessId, name } });
}

export async function deleteDepartment(ctx: Ctx, id: string) {
  const d = await prisma.department.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { employees: true } } } });
  if (!d) throw new UserError("বিভাগ পাওয়া যায়নি");
  if (d._count.employees > 0) throw new UserError("এই বিভাগে কর্মচারী আছে — আগে তাদের অন্য বিভাগে নিন");
  await prisma.department.delete({ where: { id } });
  return d;
}

// ───────────────────────── pay components ─────────────────────────

async function assertComponentAccounts(tx: Tx, businessId: string, kind: PayComponentKind, accountId: string | null, liabilityAccountId: string | null) {
  const ids = [accountId, liabilityAccountId].filter(Boolean) as string[];
  if (!ids.length) return;
  const rows = await tx.account.findMany({ where: { businessId, id: { in: ids } }, select: { id: true, name: true, kind: true, nature: true } });
  if (rows.length !== new Set(ids).size) throw new UserError("লেজার পাওয়া যায়নি");
  for (const r of rows) if (r.kind !== "GENERAL") throw new UserError(`"${r.name}" বেতনের উপাদানে ব্যবহার করা যাবে না (নগদ/ব্যাংক/পার্টি হিসাব)`);
  const main = rows.find((r) => r.id === accountId);
  if (main && kind !== "DEDUCTION" && main.nature !== "EXPENSE") throw new UserError(`"${main.name}" খরচের (ব্যয়) লেজার নয় — আয় ও প্রতিষ্ঠানের অবদানের জন্য খরচের লেজার দিন`);
  const liab = rows.find((r) => r.id === liabilityAccountId);
  if (liab && liab.nature !== "LIABILITY") throw new UserError(`"${liab.name}" দায়ের লেজার নয়`);
}

export async function savePayComponent(ctx: Ctx, input: PayComponentInput, id?: string) {
  return prisma.$transaction(async (tx) => {
    const existing = id ? await tx.payComponent.findFirst({ where: { id, businessId: ctx.businessId } }) : null;
    if (id && !existing) throw new UserError("উপাদান পাওয়া যায়নি");
    const auto = isAuto(existing?.systemKey);
    const kind = auto ? existing!.kind : input.kind;
    const calcType = auto ? existing!.calcType : input.calcType;
    const liabilityAccountId = kind === "EMPLOYER" ? input.liabilityAccountId : null;
    if (auto && !input.isActive) throw new UserError("স্বয়ংক্রিয় উপাদান নিষ্ক্রিয় করা যাবে না");
    if (calcType === "RULE" && (!input.ruleKey || !PAY_RULES[input.ruleKey])) throw new UserError("নিবন্ধিত নিয়ম নির্বাচন করুন");
    if (input.isActive && !input.accountId) throw new UserError("সক্রিয় উপাদানের জন্য লেজার নির্বাচন করুন", { accountId: ["লেজার নির্বাচন করুন"] });
    if (input.isActive && kind === "EMPLOYER" && !liabilityAccountId) throw new UserError("প্রতিষ্ঠানের অবদানের জন্য দায়ের লেজার নির্বাচন করুন", { liabilityAccountId: ["দায়ের লেজার নির্বাচন করুন"] });
    if (existing && existing.kind !== kind) {
      const used = await tx.employeeSalaryComponent.count({ where: { componentId: existing.id } }) + (await tx.payslipLine.count({ where: { componentId: existing.id } }));
      if (used) throw new UserError("ব্যবহৃত উপাদানের ধরন পরিবর্তন করা যাবে না — নতুন উপাদান তৈরি করুন");
    }
    await assertComponentAccounts(tx, ctx.businessId, kind, input.accountId, liabilityAccountId);
    const data = {
      name: input.name, kind, calcType, defaultValue: input.defaultValue, ruleKey: calcType === "RULE" ? input.ruleKey : null,
      appliesTo: auto ? existing!.appliesTo : input.appliesTo, accountId: input.accountId, liabilityAccountId, taxable: input.taxable,
      isActive: input.isActive, sortOrder: input.sortOrder,
    };
    return existing ? tx.payComponent.update({ where: { id: existing.id }, data }) : tx.payComponent.create({ data: { ...data, businessId: ctx.businessId } });
  }, TX);
}

export async function deletePayComponent(ctx: Ctx, id: string) {
  const c = await prisma.payComponent.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { employeeLines: true, payslipLines: true } } } });
  if (!c) throw new UserError("উপাদান পাওয়া যায়নি");
  if (c.systemKey) throw new UserError("সিস্টেমের উপাদান মুছা যাবে না — প্রয়োজনে নিষ্ক্রিয় করুন");
  if (c._count.employeeLines || c._count.payslipLines) throw new UserError("উপাদানটি ব্যবহৃত হয়েছে — মুছার বদলে নিষ্ক্রিয় করুন");
  await prisma.payComponent.delete({ where: { id } });
  return c;
}

// ───────────────────────── employees ─────────────────────────

async function nextEmployeeCode(tx: Tx, businessId: string) {
  for (;;) {
    const c = await tx.counter.upsert({ where: { businessId_key: { businessId, key: "EMPLOYEE" } }, create: { businessId, key: "EMPLOYEE", value: 1 }, update: { value: { increment: 1 } } });
    const code = `EMP-${String(c.value).padStart(4, "0")}`;
    if (!(await tx.employee.findFirst({ where: { businessId, code }, select: { id: true } }))) return code;
  }
}

const structureSnapshot = (basic: number, lines: { name: string; kind: string; calcType: string; value: number }[]) => ({ basic, lines });

export async function saveEmployee(ctx: Ctx, input: EmployeeInput, id?: string) {
  return prisma.$transaction(async (tx) => {
    const existing = id ? await tx.employee.findFirst({ where: { id, businessId: ctx.businessId }, include: { components: { include: { component: true } } } }) : null;
    if (id && !existing) throw new UserError("কর্মচারী পাওয়া যায়নি");
    if (input.departmentId && !(await tx.department.findFirst({ where: { id: input.departmentId, businessId: ctx.businessId }, select: { id: true } }))) throw new UserError("বিভাগ পাওয়া যায়নি");
    const compIds = input.components.map((c) => c.componentId);
    const comps = compIds.length ? await tx.payComponent.findMany({ where: { businessId: ctx.businessId, id: { in: compIds } } }) : [];
    if (comps.length !== new Set(compIds).size) throw new UserError("বেতন উপাদান পাওয়া যায়নি");
    const byId = new Map(comps.map((c) => [c.id, c]));
    for (const line of input.components) {
      const c = byId.get(line.componentId)!;
      if (isAuto(c.systemKey)) throw new UserError(`"${c.name}" স্বয়ংক্রিয়ভাবে হিসাব হয় — কাঠামোতে যোগ করা যাবে না`);
      if (!c.isActive) throw new UserError(`"${c.name}" নিষ্ক্রিয় উপাদান`);
      if (c.kind === "EARNING" && line.calcType === "PERCENT_OF_GROSS") throw new UserError(`"${c.name}": আয়ের উপাদান মোট বেতনের % হতে পারে না`);
      if ((line.calcType === "RULE") !== (c.calcType === "RULE")) throw new UserError(`"${c.name}": নিয়মভিত্তিক উপাদানের হিসাবের ধরন পরিবর্তন করা যাবে না`);
    }
    const data = {
      name: input.name, mobile: input.mobile, email: input.email, address: input.address, nid: input.nid, tin: input.tin, departmentId: input.departmentId,
      designation: input.designation, joiningDate: input.joiningDate, exitDate: input.exitDate, status: input.status, basicSalary: input.basicSalary,
      overtimeEligible: input.overtimeEligible, overtimeRate: input.overtimeRate, paymentMethod: input.paymentMethod, bankName: input.bankName,
      bankAccountNo: input.bankAccountNo, notes: input.notes,
    };
    const employee = existing
      ? await tx.employee.update({ where: { id: existing.id }, data: { ...data, ...(input.code ? { code: input.code } : {}) } })
      : await tx.employee.create({ data: { ...data, businessId: ctx.businessId, code: input.code ?? (await nextEmployeeCode(tx, ctx.businessId)) } });

    // salary structure: replace lines; keep a revision whenever basic or structure changed
    const before = existing
      ? JSON.stringify(structureSnapshot(num(existing.basicSalary), existing.components.map((l) => ({ name: l.component.name, kind: l.component.kind, calcType: l.calcType, value: num(l.value) })).sort((a, b) => a.name.localeCompare(b.name))))
      : null;
    const lines = input.components.map((l) => ({ name: byId.get(l.componentId)!.name, kind: byId.get(l.componentId)!.kind, calcType: l.calcType, value: round2(l.value) })).sort((a, b) => a.name.localeCompare(b.name));
    const after = JSON.stringify(structureSnapshot(round2(input.basicSalary), lines));
    await tx.employeeSalaryComponent.deleteMany({ where: { employeeId: employee.id } });
    if (input.components.length) await tx.employeeSalaryComponent.createMany({ data: input.components.map((l) => ({ employeeId: employee.id, componentId: l.componentId, calcType: l.calcType, value: l.value })) });
    if (before !== after) {
      await tx.salaryRevision.create({
        data: {
          businessId: ctx.businessId, employeeId: employee.id, effectiveFrom: input.effectiveFrom ?? (existing ? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) : input.joiningDate),
          basicSalary: input.basicSalary, structure: JSON.parse(after), note: input.revisionNote ?? (existing ? null : "যোগদানের সময়ের বেতন কাঠামো"), createdById: ctx.userId,
        },
      });
    }
    return employee;
  }, TX);
}

export async function deleteEmployee(ctx: Ctx, id: string) {
  const e = await prisma.employee.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { payslips: true, advances: true, payments: true } } } });
  if (!e) throw new UserError("কর্মচারী পাওয়া যায়নি");
  if (e._count.payslips || e._count.advances || e._count.payments) throw new UserError("এই কর্মচারীর বেতন/অগ্রিমের রেকর্ড আছে — মুছার বদলে অবস্থা \"অব্যাহতি\" করুন");
  await prisma.employee.delete({ where: { id } });
  return e;
}

// ───────────────────────── attendance ─────────────────────────

async function assertMonthOpen(tx: Tx | typeof prisma, businessId: string, date: Date) {
  const run = await tx.payrollRun.findFirst({ where: { businessId, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, kind: "REGULAR", status: "POSTED" }, select: { id: true } });
  if (run) throw new UserError(`${periodLabel(date.getUTCFullYear(), date.getUTCMonth() + 1)} এর বেতন চূড়ান্ত (পোস্ট) করা হয়েছে — হাজিরা পরিবর্তন করা যাবে না`);
}

export async function saveAttendance(
  ctx: Ctx,
  input: { date: Date; rows: { employeeId: string; status: AttendanceStatus | null; overtimeHours: number; lateMinutes: number; note: string | null }[] },
) {
  return prisma.$transaction(async (tx) => {
    await assertMonthOpen(tx, ctx.businessId, input.date);
    const ids = [...new Set(input.rows.map((r) => r.employeeId))];
    const found = await tx.employee.count({ where: { businessId: ctx.businessId, id: { in: ids } } });
    if (found !== ids.length) throw new UserError("কর্মচারী পাওয়া যায়নি");
    let saved = 0;
    for (const r of input.rows) {
      const key = { employeeId_date: { employeeId: r.employeeId, date: input.date } };
      if (!r.status) {
        await tx.attendance.deleteMany({ where: { employeeId: r.employeeId, date: input.date } });
        continue;
      }
      const data = { status: r.status, overtimeHours: r.overtimeHours, lateMinutes: r.status === "LATE" ? r.lateMinutes : 0, note: r.note, updatedById: ctx.userId };
      await tx.attendance.upsert({ where: key, create: { ...data, businessId: ctx.businessId, employeeId: r.employeeId, date: input.date }, update: data });
      saved++;
    }
    return saved;
  }, TX);
}

/** Employees on the payroll during the month (joined by its end, not left before its start). */
export function employedDuring(businessId: string, year: number, month: number): Prisma.EmployeeWhereInput {
  return {
    businessId,
    joiningDate: { lte: monthEnd(year, month) },
    OR: [{ exitDate: null }, { exitDate: { gte: monthStart(year, month) } }],
    AND: [{ OR: [{ status: { in: ["ACTIVE", "PROBATION", "ON_LEAVE"] } }, { exitDate: { gte: monthStart(year, month) } }] }],
  };
}

/** Attendance summary per employee for a month (unmarked working days count as present). */
export async function attendanceSummaries(businessId: string, year: number, month: number, filter: { departmentId?: string; employeeId?: string } = {}) {
  const cfg = await payrollConfig(prisma, businessId);
  const wd = workingDaysInMonth(year, month, cfg.settings);
  const employees = await prisma.employee.findMany({
    where: { ...employedDuring(businessId, year, month), ...(filter.departmentId ? { departmentId: filter.departmentId } : {}), ...(filter.employeeId ? { id: filter.employeeId } : {}) },
    include: { department: { select: { name: true } } },
    orderBy: [{ code: "asc" }],
  });
  const rows = await prisma.attendance.findMany({ where: { businessId, employeeId: { in: employees.map((e) => e.id) }, date: { gte: monthStart(year, month), lte: monthEnd(year, month) } } });
  return {
    workingDays: wd,
    items: employees.map((e) => {
      const { fraction, from, to } = employedFraction(year, month, e.joiningDate, e.exitDate);
      const mine = rows.filter((r) => r.employeeId === e.id && r.date >= from && r.date <= to).map((r) => ({ status: r.status, overtimeHours: num(r.overtimeHours) }));
      return { employee: e, fraction, marked: mine.length, summary: summarizeAttendance(mine, cfg.settings.lateDaysPerAbsence, round2(wd * fraction)) };
    }),
  };
}

// ───────────────────────── payroll runs ─────────────────────────

/** Outstanding advances / loans of employees (only recoveries in POSTED runs count). */
export async function advanceOutstanding(tx: Tx | typeof prisma, businessId: string, employeeIds?: string[], excludeRunId?: string) {
  const advances = await tx.employeeAdvance.findMany({ where: { businessId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) }, orderBy: { date: "asc" } });
  if (!advances.length) return [];
  const recovered = await tx.payslipLine.groupBy({
    by: ["advanceId"],
    where: { advanceId: { in: advances.map((a) => a.id) }, payslip: { run: { status: "POSTED", ...(excludeRunId ? { id: { not: excludeRunId } } : {}) } } },
    _sum: { amount: true },
  });
  const rec = new Map(recovered.map((r) => [r.advanceId!, num(r._sum.amount)]));
  return advances.map((a) => ({ ...a, amountN: num(a.amount), installmentN: num(a.installment), recovered: rec.get(a.id) ?? 0, outstanding: round2(num(a.amount) - (rec.get(a.id) ?? 0)) }));
}

type RunRow = { id: string; year: number; month: number; kind: PayrollKind; workingDays: number };

/** (Re)calculates one employee's payslip in a DRAFT run, keeping review adjustments. */
async function computePayslip(tx: Tx, businessId: string, cfg: PayrollConfig, run: RunRow, employeeId: string, adjust?: { extraOvertimeHours: number; manual: ManualLine[] }) {
  const e = await tx.employee.findFirstOrThrow({ where: { id: employeeId, businessId }, include: { department: true, components: { include: { component: true } } } });
  const { fraction, from, to } = employedFraction(run.year, run.month, e.joiningDate, e.exitDate);
  const existing = await tx.payslip.findUnique({ where: { employeeId_year_month_kind: { employeeId, year: run.year, month: run.month, kind: run.kind } }, include: { lines: { where: { isManual: true }, include: { component: true } } } });
  if (existing && existing.runId !== run.id) throw new UserError(`${e.name}: এই মাসের বেতন ইতিমধ্যে অন্য হিসাবে আছে`);
  const regular = run.kind === "REGULAR";
  const attendanceRows = regular ? await tx.attendance.findMany({ where: { employeeId, date: { gte: from, lte: to } }, select: { status: true, overtimeHours: true } }) : [];
  const attendance = regular ? summarizeAttendance(attendanceRows.map((r) => ({ status: r.status, overtimeHours: num(r.overtimeHours) })), cfg.settings.lateDaysPerAbsence, round2(run.workingDays * fraction)) : null;

  // structure: the employee's own lines of this run kind; a bonus run also applies every active bonus component by default
  const own = e.components.filter((l) => l.component.isActive && l.component.appliesTo === run.kind);
  const structure: StructureLine[] = own.map((l) => ({ componentId: l.componentId, name: l.component.name, kind: l.component.kind, calcType: l.calcType, value: num(l.value), accountId: l.component.accountId, liabilityAccountId: l.component.liabilityAccountId, ruleKey: l.component.ruleKey, sortOrder: l.component.sortOrder }));
  if (!regular) {
    const bonus = await tx.payComponent.findMany({ where: { businessId, isActive: true, appliesTo: "BONUS", id: { notIn: own.map((l) => l.componentId) } } });
    for (const c of bonus) structure.push({ componentId: c.id, name: c.name, kind: c.kind, calcType: c.calcType, value: num(c.defaultValue), accountId: c.accountId, liabilityAccountId: c.liabilityAccountId, ruleKey: c.ruleKey, sortOrder: c.sortOrder });
  }
  const advances: AdvanceDue[] = regular
    ? (await advanceOutstanding(tx, businessId, [employeeId], run.id)).filter((a) => a.outstanding > 0.004).map((a) => ({ id: a.id, kind: a.kind, installment: a.installmentN, outstanding: a.outstanding }))
    : [];
  const manual: ManualLine[] = adjust?.manual ?? existing?.lines.map((l) => ({ componentId: l.componentId, name: l.name, kind: l.kind, amount: num(l.amount), accountId: l.component?.accountId ?? l.accountId, liabilityAccountId: l.liabilityAccountId, note: l.note })) ?? [];
  const extraOvertimeHours = adjust?.extraOvertimeHours ?? (existing ? num(existing.extraOvertimeHours) : 0);

  let r;
  try {
    r = calculatePayslip({
      kind: run.kind, year: run.year, month: run.month, basic: num(e.basicSalary), workingDays: run.workingDays, fraction, attendance, extraOvertimeHours,
      overtime: { eligible: e.overtimeEligible, rate: e.overtimeRate === null ? null : num(e.overtimeRate) }, settings: cfg.settings, structure,
      system: { basic: cfg.system.BASIC, overtime: cfg.system.OVERTIME, absence: cfg.system.ABSENCE, advance: cfg.system.ADVANCE, loan: cfg.system.LOAN }, advances, manual,
      employee: { joiningDate: e.joiningDate, tin: e.tin },
    });
  } catch (err) {
    if (err instanceof PayrollCalcError) throw new UserError(`${e.code} ${e.name}: ${err.message}`);
    throw err;
  }
  const a = attendance;
  const data = {
    businessId, runId: run.id, employeeId, year: run.year, month: run.month, kind: run.kind,
    employeeCode: e.code, employeeName: e.name, designation: e.designation, departmentName: e.department?.name ?? null,
    basicSalary: e.basicSalary, workingDays: round2(run.workingDays * fraction), payableDays: r.payableDays,
    presentDays: a?.present ?? 0, absentDays: a?.absent ?? 0, leaveDays: a?.leave ?? 0, unpaidLeaveDays: a?.unpaidLeave ?? 0, halfDays: a?.halfDays ?? 0,
    lateDays: a?.late ?? 0, holidays: a?.holidays ?? 0, deductedDays: r.deductedDays, overtimeHours: r.overtimeHours, extraOvertimeHours, overtimeRate: r.overtimeRate,
    gross: r.gross, totalDeductions: r.totalDeductions, net: r.net, employerCost: r.employerCost,
  };
  const slip = existing ? await tx.payslip.update({ where: { id: existing.id }, data }) : await tx.payslip.create({ data });
  await tx.payslipLine.deleteMany({ where: { payslipId: slip.id } });
  await tx.payslipLine.createMany({ data: r.lines.map((l) => ({ payslipId: slip.id, componentId: l.componentId, advanceId: l.advanceId, kind: l.kind, name: l.name, amount: l.amount, accountId: l.accountId, liabilityAccountId: l.liabilityAccountId, isManual: l.isManual, note: l.note, sortOrder: l.sortOrder })) });
  return { slip, warnings: r.warnings.map((w) => `${e.code} ${e.name}: ${w}`) };
}

async function updateRunTotals(tx: Tx, runId: string) {
  const t = await tx.payslip.aggregate({ where: { runId }, _sum: { gross: true, totalDeductions: true, net: true, employerCost: true } });
  return tx.payrollRun.update({
    where: { id: runId },
    data: { totalGross: num(t._sum.gross), totalDeductions: num(t._sum.totalDeductions), totalNet: num(t._sum.net), totalEmployer: num(t._sum.employerCost) },
  });
}

/**
 * Calculates the payroll of a month: creates the DRAFT run (or recalculates an existing draft).
 * A finalized (POSTED) month cannot be calculated again — one payroll per employee, month and kind.
 */
export async function calculatePayrollRun(ctx: Ctx, input: { year: number; month: number; kind: PayrollKind; postingDate: Date; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const cfg = await payrollConfig(tx, ctx.businessId);
    await assertNotLocked(tx, ctx.businessId, input.postingDate);
    const existing = await tx.payrollRun.findUnique({ where: { businessId_year_month_kind: { businessId: ctx.businessId, year: input.year, month: input.month, kind: input.kind } } });
    const label = `${periodLabel(input.year, input.month)} (${PAYROLL_KIND_LABELS[input.kind]})`;
    if (existing?.status === "POSTED") throw new UserError(`${label} এর বেতন ইতিমধ্যে চূড়ান্ত (পোস্ট) করা হয়েছে — একই মাসের বেতন দুবার করা যাবে না`);
    const workingDays = workingDaysInMonth(input.year, input.month, cfg.settings);
    const run = existing
      ? await tx.payrollRun.update({ where: { id: existing.id }, data: { postingDate: input.postingDate, workingDays, note: input.note ?? existing.note } })
      : await tx.payrollRun.create({ data: { businessId: ctx.businessId, year: input.year, month: input.month, kind: input.kind, postingDate: input.postingDate, workingDays, note: input.note ?? null, createdById: ctx.userId } });
    const employees = await tx.employee.findMany({ where: employedDuring(ctx.businessId, input.year, input.month), select: { id: true, joiningDate: true, exitDate: true }, orderBy: { code: "asc" } });
    const eligible = employees.filter((e) => employedFraction(input.year, input.month, e.joiningDate, e.exitDate).fraction > 0);
    // employees no longer eligible (left / data corrected) drop out of a draft
    await tx.payslip.deleteMany({ where: { runId: run.id, employeeId: { notIn: eligible.map((e) => e.id) } } });
    const warnings: string[] = [];
    for (const e of eligible) warnings.push(...(await computePayslip(tx, ctx.businessId, cfg, run, e.id)).warnings);
    const saved = await updateRunTotals(tx, run.id);
    return { run: saved, employees: eligible.length, warnings, recalculated: !!existing };
  }, TX);
}

async function draftRunOf(tx: Tx, businessId: string, runId: string) {
  const run = await tx.payrollRun.findFirst({ where: { id: runId, businessId } });
  if (!run) throw new UserError("বেতন হিসাব পাওয়া যায়নি");
  if (run.status !== "DRAFT") throw new UserError("চূড়ান্ত (পোস্ট করা) বেতন পরিবর্তন করা যাবে না — আগে \"পোস্টিং বাতিল\" করুন");
  return run;
}

/** Review adjustments on one payslip of a DRAFT run (extra overtime hours, bonus / fine lines). */
export async function adjustPayslip(ctx: Ctx, payslipId: string, input: { extraOvertimeHours: number; manual: { componentId: string; amount: number; note: string | null }[] }) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const slip = await tx.payslip.findFirst({ where: { id: payslipId, businessId: ctx.businessId } });
    if (!slip) throw new UserError("পে-স্লিপ পাওয়া যায়নি");
    const run = await draftRunOf(tx, ctx.businessId, slip.runId);
    const ids = [...new Set(input.manual.map((m) => m.componentId))];
    const comps = ids.length ? await tx.payComponent.findMany({ where: { businessId: ctx.businessId, id: { in: ids }, isActive: true } }) : [];
    if (comps.length !== ids.length) throw new UserError("উপাদান পাওয়া যায়নি বা নিষ্ক্রিয়");
    const byId = new Map(comps.map((c) => [c.id, c]));
    const manual: ManualLine[] = input.manual.map((m) => {
      const c = byId.get(m.componentId)!;
      if (c.kind === "EMPLOYER" || isAuto(c.systemKey)) throw new UserError(`"${c.name}" হাতে যোগ করা যায় না`);
      return { componentId: c.id, name: c.name, kind: c.kind, amount: m.amount, accountId: c.accountId, liabilityAccountId: null, note: m.note };
    });
    const cfg = await payrollConfig(tx, ctx.businessId);
    const r = await computePayslip(tx, ctx.businessId, cfg, run, slip.employeeId, { extraOvertimeHours: input.extraOvertimeHours, manual });
    await updateRunTotals(tx, run.id);
    return r;
  }, TX);
}

/** Things changed after the calculation (attendance, salary structure) — posting would use stale figures. */
export async function staleReasons(tx: Tx | typeof prisma, run: { id: string; businessId: string; year: number; month: number; kind: PayrollKind; updatedAt: Date }) {
  const slips = await tx.payslip.findMany({ where: { runId: run.id }, select: { employeeId: true, updatedAt: true, employeeName: true } });
  const reasons: string[] = [];
  if (run.kind === "REGULAR") {
    const changed = await tx.attendance.findFirst({ where: { businessId: run.businessId, date: { gte: monthStart(run.year, run.month), lte: monthEnd(run.year, run.month) }, updatedAt: { gt: run.updatedAt } }, select: { id: true } });
    if (changed) reasons.push("হিসাবের পর হাজিরা পরিবর্তিত হয়েছে");
  }
  const lastCalc = new Map(slips.map((s) => [s.employeeId, s.updatedAt]));
  const emps = await tx.employee.findMany({ where: { id: { in: [...lastCalc.keys()] } }, select: { id: true, name: true, updatedAt: true } });
  const changedEmp = emps.filter((e) => e.updatedAt > lastCalc.get(e.id)!);
  if (changedEmp.length) reasons.push(`হিসাবের পর কর্মচারীর বেতন তথ্য পরিবর্তিত: ${changedEmp.slice(0, 3).map((e) => e.name).join(", ")}${changedEmp.length > 3 ? " …" : ""}`);
  const newcomers = await tx.employee.count({ where: { ...employedDuring(run.businessId, run.year, run.month), id: { notIn: [...lastCalc.keys()] }, createdAt: { gt: run.updatedAt } } });
  if (newcomers) reasons.push(`হিসাবের পর ${newcomers} জন নতুন কর্মচারী যোগ হয়েছে`);
  return reasons;
}

/** Finalizes a DRAFT run: posts one balanced journal voucher and locks the payroll. */
export async function postPayrollRun(ctx: Ctx, runId: string) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const run = await draftRunOf(tx, ctx.businessId, runId);
    await assertNotLocked(tx, ctx.businessId, run.postingDate);
    const stale = await staleReasons(tx, run);
    if (stale.length) throw new UserError(`${stale.join("; ")} — পোস্ট করার আগে "পুনরায় হিসাব" করুন`);
    const cfg = await payrollConfig(tx, ctx.businessId);
    const slips = await tx.payslip.findMany({ where: { runId }, include: { lines: true } });
    if (!slips.length) throw new UserError("এই হিসাবে কোনো কর্মচারী নেই");
    const label = `বেতন — ${periodLabel(run.year, run.month)} (${PAYROLL_KIND_LABELS[run.kind]})`;
    const lines = payrollJournalLines(
      slips.map((s) => ({ net: num(s.net), lines: s.lines.map((l) => ({ kind: l.kind, amount: num(l.amount), accountId: l.accountId, liabilityAccountId: l.liabilityAccountId })) })),
      cfg.payableAccountId,
      label,
    );
    await assertAccounts(tx, ctx.businessId, lines.map((l) => l.accountId));
    const voucher = await tx.voucher.create({
      data: {
        businessId: ctx.businessId, type: "JOURNAL", voucherNo: await nextVoucherNo(tx, ctx.businessId, "JOURNAL"), date: run.postingDate,
        narration: `${label} — ${slips.length} জন`, reference: `PAYROLL-${run.year}-${String(run.month).padStart(2, "0")}${run.kind === "BONUS" ? "-B" : ""}`,
        amount: 0, sourceKey: `payroll:run:${run.id}`, createdById: ctx.userId,
      },
    });
    let amount;
    try {
      amount = await writeEntries(tx, voucher, lines);
    } catch (err) {
      if (err instanceof Error && /কমপক্ষে দুটি লাইন/.test(err.message)) throw new UserError("পোস্ট করার মতো কোনো টাকা নেই (সব বেতন শূন্য)");
      throw err;
    }
    await tx.voucher.update({ where: { id: voucher.id }, data: { amount } });
    return tx.payrollRun.update({ where: { id: run.id }, data: { status: "POSTED", voucherId: voucher.id, postedAt: new Date(), postedById: ctx.userId } });
  }, TX);
}

/** Reverses a posting (only while nothing has been paid and the period is open) — back to DRAFT. */
export async function reopenPayrollRun(ctx: Ctx, runId: string) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const run = await tx.payrollRun.findFirst({ where: { id: runId, businessId: ctx.businessId } });
    if (!run) throw new UserError("বেতন হিসাব পাওয়া যায়নি");
    if (run.status !== "POSTED") throw new UserError("এই বেতন এখনো পোস্ট করা হয়নি");
    await assertNotLocked(tx, ctx.businessId, run.postingDate);
    const paid = await tx.salaryPayment.count({ where: { payslip: { runId } } });
    if (paid) throw new UserError("এই মাসের বেতন থেকে পরিশোধ করা হয়েছে — আগে পরিশোধগুলো বাতিল করুন");
    if (run.kind === "REGULAR") {
      const later = await tx.payrollRun.findFirst({ where: { businessId: ctx.businessId, kind: "REGULAR", status: "POSTED", OR: [{ year: { gt: run.year } }, { year: run.year, month: { gt: run.month } }] }, select: { year: true, month: true } });
      const advanceLines = await tx.payslipLine.count({ where: { advanceId: { not: null }, payslip: { runId } } });
      if (later && advanceLines) throw new UserError(`পরের মাস (${periodLabel(later.year, later.month)}) এর বেতন পোস্ট করা আছে এবং এতে অগ্রিমের কিস্তি কাটা হয়েছে — আগে পরের মাসের পোস্টিং বাতিল করুন`);
    }
    const voucherId = run.voucherId;
    const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { status: "DRAFT", voucherId: null, postedAt: null, postedById: null } });
    if (voucherId) await tx.voucher.delete({ where: { id: voucherId } });
    return updated;
  }, TX);
}

export async function deletePayrollRun(ctx: Ctx, runId: string) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const run = await draftRunOf(tx, ctx.businessId, runId);
    await tx.payrollRun.delete({ where: { id: run.id } });
    return run;
  }, TX);
}

// ───────────────────────── payable & payments ─────────────────────────

/** Unpaid salary per employee (posted payslips only), oldest month first. */
export async function unpaidPayslips(tx: Tx | typeof prisma, businessId: string, employeeIds?: string[]) {
  const slips = await tx.payslip.findMany({
    where: { businessId, run: { status: "POSTED" }, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    orderBy: [{ year: "asc" }, { month: "asc" }, { kind: "asc" }],
    select: { id: true, employeeId: true, year: true, month: true, kind: true, net: true, paidAmount: true, employeeName: true, employeeCode: true },
  });
  return slips.map((s) => ({ ...s, due: round2(num(s.net) - num(s.paidAmount)) })).filter((s) => s.due > 0.004);
}

export async function employeePayables(businessId: string, employeeIds?: string[]) {
  const map = new Map<string, number>();
  for (const s of await unpaidPayslips(prisma, businessId, employeeIds)) map.set(s.employeeId, round2((map.get(s.employeeId) ?? 0) + s.due));
  return map;
}

/**
 * Pays salaries (one PAYMENT voucher: Dr Salary Payable, Cr cash/bank) and allocates each employee's
 * amount to their unpaid payslips, oldest first. Never more than what is payable.
 */
export async function paySalaries(ctx: Ctx, input: { date: Date; cashAccountId: string; reference: string | null; narration: string | null; items: { employeeId: string; amount: number }[] }) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    await assertNotLocked(tx, ctx.businessId, input.date);
    await assertAccounts(tx, ctx.businessId, [input.cashAccountId], { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    const cfg = await payrollConfig(tx, ctx.businessId);
    const ids = [...new Set(input.items.map((i) => i.employeeId))];
    if (ids.length !== input.items.length) throw new UserError("একই কর্মচারী দুবার দেওয়া হয়েছে");
    const emps = await tx.employee.findMany({ where: { businessId: ctx.businessId, id: { in: ids } }, select: { id: true, code: true, name: true } });
    if (emps.length !== ids.length) throw new UserError("কর্মচারী পাওয়া যায়নি");
    const empById = new Map(emps.map((e) => [e.id, e]));
    const unpaid = await unpaidPayslips(tx, ctx.businessId, ids);
    const total = round2(input.items.reduce((s, i) => s + i.amount, 0));
    const voucher = await tx.voucher.create({
      data: {
        businessId: ctx.businessId, type: "PAYMENT", voucherNo: await nextVoucherNo(tx, ctx.businessId, "PAYMENT"), date: input.date, reference: input.reference,
        narration: input.narration ?? `বেতন পরিশোধ — ${emps.length === 1 ? `${emps[0].code}` : `${emps.length} জন`}`,
        cashAccountId: input.cashAccountId, amount: total, paidAmount: total, sourceKey: `payroll:payment:${randomUUID()}`, createdById: ctx.userId,
      },
    });
    for (const item of input.items) {
      const e = empById.get(item.employeeId)!;
      const mine = unpaid.filter((s) => s.employeeId === item.employeeId);
      const due = round2(mine.reduce((s, x) => s + x.due, 0));
      if (item.amount > due + 0.004) throw new UserError(`${e.code} ${e.name}: প্রদেয় বেতন ${formatMoney(due, "৳")} — এর বেশি পরিশোধ করা যাবে না`);
      let left = round2(item.amount);
      for (const s of mine) {
        if (left <= 0.004) break;
        const pay = round2(Math.min(left, s.due));
        await tx.salaryPayment.create({ data: { businessId: ctx.businessId, employeeId: e.id, payslipId: s.id, voucherId: voucher.id, date: input.date, amount: pay, createdById: ctx.userId } });
        await tx.payslip.update({ where: { id: s.id }, data: { paidAmount: { increment: pay } } });
        left = round2(left - pay);
      }
    }
    const codes = emps.map((e) => e.code).join(", ");
    await writeEntries(tx, voucher, [
      { accountId: cfg.payableAccountId, debit: total, credit: 0, narration: `বেতন পরিশোধ — ${codes.length > 180 ? `${emps.length} জন` : codes}` },
      { accountId: input.cashAccountId, debit: 0, credit: total },
    ]);
    return voucher;
  }, TX);
}

/** Cancels a salary payment voucher (period must be open). */
export async function deleteSalaryPayment(ctx: Ctx, voucherId: string) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const v = await tx.voucher.findFirst({ where: { id: voucherId, businessId: ctx.businessId }, include: { salaryPayments: true } });
    if (!v || !v.sourceKey?.startsWith("payroll:payment:")) throw new UserError("বেতন পরিশোধ পাওয়া যায়নি");
    await assertNotLocked(tx, ctx.businessId, v.date);
    for (const p of v.salaryPayments) await tx.payslip.update({ where: { id: p.payslipId }, data: { paidAmount: { decrement: p.amount } } });
    await tx.voucher.delete({ where: { id: v.id } });
    return v;
  }, TX);
}

// ───────────────────────── advances & loans ─────────────────────────

export async function giveAdvance(ctx: Ctx, input: { employeeId: string; kind: "ADVANCE" | "LOAN"; date: Date; amount: number; installment: number; cashAccountId: string; note: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    await assertNotLocked(tx, ctx.businessId, input.date);
    const e = await tx.employee.findFirst({ where: { id: input.employeeId, businessId: ctx.businessId } });
    if (!e) throw new UserError("কর্মচারী পাওয়া যায়নি");
    if (e.status === "RESIGNED" || e.status === "TERMINATED") throw new UserError("অব্যাহতিপ্রাপ্ত কর্মচারীকে অগ্রিম দেওয়া যাবে না");
    await assertAccounts(tx, ctx.businessId, [input.cashAccountId], { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    const cfg = await payrollConfig(tx, ctx.businessId);
    const id = randomUUID();
    const what = input.kind === "LOAN" ? "কর্মচারী ঋণ" : "কর্মচারী অগ্রিম";
    const voucher = await tx.voucher.create({
      data: {
        businessId: ctx.businessId, type: "PAYMENT", voucherNo: await nextVoucherNo(tx, ctx.businessId, "PAYMENT"), date: input.date, narration: `${what} — ${e.code} ${e.name}${input.note ? ` (${input.note})` : ""}`,
        cashAccountId: input.cashAccountId, amount: input.amount, paidAmount: input.amount, sourceKey: `payroll:advance:${id}`, createdById: ctx.userId,
      },
    });
    await writeEntries(tx, voucher, [
      { accountId: cfg.advanceAccountId, debit: input.amount, credit: 0, narration: `${what} — ${e.code}` },
      { accountId: input.cashAccountId, debit: 0, credit: input.amount },
    ]);
    return tx.employeeAdvance.create({ data: { id, businessId: ctx.businessId, employeeId: e.id, kind: input.kind, date: input.date, amount: input.amount, installment: input.installment, voucherId: voucher.id, note: input.note, createdById: ctx.userId } });
  }, TX);
}

export async function deleteAdvance(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    await lockPayroll(tx, ctx.businessId);
    const a = await tx.employeeAdvance.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { recoveryLines: true } } } });
    if (!a) throw new UserError("অগ্রিম পাওয়া যায়নি");
    if (a._count.recoveryLines) throw new UserError("এই অগ্রিমের কিস্তি বেতন থেকে কাটা হয়েছে (বা খসড়া বেতনে আছে) — মুছা যাবে না");
    await assertNotLocked(tx, ctx.businessId, a.date);
    await tx.employeeAdvance.delete({ where: { id } });
    await tx.voucher.delete({ where: { id: a.voucherId } });
    return a;
  }, TX);
}

// ───────────────────────── reconciliation ─────────────────────────

/** Salary Payable ledger vs. the sum of employee payables (they must agree). */
export async function payableReconciliation(businessId: string) {
  const cfg = await payrollConfig(prisma, businessId);
  const [ledger, sub] = await Promise.all([
    prisma.journalEntry.aggregate({ where: { businessId, accountId: cfg.payableAccountId }, _sum: { debit: true, credit: true } }),
    unpaidPayslips(prisma, businessId),
  ]);
  const ledgerBalance = round2(num(ledger._sum.credit) - num(ledger._sum.debit));
  const employees = round2(sub.reduce((s, x) => s + x.due, 0));
  return { ledgerBalance, employees, difference: round2(ledgerBalance - employees) };
}
