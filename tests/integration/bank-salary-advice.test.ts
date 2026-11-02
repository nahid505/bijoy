import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, num } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { ensurePayrollSetup, postPayrollRun, calculatePayrollRun, saveEmployee } from "@/server/services/payroll";
import {
  getBankSalaryAdviceData,
  generateBankAdviceXlsx,
  generateBankAdviceCsv,
  postBankSalaryAdvicePayment,
} from "@/server/payroll-bank-advice";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("Bank Salary Advice Sheet (ব্যাংক স্যালারি অ্যাডভাইস শিট)", () => {
  let ctx: Ctx;
  let bankAccountId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "HR Manager", email: `bankadvice${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "ব্যাংক স্যালারি লিমিটেড", ownerUserId: user.id })
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

    // Create a Bank Account for the company
    const bankGroup = await prisma.accountGroup.findFirstOrThrow({
      where: { businessId: ctx.businessId, nature: "ASSET", name: { contains: "ব্যাংক" } },
    });

    const bankAccount = await prisma.account.create({
      data: {
        businessId: ctx.businessId,
        groupId: bankGroup.id,
        name: "ডাচ-বাংলা ব্যাংক (প্রধান হিসাব)",
        nature: "ASSET",
        kind: "BANK",
        bankName: "Dutch-Bangla Bank Limited",
        accountNumber: "115.120.345678",
      },
    });
    bankAccountId = bankAccount.id;

    // Set as default disbursement account in PayrollSettings
    await prisma.payrollSettings.update({
      where: { businessId: ctx.businessId },
      data: { disbursementAccountId: bankAccountId },
    });

    // Create Employees with Bank details
    await saveEmployee(ctx, {
      code: "EMP-001",
      name: "মোহাম্মদ রফিকুল ইসলাম",
      mobile: "01711111111",
      email: null,
      address: "ঢাকা",
      nid: null,
      tin: null,
      departmentId: null,
      designation: "অফিসার",
      joiningDate: D("2026-01-01"),
      exitDate: null,
      status: "ACTIVE",
      basicSalary: 30000,
      overtimeEligible: false,
      overtimeRate: null,
      paymentMethod: "BANK",
      bankName: "Sonali Bank PLC",
      branchName: "Motijheel Branch",
      routingNo: "200270011",
      routingNumber: "200270011",
      bankAccountNo: "00213456789",
      bankAccountNumber: "00213456789",
      bankAccountName: "Md. Rafiqul Islam",
      notes: null,
      components: [],
      revisionNote: null,
      effectiveFrom: null,
    });

    await saveEmployee(ctx, {
      code: "EMP-002",
      name: "নাজমুল হক",
      mobile: "01722222222",
      email: null,
      address: "চট্টগ্রাম",
      nid: null,
      tin: null,
      departmentId: null,
      designation: "ম্যানেজার",
      joiningDate: D("2026-01-01"),
      exitDate: null,
      status: "ACTIVE",
      basicSalary: 45000,
      overtimeEligible: false,
      overtimeRate: null,
      paymentMethod: "BANK",
      bankName: "BRAC Bank PLC",
      branchName: "Agrabad Branch",
      routingNo: "060271234",
      routingNumber: "060271234",
      bankAccountNo: "1501209876543210",
      bankAccountNumber: "1501209876543210",
      bankAccountName: "Nazmul Haque",
      notes: null,
      components: [],
      revisionNote: null,
      effectiveFrom: null,
    });

    // Calculate and post Payroll for Nov 2026
    const { run } = await calculatePayrollRun(ctx, {
      year: 2026,
      month: 11,
      kind: "REGULAR",
      postingDate: D("2026-11-30"),
      note: "নভেম্বর ২০২৬ বেতন",
    });

    await postPayrollRun(ctx, run.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("retrieves bank salary advice data with full corporate fields", async () => {
    const data = await getBankSalaryAdviceData(ctx.businessId, {
      year: 2026,
      month: 11,
      bankAccountId,
    });

    expect(data.totalEmployees).toBe(2);
    expect(data.totalNetAmount).toBe(75000); // 30,000 + 45,000
    expect(data.payingBank?.accountNumber).toBe("115.120.345678");

    const emp1 = data.items.find((i) => i.employeeCode === "EMP-001");
    expect(emp1).toBeDefined();
    expect(emp1?.beneficiaryName).toBe("Md. Rafiqul Islam");
    expect(emp1?.bankName).toBe("Sonali Bank PLC");
    expect(emp1?.branchName).toBe("Motijheel Branch");
    expect(emp1?.routingNumber).toBe("200270011");
    expect(emp1?.accountNumber).toBe("00213456789");
    expect(emp1?.netAmount).toBe(30000);
    expect(emp1?.narration).toBe("Salary for Nov-2026");

    const emp2 = data.items.find((i) => i.employeeCode === "EMP-002");
    expect(emp2?.beneficiaryName).toBe("Nazmul Haque");
    expect(emp2?.bankName).toBe("BRAC Bank PLC");
    expect(emp2?.routingNumber).toBe("060271234");
    expect(emp2?.netAmount).toBe(45000);
  });

  it("generates CSV format matching the 8 corporate bank upload columns", async () => {
    const data = await getBankSalaryAdviceData(ctx.businessId, { year: 2026, month: 11 });
    const csv = generateBankAdviceCsv(data);

    expect(csv).toContain('"SL No","Beneficiary Name","Account Number","Bank Name","Branch Name","Routing Number","Net Salary Amount","Narration / Remarks"');
    expect(csv).toContain("Md. Rafiqul Islam");
    expect(csv).toContain("00213456789");
    expect(csv).toContain("200270011");
    expect(csv).toContain("30000.00");
    expect(csv).toContain("Nazmul Haque");
    expect(csv).toContain("1501209876543210");
    expect(csv).toContain("Salary for Nov-2026");
  });

  it("generates Excel XLSX buffer with worksheet and cells", async () => {
    const data = await getBankSalaryAdviceData(ctx.businessId, { year: 2026, month: 11 });
    const xlsxBuffer = await generateBankAdviceXlsx(data);

    expect(xlsxBuffer).toBeInstanceOf(Buffer);
    expect(xlsxBuffer.length).toBeGreaterThan(1000);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws).toBeDefined();

    const headers: string[] = [];
    ws.getRow(6).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual([
      "SL No",
      "Beneficiary Name",
      "Account Number",
      "Bank Name",
      "Branch Name",
      "Routing Number",
      "Net Salary Amount",
      "Narration / Remarks",
    ]);
  });

  it("auto-posts salary payment from bank account to ledger and updates payslip balances", async () => {
    const result = await postBankSalaryAdvicePayment(ctx, {
      year: 2026,
      month: 11,
      bankAccountId,
      reference: "ADV-NOV-2026",
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyPaid).toBe(false);
    expect(result.paidCount).toBe(2);
    expect(result.totalAmount).toBe(75000);
    expect(result.voucherNo).toBeDefined();

    // Verify ledger balance: bank credited 75,000
    const bankEntries = await prisma.journalEntry.findMany({
      where: { businessId: ctx.businessId, accountId: bankAccountId },
    });
    const bankCreditTotal = bankEntries.reduce((s, e) => s + num(e.credit), 0);
    expect(bankCreditTotal).toBe(75000);

    // Verify payslips are now paid
    const payslips = await prisma.payslip.findMany({
      where: { businessId: ctx.businessId, year: 2026, month: 11 },
    });
    for (const p of payslips) {
      expect(num(p.paidAmount)).toBe(num(p.net));
    }

    // Attempting to post again returns alreadyPaid: true (idempotent)
    const secondPost = await postBankSalaryAdvicePayment(ctx, {
      year: 2026,
      month: 11,
      bankAccountId,
    });
    expect(secondPost.alreadyPaid).toBe(true);
  });
});
