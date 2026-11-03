import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma, num } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { ensurePayrollSetup, postPayrollRun, calculatePayrollRun, saveEmployee } from "@/server/services/payroll";
import {
  getBankDisbursementPreview,
  executeBankDisbursement,
  getBankTransferAuditLogs,
} from "@/server/services/bankDisbursement";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("Dual-Method Bank Disbursement & Direct API Integration", () => {
  let ctx: Ctx;
  let bankAccountId: string;
  let testUserId: string;
  const testPassword = "securePin123!";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        name: "Finance Controller",
        email: `directapi${Date.now()}@test.local`,
        passwordHash,
      },
    });
    testUserId = user.id;

    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "স্মার্ট টেক্সটাইল লিমিটেড", ownerUserId: user.id })
    );
    ctx = { businessId: business.id, userId: user.id };

    await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    await ensurePayrollSetup(ctx.businessId);

    const salaryAcc = await prisma.account.findFirstOrThrow({
      where: { businessId: ctx.businessId, systemKey: "SALARY" },
    });
    await prisma.payComponent.updateMany({
      where: { businessId: ctx.businessId, kind: "EARNING" },
      data: { accountId: salaryAcc.id },
    });

    // Create a Bank Account with API credentials enabled
    const bankGroup = await prisma.accountGroup.findFirstOrThrow({
      where: { businessId: ctx.businessId, nature: "ASSET", name: { contains: "ব্যাংক" } },
    });

    const bankAccount = await prisma.account.create({
      data: {
        businessId: ctx.businessId,
        groupId: bankGroup.id,
        name: "সিটি ব্যাংক কর্পোরেট হিসাব",
        nature: "ASSET",
        kind: "BANK",
        bankName: "City Bank PLC",
        accountNumber: "220.110.998877",
        isApiEnabled: true,
        apiProvider: "CUSTOM_BANK_API",
        apiEndpointUrl: "https://api.citybank.com.bd/v1/corporate/payout",
        apiClientId: "city_client_001",
        apiClientSecret: "city_secret_key_abc",
        corporateAccountNo: "220.110.998877",
      },
    });
    bankAccountId = bankAccount.id;

    // Set as default disbursement account in PayrollSettings
    await prisma.payrollSettings.update({
      where: { businessId: ctx.businessId },
      data: {
        disbursementAccountId: bankAccount.id,
        isBankApiEnabled: true,
        bankApiProvider: "CUSTOM_BANK_API",
      },
    });

    const makeEmp = (partial: any) => ({
      mobile: null,
      email: null,
      address: null,
      nid: null,
      tin: null,
      departmentId: null,
      designation: "কর্মকর্তা",
      exitDate: null,
      status: "ACTIVE" as const,
      overtimeEligible: false,
      overtimeRate: null,
      notes: null,
      revisionNote: null,
      effectiveFrom: null,
      components: [],
      ...partial,
    });

    // Create 3 Employees:
    // Emp 1: Full banking info (valid)
    await saveEmployee(ctx, makeEmp({
      code: "EMP-API-01",
      name: "মোহাম্মদ রফিক",
      joiningDate: D("2026-01-01"),
      basicSalary: 35000,
      paymentMethod: "BANK",
      bankName: "Dutch-Bangla Bank Limited",
      branchName: "মতিঝিল শাখা",
      routingNo: "125272345",
      bankAccountNo: "115.120.987654",
      bankAccountName: "MD RAFIQ",
    }));

    // Emp 2: Full banking info (valid)
    await saveEmployee(ctx, makeEmp({
      code: "EMP-API-02",
      name: "ফারহানা ইয়াসমিন",
      joiningDate: D("2026-01-01"),
      basicSalary: 45000,
      paymentMethod: "BANK",
      bankName: "BRAC Bank Limited",
      branchName: "গুলশান শাখা",
      routingNo: "060261122",
      bankAccountNo: "15012099887766",
      bankAccountName: "FARHANA YASMIN",
    }));

    // Emp 3: Missing bank account number (to test failure handling)
    await saveEmployee(ctx, makeEmp({
      code: "EMP-API-03",
      name: "কামাল হোসেন",
      joiningDate: D("2026-01-01"),
      basicSalary: 20000,
      paymentMethod: "BANK",
      bankName: null,
      branchName: null,
      routingNo: null,
      bankAccountNo: null,
      bankAccountName: null,
    }));

    // Run payroll for November 2026 and post it
    const calc = await calculatePayrollRun(ctx, {
      year: 2026,
      month: 11,
      kind: "REGULAR",
      postingDate: D("2026-11-30"),
    });

    await postPayrollRun(ctx, calc.run.id);
  });

  afterAll(async () => {
    if (ctx?.businessId) {
      await prisma.bankTransferLog.deleteMany({ where: { businessId: ctx.businessId } }).catch(() => {});
      await prisma.bankDisbursementBatch.deleteMany({ where: { businessId: ctx.businessId } }).catch(() => {});
      await prisma.salaryPayment.deleteMany({ where: { businessId: ctx.businessId } }).catch(() => {});
      await prisma.voucher.deleteMany({ where: { businessId: ctx.businessId } }).catch(() => {});
      await prisma.payslipLine.deleteMany({ where: { payslip: { businessId: ctx.businessId } } }).catch(() => {});
      await prisma.payslip.deleteMany({ where: { businessId: ctx.businessId } }).catch(() => {});
      await prisma.payrollRun.deleteMany({ where: { businessId: ctx.businessId } }).catch(() => {});
      await prisma.business.delete({ where: { id: ctx.businessId } }).catch(() => {});
    }
  });

  it("previews bank disbursement with balance, counts and employee readiness", async () => {
    const preview = await getBankDisbursementPreview(ctx, {
      year: 2026,
      month: 11,
      bankAccountId,
    });

    expect(preview.account.id).toBe(bankAccountId);
    expect(preview.account.isApiEnabled).toBe(true);
    expect(preview.account.apiProvider).toBe("CUSTOM_BANK_API");
    expect(preview.period.year).toBe(2026);
    expect(preview.period.month).toBe(11);

    // 3 employees in this run: 2 ready, 1 missing account info
    expect(preview.summary.totalEmployees).toBe(3);
    expect(preview.summary.readyCount).toBe(2);
    expect(preview.summary.missingInfoCount).toBe(1);
    expect(preview.summary.totalAmount).toBe(100000); // 35000 + 45000 + 20000

    const emp1 = preview.employees.find((e) => e.code === "EMP-API-01");
    expect(emp1?.isReady).toBe(true);
    expect(emp1?.amount).toBe(35000);

    const emp3 = preview.employees.find((e) => e.code === "EMP-API-03");
    expect(emp3?.isReady).toBe(false);
    expect(emp3?.missingReason).toBe("হিসাব নম্বর নেই");
  });

  it("fails execution when invalid security credentials are provided", async () => {
    await expect(
      executeBankDisbursement(ctx, {
        year: 2026,
        month: 11,
        bankAccountId,
        securityPin: "wrong-pin-1234",
      })
    ).rejects.toThrow("প্রদত্ত পাসওয়ার্ড, পিন বা ওটিপি কোডটি সঠিক নয়");
  });

  it("executes direct bank API payout, logs transactions, and posts ledger for valid transfers", async () => {
    const idempotencyKey = `test-disburse-${ctx.businessId}-2026-11`;

    const result = await executeBankDisbursement(ctx, {
      year: 2026,
      month: 11,
      bankAccountId,
      securityPin: testPassword,
      idempotencyKey,
    });

    expect(result.ok).toBe(true);
    // Emp 1 & 2 succeed, Emp 3 fails due to missing account
    expect(result.status).toBe("PARTIAL");
    expect(result.totalEmployees).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.successfulAmount).toBe(80000); // 35000 + 45000

    expect(result.voucherId).toBeDefined();
    expect(result.voucherNo).toMatch(/^PV-/);

    // Check individual employee results
    const transferEmp1 = result.transfers.find((t) => t.employeeName.includes("রফিক"));
    expect(transferEmp1?.status).toBe("SUCCESS");
    expect(transferEmp1?.bankTxId).toMatch(/^TXN-/);
    expect(transferEmp1?.utrNumber).toMatch(/^UTR/);

    const transferEmp3 = result.transfers.find((t) => t.employeeName.includes("কামাল"));
    expect(transferEmp3?.status).toBe("FAILED");
    expect(transferEmp3?.errorMessage).toBe("কর্মচারীর ব্যাংক হিসাব নম্বর অনুপস্থিত");

    // Check voucher posted to ledger
    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: result.voucherId! },
      include: { entries: true, salaryPayments: true },
    });

    expect(num(voucher.amount)).toBe(80000);
    expect(voucher.salaryPayments.length).toBe(2);

    // Verify debit to Salary Payable and credit to City Bank
    const drEntry = voucher.entries.find((e) => num(e.debit) > 0);
    const crEntry = voucher.entries.find((e) => num(e.credit) > 0);
    expect(drEntry?.debit).toEqual(expect.anything());
    expect(crEntry?.accountId).toBe(bankAccountId);
    expect(num(crEntry!.credit)).toBe(80000);
  });

  it("ensures idempotency: duplicate execution returns existing result without double-deduction", async () => {
    // Re-call using the same idempotency key from previous execution
    const idempotencyKey = `test-disburse-${ctx.businessId}-2026-11`;

    const duplicateRun = await executeBankDisbursement(ctx, {
      year: 2026,
      month: 11,
      bankAccountId,
      securityPin: testPassword,
      idempotencyKey,
    });

    expect(duplicateRun.ok).toBe(true);
    expect(duplicateRun.idempotent).toBe(true);
    expect(duplicateRun.totalEmployees).toBe(3);
    expect(duplicateRun.successCount).toBe(2);
    expect(duplicateRun.failedCount).toBe(1);
    expect(duplicateRun.voucherId).toBeDefined();
    expect(duplicateRun.voucherNo).toMatch(/^PV-/);
  });

  it("retrieves audit trail history for Bank API transfers", async () => {
    const { logs, total } = await getBankTransferAuditLogs(ctx, {
      year: 2026,
      month: 11,
    });

    expect(total).toBeGreaterThanOrEqual(3);
    const successfulLog = logs.find((l) => l.status === "SUCCESS");
    expect(successfulLog?.bankTxId).toBeDefined();
    expect(successfulLog?.utrNumber).toBeDefined();
    expect(successfulLog?.voucher).toBeDefined();
  });
});
