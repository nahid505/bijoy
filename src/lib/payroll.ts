// Payroll calculation engine: pure functions (no database), shared by the server and the tests.
//
// A payslip is a list of lines:
//   EARNING   — basic, allowances, overtime, bonus …            → gross salary   (Dr the line's expense ledger)
//   DEDUCTION — absence, advance/loan recovery, PF, tax, fine … → net = gross − Σ (Cr the line's ledger)
//   EMPLOYER  — employer contributions (PF employer share, gratuity provision): cost to the business,
//               not paid in net salary (Dr expense ledger, Cr liability ledger)
// and the net salary is credited to Salary Payable. New statutory items (TDS, PF, gratuity, festival
// bonus …) are configured as components (kind + calculation + ledgers) or, when a formula is needed,
// registered as a RULE below — the engine itself does not change.
import type { EntryLine } from "./accounting";
import { round2 } from "./calc";

export type PayCalcType = "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "RULE";
export type PayComponentKind = "EARNING" | "DEDUCTION" | "EMPLOYER";
export type PayrollKind = "REGULAR" | "BONUS";
export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "UNPAID_LEAVE" | "HALF_DAY" | "HOLIDAY";

export const ATTENDANCE_LABELS: Record<AttendanceStatus, { label: string; short: string; tone: "green" | "amber" | "red" | "blue" | "slate" }> = {
  PRESENT: { label: "উপস্থিত", short: "উ", tone: "green" },
  LATE: { label: "দেরি", short: "দে", tone: "amber" },
  ABSENT: { label: "অনুপস্থিত", short: "অ", tone: "red" },
  LEAVE: { label: "ছুটি (সবেতন)", short: "ছু", tone: "blue" },
  UNPAID_LEAVE: { label: "বিনা বেতনে ছুটি", short: "বি", tone: "red" },
  HALF_DAY: { label: "অর্ধদিবস", short: "অর্ধ", tone: "amber" },
  HOLIDAY: { label: "ছুটির দিন", short: "ছদি", tone: "slate" },
};
export const CALC_TYPE_LABELS: Record<PayCalcType, string> = {
  FIXED: "নির্দিষ্ট টাকা",
  PERCENT_OF_BASIC: "মূল বেতনের %",
  PERCENT_OF_GROSS: "মোট বেতনের %",
  RULE: "নিয়ম (স্বয়ংক্রিয়)",
};
export const COMPONENT_KIND_LABELS: Record<PayComponentKind, string> = { EARNING: "আয় / ভাতা", DEDUCTION: "কর্তন", EMPLOYER: "প্রতিষ্ঠানের অবদান" };
export const PAYROLL_KIND_LABELS: Record<PayrollKind, string> = { REGULAR: "মাসিক বেতন", BONUS: "উৎসব ভাতা" };
export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = { ACTIVE: "কর্মরত", PROBATION: "শিক্ষানবিশ", ON_LEAVE: "ছুটিতে", RESIGNED: "অব্যাহতি", TERMINATED: "চাকরিচ্যুত" };
export const MONTH_NAMES = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];

export class PayrollCalcError extends Error {}

// ───────────────────────── calendar ─────────────────────────

export const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));
export const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0));
export const daysInMonth = (year: number, month: number) => monthEnd(year, month).getUTCDate();
/** "2026-10" ⇄ { year, month } */
export function parsePeriod(s: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : null;
}
export const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
export const periodLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1]} ${year}`;

export interface PayrollSettingsInput {
  workingDaysMode: string; // FIXED | CALENDAR | CALENDAR_LESS_OFF_DAYS
  fixedWorkingDays: number;
  weeklyOffDays: number[];
  hoursPerDay: number;
  overtimeMultiplier: number;
  lateDaysPerAbsence: number;
  absenceBasis: string; // BASIC | GROSS
}

/** Calendar days of the month that are weekly off days. */
export function offDaysInMonth(year: number, month: number, weeklyOffDays: number[]) {
  let n = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) if (weeklyOffDays.includes(new Date(Date.UTC(year, month - 1, d)).getUTCDay())) n++;
  return n;
}

/** Working days the monthly salary is divided by (per-day rate and absence deduction). */
export function workingDaysInMonth(year: number, month: number, s: Pick<PayrollSettingsInput, "workingDaysMode" | "fixedWorkingDays" | "weeklyOffDays">) {
  if (s.workingDaysMode === "CALENDAR") return daysInMonth(year, month);
  if (s.workingDaysMode === "CALENDAR_LESS_OFF_DAYS") return daysInMonth(year, month) - offDaysInMonth(year, month, s.weeklyOffDays);
  return Math.max(1, Math.min(31, Math.round(s.fixedWorkingDays)));
}

/** Share of the month the employee was employed (joining / exit inside the month), by calendar days. */
export function employedFraction(year: number, month: number, joiningDate: Date, exitDate: Date | null) {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const from = joiningDate > start ? joiningDate : start;
  const to = exitDate && exitDate < end ? exitDate : end;
  if (to < from) return { fraction: 0, from, to };
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return { fraction: Math.min(1, days / daysInMonth(year, month)), from, to };
}

// ───────────────────────── attendance ─────────────────────────

export interface AttendanceSummary {
  present: number; // PRESENT + LATE (+ unmarked working days are treated as present)
  late: number;
  absent: number;
  leave: number;
  unpaidLeave: number;
  halfDays: number;
  holidays: number;
  overtimeHours: number;
  /** days deducted: absent + unpaid leave + ½ × half days + late penalty */
  deductedDays: number;
  latePenaltyDays: number;
}

/**
 * Only exceptions need to be marked: a working day without an attendance record counts as present.
 * `lateDaysPerAbsence` late days cost one day (0 = no late penalty).
 */
export function summarizeAttendance(rows: { status: AttendanceStatus; overtimeHours: number }[], lateDaysPerAbsence: number, workingDays: number): AttendanceSummary {
  const count = (s: AttendanceStatus) => rows.filter((r) => r.status === s).length;
  const late = count("LATE");
  const absent = count("ABSENT");
  const unpaidLeave = count("UNPAID_LEAVE");
  const halfDays = count("HALF_DAY");
  const leave = count("LEAVE");
  const holidays = count("HOLIDAY");
  const latePenaltyDays = lateDaysPerAbsence > 0 ? Math.floor(late / lateDaysPerAbsence) : 0;
  const deductedDays = round2(absent + unpaidLeave + halfDays * 0.5 + latePenaltyDays);
  const present = Math.max(0, round2(workingDays - absent - unpaidLeave - leave - halfDays * 0.5 - holidays));
  return { present, late, absent, leave, unpaidLeave, halfDays, holidays, overtimeHours: round2(rows.reduce((s, r) => s + (r.overtimeHours || 0), 0)), deductedDays, latePenaltyDays };
}

// ───────────────────────── rules (extension point) ─────────────────────────

export interface RuleContext {
  year: number;
  month: number;
  kind: PayrollKind;
  basic: number; // basic earned this month (after joining / exit proration)
  gross: number; // gross earnings computed so far (rules for deductions see the full gross)
  annualBasic: number;
  employee: { joiningDate: Date; tin: string | null };
}
/**
 * Registered calculation rules for components with calcType RULE, e.g. a Bangladesh income-tax
 * (TDS on salary) slab, PF eligibility after confirmation, or festival-bonus service rules.
 * Add an entry here and select it on the component — no other code changes are needed.
 * None are registered by default: statutory rates change every budget year and must be set up
 * (or verified) by the business before use.
 */
export const PAY_RULES: Record<string, { label: string; compute: (ctx: RuleContext, value: number) => number }> = {};

// ───────────────────────── payslip calculation ─────────────────────────

export interface ComponentRef {
  componentId: string | null;
  name: string;
  accountId: string | null;
  liabilityAccountId?: string | null;
}
export interface StructureLine extends ComponentRef {
  kind: PayComponentKind;
  calcType: PayCalcType;
  value: number;
  ruleKey?: string | null;
  sortOrder?: number;
}
export interface ManualLine extends ComponentRef {
  kind: PayComponentKind;
  amount: number;
  note?: string | null;
}
export interface AdvanceDue {
  id: string;
  kind: "ADVANCE" | "LOAN";
  installment: number;
  outstanding: number;
}
export interface PayslipLineOut {
  componentId: string | null;
  advanceId: string | null;
  kind: PayComponentKind;
  name: string;
  amount: number;
  accountId: string;
  liabilityAccountId: string | null;
  isManual: boolean;
  note: string | null;
  sortOrder: number;
}
export interface PayslipInput {
  kind: PayrollKind;
  year: number;
  month: number;
  basic: number; // monthly basic salary
  workingDays: number;
  fraction: number; // employedFraction
  attendance: AttendanceSummary | null; // null for BONUS runs
  extraOvertimeHours: number;
  overtime: { eligible: boolean; rate: number | null };
  settings: PayrollSettingsInput;
  structure: StructureLine[]; // components of this run kind (REGULAR or BONUS), active only
  system: { basic: ComponentRef; overtime: ComponentRef; absence: ComponentRef; advance: ComponentRef; loan: ComponentRef };
  advances: AdvanceDue[];
  manual: ManualLine[];
  employee: { joiningDate: Date; tin: string | null };
}
export interface PayslipResult {
  lines: PayslipLineOut[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  payableDays: number;
  deductedDays: number;
  overtimeHours: number;
  overtimeRate: number;
  warnings: string[];
}

const need = (ref: ComponentRef, what: string) => {
  if (!ref.accountId) throw new PayrollCalcError(`"${ref.name || what}" উপাদানের লেজার (হিসাব) নির্ধারণ করা হয়নি — বেতন সেটিং থেকে নির্ধারণ করুন`);
  return ref.accountId;
};

export function calculatePayslip(input: PayslipInput): PayslipResult {
  const { kind, basic, workingDays, settings } = input;
  const regular = kind === "REGULAR";
  const f = regular ? Math.max(0, Math.min(1, input.fraction)) : 1;
  const lines: PayslipLineOut[] = [];
  const warnings: string[] = [];
  let order = 0;
  const push = (l: Omit<PayslipLineOut, "sortOrder" | "liabilityAccountId" | "advanceId" | "isManual" | "note"> & Partial<PayslipLineOut>) => {
    const amount = round2(l.amount);
    if (amount <= 0) return;
    lines.push({ advanceId: null, liabilityAccountId: null, isManual: false, note: null, ...l, amount, sortOrder: l.sortOrder ?? order++ });
  };
  const ruleCtx = (gross: number): RuleContext => ({ year: input.year, month: input.month, kind, basic: round2(basic * f), gross, annualBasic: round2(basic * 12), employee: input.employee });
  const amountOf = (l: StructureLine, gross: number) => {
    const v = l.value || 0;
    switch (l.calcType) {
      case "FIXED":
        return l.kind === "DEDUCTION" ? v : v * f; // earnings / contributions follow joining / exit; fixed deductions do not
      case "PERCENT_OF_BASIC":
        return (basic * f * v) / 100;
      case "PERCENT_OF_GROSS":
        if (l.kind === "EARNING") throw new PayrollCalcError(`"${l.name}": আয়ের উপাদান মোট বেতনের % হতে পারে না`);
        return (gross * v) / 100;
      case "RULE": {
        const rule = l.ruleKey ? PAY_RULES[l.ruleKey] : undefined;
        if (!rule) throw new PayrollCalcError(`"${l.name}": নিয়ম "${l.ruleKey ?? ""}" পাওয়া যায়নি`);
        return rule.compute(ruleCtx(gross), v);
      }
    }
  };
  const sorted = [...input.structure].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));

  // ── earnings
  let overtimeHours = 0;
  let overtimeRate = 0;
  if (regular) push({ componentId: input.system.basic.componentId, kind: "EARNING", name: input.system.basic.name, amount: basic * f, accountId: need(input.system.basic, "মূল বেতন") });
  for (const l of sorted.filter((x) => x.kind === "EARNING")) {
    const amount = amountOf(l, 0);
    if (amount > 0) push({ componentId: l.componentId, kind: "EARNING", name: l.name, amount, accountId: need(l, l.name) });
  }
  if (regular) {
    overtimeHours = round2((input.attendance?.overtimeHours ?? 0) + (input.extraOvertimeHours || 0));
    if (overtimeHours > 0 && !input.overtime.eligible) {
      warnings.push("ওভারটাইম প্রযোজ্য নয় — ওভারটাইম ঘণ্টা হিসাবে ধরা হয়নি");
      overtimeHours = 0;
    }
    if (overtimeHours > 0) {
      overtimeRate = input.overtime.rate && input.overtime.rate > 0 ? round2(input.overtime.rate) : round2((basic / (workingDays * settings.hoursPerDay)) * settings.overtimeMultiplier);
      push({ componentId: input.system.overtime.componentId, kind: "EARNING", name: `${input.system.overtime.name} (${overtimeHours} ঘণ্টা × ${overtimeRate})`, amount: overtimeHours * overtimeRate, accountId: need(input.system.overtime, "ওভারটাইম") });
    }
  }
  for (const m of input.manual.filter((x) => x.kind === "EARNING")) push({ componentId: m.componentId, kind: "EARNING", name: m.name, amount: m.amount, accountId: need(m, m.name), isManual: true, note: m.note ?? null });
  const gross = round2(lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0));

  // ── deductions
  let deductedDays = 0;
  let payableDays = round2(workingDays * f);
  if (regular && input.attendance) {
    deductedDays = input.attendance.deductedDays;
    payableDays = Math.max(0, round2(workingDays * f - deductedDays));
    if (deductedDays > 0) {
      // one day = monthly basic (or fixed gross) ÷ working days; never more than what was earned
      const fixedEarnings = sorted.filter((x) => x.kind === "EARNING" && x.calcType !== "RULE").reduce((s, l) => s + (l.calcType === "FIXED" ? l.value : (basic * l.value) / 100), 0);
      const basis = settings.absenceBasis === "GROSS" ? basic + fixedEarnings : basic;
      const earnedBasis = settings.absenceBasis === "GROSS" ? gross : basic * f;
      const amount = Math.min((basis / workingDays) * deductedDays, earnedBasis);
      const a = input.attendance;
      const parts = [a.absent && `অনুপস্থিত ${a.absent}`, a.unpaidLeave && `বিনা বেতনে ছুটি ${a.unpaidLeave}`, a.halfDays && `অর্ধদিবস ${a.halfDays}`, a.latePenaltyDays && `দেরি ${a.late} → ${a.latePenaltyDays}`].filter(Boolean).join(", ");
      push({ componentId: input.system.absence.componentId, kind: "DEDUCTION", name: `${input.system.absence.name} (${deductedDays} দিন${parts ? `: ${parts}` : ""})`, amount, accountId: need(input.system.absence, "অনুপস্থিতি কর্তন") });
    }
  }
  for (const l of sorted.filter((x) => x.kind === "DEDUCTION")) {
    const amount = amountOf(l, gross);
    if (amount > 0) push({ componentId: l.componentId, kind: "DEDUCTION", name: l.name, amount, accountId: need(l, l.name) });
  }
  for (const m of input.manual.filter((x) => x.kind === "DEDUCTION")) push({ componentId: m.componentId, kind: "DEDUCTION", name: m.name, amount: m.amount, accountId: need(m, m.name), isManual: true, note: m.note ?? null });
  const deductionsSoFar = () => round2(lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0));
  if (gross - deductionsSoFar() < -0.004) throw new PayrollCalcError(`নেট বেতন ঋণাত্মক হচ্ছে (মোট ${gross}, কর্তন ${deductionsSoFar()}) — কর্তন কমান`);

  // advance / loan installments: never more than outstanding, and never pushing net below zero
  if (regular) {
    for (const a of input.advances) {
      const room = round2(gross - deductionsSoFar());
      const want = round2(Math.min(a.installment, a.outstanding));
      const amount = round2(Math.min(want, room));
      if (amount < want) warnings.push(`${a.kind === "LOAN" ? "ঋণের" : "অগ্রিমের"} কিস্তি ${want} এর বদলে ${amount} কাটা হয়েছে (নেট বেতন যথেষ্ট নয়)`);
      const ref = a.kind === "LOAN" ? input.system.loan : input.system.advance;
      push({ componentId: ref.componentId, advanceId: a.id, kind: "DEDUCTION", name: ref.name, amount, accountId: need(ref, ref.name) });
    }
  }
  const totalDeductions = deductionsSoFar();

  // ── employer contributions
  for (const l of sorted.filter((x) => x.kind === "EMPLOYER")) {
    const amount = amountOf(l, gross);
    if (amount <= 0) continue;
    if (!l.liabilityAccountId) throw new PayrollCalcError(`"${l.name}": দায়ের লেজার (যেমন PF প্রদেয়) নির্ধারণ করা হয়নি`);
    push({ componentId: l.componentId, kind: "EMPLOYER", name: l.name, amount, accountId: need(l, l.name), liabilityAccountId: l.liabilityAccountId });
  }
  const employerCost = round2(lines.filter((l) => l.kind === "EMPLOYER").reduce((s, l) => s + l.amount, 0));

  return { lines, gross, totalDeductions, net: round2(gross - totalDeductions), employerCost, payableDays, deductedDays, overtimeHours, overtimeRate, warnings };
}

// ───────────────────────── posting ─────────────────────────

/**
 * Journal lines for posting a payroll run (aggregated per ledger — the voucher shows totals, the
 * employee detail stays in the payslips):
 *   Dr earning ledgers (gross) · Dr employer-contribution expense
 *   Cr deduction ledgers · Cr contribution liabilities · Cr Salary Payable (Σ net)
 */
export function payrollJournalLines(payslips: { net: number; lines: Pick<PayslipLineOut, "kind" | "amount" | "accountId" | "liabilityAccountId">[] }[], salaryPayableAccountId: string, label: string): EntryLine[] {
  const dr = new Map<string, number>();
  const cr = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, round2((m.get(id) ?? 0) + v));
  let net = 0;
  for (const p of payslips) {
    net += p.net;
    for (const l of p.lines) {
      if (l.kind === "EARNING") add(dr, l.accountId, l.amount);
      else if (l.kind === "DEDUCTION") add(cr, l.accountId, l.amount);
      else {
        add(dr, l.accountId, l.amount);
        add(cr, l.liabilityAccountId!, l.amount);
      }
    }
  }
  add(cr, salaryPayableAccountId, round2(net));
  return [
    ...[...dr].map(([accountId, v]) => ({ accountId, debit: v, credit: 0, narration: label })),
    ...[...cr].map(([accountId, v]) => ({ accountId, debit: 0, credit: v, narration: label })),
  ];
}

/** Payment status of a payslip. */
export function payslipStatus(net: number, paid: number): "UNPAID" | "PARTIAL" | "PAID" {
  if (net <= 0.004 || paid >= net - 0.004) return "PAID";
  return paid > 0.004 ? "PARTIAL" : "UNPAID";
}
export const PAYSLIP_STATUS_LABELS = { UNPAID: "অপরিশোধিত", PARTIAL: "আংশিক পরিশোধিত", PAID: "পরিশোধিত" } as const;
