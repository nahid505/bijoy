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
import { BUSINESS_COOKIE } from "@/server/auth";
import { createBusiness } from "@/server/services/bootstrap";
import { createSession } from "@/server/services/sessions";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import {
  ensurePayrollSetup,
  saveEmployee,
  saveAttendance,
  attendanceSummaries,
  calculatePayrollRun,
} from "@/server/services/payroll";
import {
  verifyAttendanceAction,
  bulkVerifyAttendanceAction,
  verifyVoucherAction,
  bulkVerifyVouchersAction,
} from "@/server/actions/verification";
import UnverifiedVouchersPage from "@/app/(app)/audit/unverified/page";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("Employee Attendance Verification (কর্মচারীদের দৈনিক হাজিরা অনুমোদন কিউ)", () => {
  let ctx: Ctx;
  let ownerUser: any;
  let e1Id: string;
  let e2Id: string;

  beforeAll(async () => {
    ownerUser = await prisma.user.create({
      data: { name: "Admin Boss", email: `attverify${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "হাজিরা অডিট লিমিটেড", ownerUserId: ownerUser.id })
    );
    ctx = { businessId: business.id, userId: ownerUser.id };

    await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    await ensurePayrollSetup(ctx.businessId);

    const salaryAcc = await prisma.account.findFirstOrThrow({
      where: { businessId: ctx.businessId, systemKey: "SALARY" },
    });
    await prisma.payComponent.updateMany({
      where: { businessId: ctx.businessId, kind: "EARNING" },
      data: { accountId: salaryAcc.id },
    });

    const makeEmp = (partial: any) => ({
      mobile: null,
      email: null,
      address: null,
      nid: null,
      tin: null,
      departmentId: null,
      designation: "স্টাফ",
      exitDate: null,
      status: "ACTIVE" as const,
      overtimeEligible: true,
      overtimeRate: null,
      notes: null,
      revisionNote: null,
      effectiveFrom: null,
      paymentMethod: "CASH" as const,
      bankName: null,
      branchName: null,
      routingNo: null,
      bankAccountNo: null,
      bankAccountName: null,
      components: [],
      ...partial,
    });

    // Create 2 test employees
    const emp1 = await saveEmployee(ctx, makeEmp({
      code: "EMP-001",
      name: "মোহাম্মদ করিম",
      designation: "অফিস সহকারী",
      joiningDate: D("2026-10-01"),
      basicSalary: 15000,
    }));
    e1Id = emp1.id;

    const emp2 = await saveEmployee(ctx, makeEmp({
      code: "EMP-002",
      name: "আব্দুল জলিল",
      designation: "ড্রাইভার",
      joiningDate: D("2026-10-01"),
      basicSalary: 12000,
    }));
    e2Id = emp2.id;
  });

  beforeEach(async () => {
    req.cookies.clear();
    const s = await createSession(prisma, ownerUser.id);
    const token = await createSessionToken(ownerUser.id, s.id);
    req.cookies.set(SESSION_COOKIE, token);
    req.cookies.set(BUSINESS_COOKIE, ctx.businessId);
  });

  it("1. saving daily attendance creates UNVERIFIED records by default", async () => {
    const testDate = D("2026-11-01");
    await saveAttendance(ctx, {
      date: testDate,
      rows: [
        { employeeId: e1Id, status: "PRESENT", overtimeHours: 2, lateMinutes: 0, note: "সাইট ভিজিট" },
        { employeeId: e2Id, status: "LATE", overtimeHours: 0, lateMinutes: 15, note: "যানজট" },
      ],
    });

    const records = await prisma.attendance.findMany({
      where: { businessId: ctx.businessId, date: testDate },
      orderBy: { employeeId: "asc" },
    });

    expect(records.length).toBe(2);
    expect(records[0].verificationStatus).toBe("UNVERIFIED");
    expect(records[0].verifiedById).toBeNull();
    expect(records[0].verifiedAt).toBeNull();
    expect(records[1].verificationStatus).toBe("UNVERIFIED");
  });

  it("2. verifyAttendanceAction approves attendance by date (att:YYYY-MM-DD)", async () => {
    const testDateStr = "2026-11-01";
    const res = await verifyAttendanceAction({
      id: `att:${testDateStr}`,
      status: "VERIFIED",
      note: "অনুমোদিত",
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("VERIFIED");

    const records = await prisma.attendance.findMany({
      where: { businessId: ctx.businessId, date: D(testDateStr) },
    });
    expect(records.length).toBe(2);
    expect(records.every((r) => r.verificationStatus === "VERIFIED")).toBe(true);
    expect(records.every((r) => r.verifiedById === ownerUser.id)).toBe(true);
    expect(records.every((r) => r.verifiedAt !== null)).toBe(true);
  });

  it("3. verifyAttendanceAction rejects attendance with note", async () => {
    const testDateStr = "2026-11-02";
    await saveAttendance(ctx, {
      date: D(testDateStr),
      rows: [
        { employeeId: e1Id, status: "ABSENT", overtimeHours: 0, lateMinutes: 0, note: "অনুপস্থিতি" },
      ],
    });

    const res = await verifyAttendanceAction({
      id: `att:${testDateStr}`,
      status: "REJECTED",
      note: "ভুল এন্ট্রি ছিল",
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("REJECTED");

    const record = await prisma.attendance.findFirstOrThrow({
      where: { businessId: ctx.businessId, employeeId: e1Id, date: D(testDateStr) },
    });
    expect(record.verificationStatus).toBe("REJECTED");
    expect(record.verificationNote).toBe("ভুল এন্ট্রি ছিল");
  });

  it("4. bulkVerifyAttendanceAction approves multiple dates", async () => {
    await saveAttendance(ctx, {
      date: D("2026-11-03"),
      rows: [{ employeeId: e1Id, status: "PRESENT", overtimeHours: 1, lateMinutes: 0, note: null }],
    });
    await saveAttendance(ctx, {
      date: D("2026-11-04"),
      rows: [{ employeeId: e2Id, status: "PRESENT", overtimeHours: 0, lateMinutes: 0, note: null }],
    });

    const res = await bulkVerifyAttendanceAction({
      ids: ["att:2026-11-03", "att:2026-11-04"],
      status: "VERIFIED",
    });

    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);

    const recs = await prisma.attendance.findMany({
      where: {
        businessId: ctx.businessId,
        date: { in: [D("2026-11-03"), D("2026-11-04")] },
      },
    });
    expect(recs.every((r) => r.verificationStatus === "VERIFIED")).toBe(true);
  });

  it("5. verifyVoucherAction and bulkVerifyVouchersAction seamlessly delegate att: IDs", async () => {
    await saveAttendance(ctx, {
      date: D("2026-11-05"),
      rows: [{ employeeId: e1Id, status: "PRESENT", overtimeHours: 0, lateMinutes: 0, note: null }],
    });

    // Single through verifyVoucherAction
    const resSingle = await verifyVoucherAction({
      voucherId: "att:2026-11-05",
      status: "VERIFIED",
    });
    expect(resSingle.ok).toBe(true);
    expect(resSingle.status).toBe("VERIFIED");

    await saveAttendance(ctx, {
      date: D("2026-11-06"),
      rows: [{ employeeId: e1Id, status: "PRESENT", overtimeHours: 0, lateMinutes: 0, note: null }],
    });

    // Bulk through bulkVerifyVouchersAction
    const resBulk = await bulkVerifyVouchersAction({
      voucherIds: ["att:2026-11-06"],
      status: "VERIFIED",
    });
    expect(resBulk.ok).toBe(true);
    expect(resBulk.count).toBe(1);
  });

  it("6. REJECTED attendance is excluded from payroll and summaries", async () => {
    // 2026-11-02 was rejected (ABSENT)
    const summaries = await attendanceSummaries(ctx.businessId, 2026, 11, { employeeId: e1Id });
    const e1Summary = summaries.items.find((i) => i.employee.id === e1Id);
    expect(e1Summary).toBeDefined();

    // The rejected ABSENT on 2026-11-02 must NOT be counted as absent!
    expect(e1Summary!.summary.absent).toBe(0);

    // Calculate payroll run for November 2026
    const run = await calculatePayrollRun(ctx, {
      year: 2026,
      month: 11,
      kind: "REGULAR",
      postingDate: D("2026-11-30"),
    });

    expect(run.employees).toBe(2);
    const slip1 = await prisma.payslip.findFirstOrThrow({
      where: { runId: run.run.id, employeeId: e1Id },
    });

    // Absent days should be 0 (since the rejected mark was excluded)
    expect(num(slip1.absentDays)).toBe(0);
    // Overtime from verified days (2h on 11-01 + 1h on 11-03 = 3h)
    expect(num(slip1.overtimeHours)).toBe(3);
  });

  it("7. unverified attendance renders correctly on approval queue page", async () => {
    // create 1 single employee attendance on 2026-11-10
    await saveAttendance(ctx, {
      date: D("2026-11-10"),
      rows: [{ employeeId: e1Id, status: "PRESENT", overtimeHours: 1.5, lateMinutes: 0, note: "সাইট ভিজিট" }],
    });
    // create bulk (2 employees) attendance on 2026-11-11
    await saveAttendance(ctx, {
      date: D("2026-11-11"),
      rows: [
        { employeeId: e1Id, status: "PRESENT", overtimeHours: 0, lateMinutes: 0, note: null },
        { employeeId: e2Id, status: "LATE", overtimeHours: 0, lateMinutes: 20, note: null },
      ],
    });

    const page = await UnverifiedVouchersPage({ searchParams: Promise.resolve({ type: "ATTENDANCE" }) });
    expect(page).toBeDefined();

    const allPage = await UnverifiedVouchersPage({ searchParams: Promise.resolve({}) });
    expect(allPage).toBeDefined();
  });
});
