// Payroll engine (pure): working days, attendance, proration, allowances, deductions, overtime,
// advance recovery, employer contributions and the journal it posts. Expected values are worked by hand.
import { describe, expect, it } from "vitest";
import { prepareEntries } from "@/lib/accounting";
import {
  calculatePayslip, employedFraction, offDaysInMonth, parsePeriod, payrollJournalLines, payslipStatus, PayrollCalcError, PAY_RULES,
  summarizeAttendance, workingDaysInMonth, type AttendanceStatus, type PayslipInput, type PayrollSettingsInput, type StructureLine,
} from "@/lib/payroll";

const S: PayrollSettingsInput = { workingDaysMode: "FIXED", fixedWorkingDays: 26, weeklyOffDays: [5], hoursPerDay: 8, overtimeMultiplier: 2, lateDaysPerAbsence: 3, absenceBasis: "BASIC" };
const ref = (name: string, accountId: string) => ({ componentId: `c-${name}`, name, accountId });
const SYSTEM = { basic: ref("মূল বেতন", "SALARY"), overtime: ref("ওভারটাইম", "SALARY"), absence: ref("অনুপস্থিতি কর্তন", "SALARY"), advance: ref("অগ্রিম সমন্বয়", "ADV"), loan: ref("ঋণের কিস্তি", "ADV") };
const line = (name: string, kind: StructureLine["kind"], calcType: StructureLine["calcType"], value: number, accountId: string, extra: Partial<StructureLine> = {}): StructureLine => ({ componentId: `c-${name}`, name, kind, calcType, value, accountId, ...extra });
const STRUCTURE = [
  line("বাড়ি ভাড়া", "EARNING", "PERCENT_OF_BASIC", 50, "SALARY"),
  line("চিকিৎসা", "EARNING", "FIXED", 1500, "SALARY"),
  line("যাতায়াত", "EARNING", "FIXED", 1000, "SALARY"),
  line("ভবিষ্য তহবিল", "DEDUCTION", "PERCENT_OF_BASIC", 5, "PF_PAY"),
];
const att = (spec: Partial<Record<AttendanceStatus, number>>, ot = 0) =>
  summarizeAttendance([...Object.entries(spec).flatMap(([s, n]) => Array.from({ length: n ?? 0 }, () => ({ status: s as AttendanceStatus, overtimeHours: 0 }))), { status: "PRESENT", overtimeHours: ot }], S.lateDaysPerAbsence, 26);
const base = (o: Partial<PayslipInput> = {}): PayslipInput => ({
  kind: "REGULAR", year: 2026, month: 10, basic: 20000, workingDays: 26, fraction: 1, attendance: att({}), extraOvertimeHours: 0,
  overtime: { eligible: true, rate: null }, settings: S, structure: STRUCTURE, system: SYSTEM, advances: [], manual: [], employee: { joiningDate: new Date("2025-01-01"), tin: null }, ...o,
});
const amt = (r: ReturnType<typeof calculatePayslip>, starts: string) => r.lines.find((l) => l.name.startsWith(starts))?.amount;

describe("calendar", () => {
  it("working days: fixed, calendar, calendar less weekly off days", () => {
    expect(workingDaysInMonth(2026, 10, S)).toBe(26);
    expect(workingDaysInMonth(2026, 2, { ...S, workingDaysMode: "CALENDAR" })).toBe(28);
    expect(offDaysInMonth(2026, 10, [5])).toBe(5); // October 2026 has five Fridays
    expect(workingDaysInMonth(2026, 10, { ...S, workingDaysMode: "CALENDAR_LESS_OFF_DAYS" })).toBe(26);
    expect(parsePeriod("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parsePeriod("2026-13")).toBeNull();
  });
  it("employment fraction for joining / exit inside the month", () => {
    expect(employedFraction(2026, 10, new Date("2020-01-01"), null).fraction).toBe(1);
    expect(employedFraction(2026, 10, new Date("2026-10-17"), null).fraction).toBeCloseTo(15 / 31, 10);
    expect(employedFraction(2026, 10, new Date("2020-01-01"), new Date("2026-10-10")).fraction).toBeCloseTo(10 / 31, 10);
    expect(employedFraction(2026, 10, new Date("2026-11-01"), null).fraction).toBe(0);
  });
});

describe("attendance", () => {
  it("summary: absent, unpaid leave, half day, late penalty, overtime; unmarked days count as present", () => {
    const s = summarizeAttendance(
      [
        { status: "ABSENT", overtimeHours: 0 }, { status: "ABSENT", overtimeHours: 0 }, { status: "HALF_DAY", overtimeHours: 0 },
        { status: "LATE", overtimeHours: 0 }, { status: "LATE", overtimeHours: 0 }, { status: "LATE", overtimeHours: 0 }, { status: "LATE", overtimeHours: 2 },
        { status: "LEAVE", overtimeHours: 0 }, { status: "UNPAID_LEAVE", overtimeHours: 0 }, { status: "PRESENT", overtimeHours: 3.5 },
      ],
      3, 26,
    );
    expect(s).toMatchObject({ absent: 2, halfDays: 1, late: 4, latePenaltyDays: 1, leave: 1, unpaidLeave: 1, overtimeHours: 5.5 });
    expect(s.deductedDays).toBe(4.5); // 2 + 1 + 0.5 + 1
    expect(s.present).toBe(21.5); // 26 − 2 − 1 − 1 − 0.5
    expect(summarizeAttendance([{ status: "LATE", overtimeHours: 0 }], 0, 26).deductedDays).toBe(0); // late penalty off
  });
});

describe("salary calculation", () => {
  it("full month, no exceptions: basic + allowances = gross; PF % of basic", () => {
    const r = calculatePayslip(base());
    expect(amt(r, "মূল বেতন")).toBe(20000);
    expect(amt(r, "বাড়ি ভাড়া")).toBe(10000);
    expect(amt(r, "চিকিৎসা")).toBe(1500);
    expect(r.gross).toBe(32500);
    expect(amt(r, "ভবিষ্য তহবিল")).toBe(1000);
    expect(r.totalDeductions).toBe(1000);
    expect(r.net).toBe(31500);
    expect(r.payableDays).toBe(26);
  });

  it("absence, half day and late deduction from basic; overtime at 2× basic hourly rate; advance capped by outstanding", () => {
    const r = calculatePayslip(base({ attendance: att({ ABSENT: 2, HALF_DAY: 1, LATE: 4 }, 10), advances: [{ id: "a1", kind: "ADVANCE", installment: 2000, outstanding: 1500 }] }));
    // overtime: 20000 / (26 × 8) × 2 = 192.31 per hour × 10
    expect(r.overtimeRate).toBe(192.31);
    expect(amt(r, "ওভারটাইম")).toBe(1923.1);
    expect(r.gross).toBe(34423.1);
    // 3.5 days × 20000 / 26
    expect(r.deductedDays).toBe(3.5);
    expect(amt(r, "অনুপস্থিতি কর্তন")).toBe(2692.31);
    expect(r.lines.find((l) => l.advanceId === "a1")?.amount).toBe(1500);
    expect(r.totalDeductions).toBe(5192.31);
    expect(r.net).toBe(29230.79);
    expect(r.payableDays).toBe(22.5);
  });

  it("explicit overtime rate, extra hours from review; not eligible → no overtime", () => {
    const r = calculatePayslip(base({ attendance: att({}, 4), extraOvertimeHours: 2, overtime: { eligible: true, rate: 150 } }));
    expect(amt(r, "ওভারটাইম")).toBe(900);
    const n = calculatePayslip(base({ attendance: att({}, 4), overtime: { eligible: false, rate: null } }));
    expect(amt(n, "ওভারটাইম")).toBeUndefined();
    expect(n.warnings.length).toBe(1);
  });

  it("absence on GROSS basis", () => {
    const r = calculatePayslip(base({ settings: { ...S, absenceBasis: "GROSS" }, attendance: att({ ABSENT: 1 }) }));
    expect(amt(r, "অনুপস্থিতি কর্তন")).toBe(1250); // (20000 + 10000 + 1500 + 1000) / 26
  });

  it("joining mid-month prorates basic and allowances (fixed deductions are not prorated)", () => {
    const fraction = employedFraction(2026, 10, new Date("2026-10-17"), null).fraction; // 15 / 31
    const r = calculatePayslip(base({ fraction, structure: [...STRUCTURE, line("আয়কর", "DEDUCTION", "FIXED", 500, "TAX")] }));
    expect(amt(r, "মূল বেতন")).toBe(9677.42);
    expect(amt(r, "বাড়ি ভাড়া")).toBe(4838.71);
    expect(amt(r, "চিকিৎসা")).toBe(725.81);
    expect(amt(r, "আয়কর")).toBe(500);
    expect(r.payableDays).toBe(12.58);
  });

  it("manual lines (bonus, fine) and % of gross deduction", () => {
    const r = calculatePayslip(base({
      structure: [...STRUCTURE, line("কল্যাণ তহবিল", "DEDUCTION", "PERCENT_OF_GROSS", 1, "WELFARE")],
      manual: [
        { ...ref("বিশেষ বোনাস", "SALARY"), kind: "EARNING", amount: 2000, note: "লক্ষ্য পূরণ" },
        { ...ref("জরিমানা", "FINE_INC"), kind: "DEDUCTION", amount: 300 },
      ],
    }));
    expect(r.gross).toBe(34500);
    expect(amt(r, "কল্যাণ তহবিল")).toBe(345);
    expect(amt(r, "জরিমানা")).toBe(300);
    expect(r.lines.filter((l) => l.isManual).length).toBe(2);
    expect(r.net).toBe(34500 - 1000 - 345 - 300);
  });

  it("advance recovery never makes net negative; deductions beyond gross are rejected", () => {
    const r = calculatePayslip(base({ basic: 1000, structure: [], advances: [{ id: "L", kind: "LOAN", installment: 5000, outstanding: 9000 }] }));
    expect(r.lines.find((l) => l.advanceId === "L")?.amount).toBe(1000);
    expect(r.net).toBe(0);
    expect(r.warnings.length).toBe(1);
    expect(() => calculatePayslip(base({ basic: 1000, structure: [], manual: [{ ...ref("জরিমানা", "X"), kind: "DEDUCTION", amount: 5000 }] }))).toThrow(PayrollCalcError);
  });

  it("employer contributions (PF employer share, gratuity) are cost, not net; need a liability ledger", () => {
    const pf = line("PF (প্রতিষ্ঠান)", "EMPLOYER", "PERCENT_OF_BASIC", 10, "PF_EXP", { liabilityAccountId: "PF_PAY" });
    const r = calculatePayslip(base({ structure: [...STRUCTURE, pf] }));
    expect(r.employerCost).toBe(2000);
    expect(r.net).toBe(31500);
    expect(() => calculatePayslip(base({ structure: [{ ...pf, liabilityAccountId: null }] }))).toThrow(PayrollCalcError);
  });

  it("a component without a ledger cannot be calculated", () => {
    expect(() => calculatePayslip(base({ structure: [line("খাদ্য", "EARNING", "FIXED", 500, "")] }))).toThrow(/লেজার/);
    expect(() => calculatePayslip(base({ structure: [line("ভুল", "EARNING", "PERCENT_OF_GROSS", 5, "S")] }))).toThrow(PayrollCalcError);
  });

  it("festival bonus run: bonus components only, no attendance, no proration", () => {
    const r = calculatePayslip(base({ kind: "BONUS", fraction: 0.5, attendance: null, structure: [line("উৎসব ভাতা", "EARNING", "PERCENT_OF_BASIC", 100, "BONUS_EXP")] }));
    expect(r.lines.map((l) => [l.name, l.amount])).toEqual([["উৎসব ভাতা", 20000]]);
    expect(r.net).toBe(20000);
  });

  it("rules extension point: a registered rule computes a component", () => {
    PAY_RULES.TEST_TAX = { label: "test", compute: (c, v) => (c.gross > 30000 ? (c.gross - 30000) * (v / 100) : 0) };
    const r = calculatePayslip(base({ structure: [...STRUCTURE, line("উৎসে কর", "DEDUCTION", "RULE", 10, "TDS", { ruleKey: "TEST_TAX" })] }));
    expect(amt(r, "উৎসে কর")).toBe(250);
    delete PAY_RULES.TEST_TAX;
    expect(() => calculatePayslip(base({ structure: [line("x", "DEDUCTION", "RULE", 1, "T", { ruleKey: "NOPE" })] }))).toThrow(PayrollCalcError);
  });
});

describe("posting", () => {
  it("journal: Dr earnings & employer expense, Cr deductions, liabilities and Salary Payable — balanced", () => {
    const pf = line("PF (প্রতিষ্ঠান)", "EMPLOYER", "PERCENT_OF_BASIC", 10, "PF_EXP", { liabilityAccountId: "PF_PAY" });
    const a = calculatePayslip(base({ structure: [...STRUCTURE, pf], attendance: att({ ABSENT: 1 }), advances: [{ id: "a", kind: "ADVANCE", installment: 500, outstanding: 500 }] }));
    const b = calculatePayslip(base({ basic: 15000 }));
    const lines = payrollJournalLines([a, b], "PAYABLE", "বেতন");
    const prepared = prepareEntries(lines); // throws if unbalanced
    const sum = (id: string, side: "debit" | "credit") => prepared.filter((l) => l.accountId === id).reduce((s, l) => s + l[side], 0);
    expect(sum("SALARY", "debit")).toBe(a.gross + b.gross);
    expect(sum("SALARY", "credit")).toBe(769.23); // absence: 20000 / 26
    expect(sum("PF_PAY", "credit")).toBe(1000 + 750 + 2000); // employee 5% (both) + employer 10%
    expect(sum("PF_EXP", "debit")).toBe(2000);
    expect(sum("ADV", "credit")).toBe(500);
    expect(sum("PAYABLE", "credit")).toBe(Math.round((a.net + b.net) * 100) / 100);
  });
  it("payslip status", () => {
    expect(payslipStatus(100, 0)).toBe("UNPAID");
    expect(payslipStatus(100, 40)).toBe("PARTIAL");
    expect(payslipStatus(100, 100)).toBe("PAID");
    expect(payslipStatus(0, 0)).toBe("PAID");
  });
});
