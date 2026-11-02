import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma, num } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import {
  ensurePayrollSetup,
  postPayrollRun,
  calculatePayrollRun,
  saveEmployee,
} from "@/server/services/payroll";
import {
  detectTransferType,
  resolveDbblRoutingNumber,
  DBBL_DEFAULT_ROUTING,
  getBankSalaryAdviceData,
  generateDbblBankAdviceXlsx,
  generateDbblBankAdviceCsv,
} from "@/server/payroll-bank-advice";
import {
  buildDbblDisbursementPayload,
  getBankDisbursementPreview,
  executeBankDisbursement,
} from "@/server/services/bankDisbursement";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("Dutch-Bangla Bank (DBBL) & Rocket Salary Disbursement", () => {
  let ctx: Ctx;
  let dbblAccountId: string;
  const testPassword = "dbblSecurePin999!";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        name: "Corporate Payroll Officer",
        email: `dbbl_payroll_${Date.now()}@test.local`,
        passwordHash,
      },
    });

    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "ডিবিবিএল এন্টারপ্রাইজ লিমিটেড", ownerUserId: user.id })
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

    // Create a DBBL Bank Account for the company
    const bankGroup = await prisma.accountGroup.findFirstOrThrow({
      where: { businessId: ctx.businessId, nature: "ASSET", name: { contains: "ব্যাংক" } },
    });

    const dbblAccount = await prisma.account.create({
      data: {
        businessId: ctx.businessId,
        groupId: bankGroup.id,
        name: "ডাচ-বাংলা ব্যাংক চলতি হিসাব",
        nature: "ASSET",
        kind: "BANK",
        bankName: "Dutch-Bangla Bank PLC",
        accountNumber: "105.110.009876",
        isApiEnabled: true,
        apiProvider: "CUSTOM_BANK_API",
        apiEndpointUrl: "https://corporate.dutchbanglabank.com/api/v1/disburse",
        apiClientId: "dbbl_corp_client_88",
        apiClientSecret: "dbbl_corp_secret_key_88",
        corporateAccountNo: "105.110.009876",
      },
    });
    dbblAccountId = dbblAccount.id;

    // Set as default disbursement account in PayrollSettings
    await prisma.payrollSettings.update({
      where: { businessId: ctx.businessId },
      data: {
        disbursementAccountId: dbblAccount.id,
        isBankApiEnabled: true,
        bankCorporateAccountNo: "105.110.009876",
      },
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
      overtimeEligible: false,
      overtimeRate: null,
      notes: null,
      revisionNote: null,
      effectiveFrom: null,
      components: [],
      ...partial,
    });

    // 1. Employee with DBBL Bank Account
    await saveEmployee(
      ctx,
      makeEmp({
        code: "EMP-DBBL-1",
        name: "ফারহানা সুলতানা",
        basicSalary: 35000,
        joiningDate: D("2026-01-01"),
        paymentMethod: "BANK",
        bankName: "Dutch-Bangla Bank PLC",
        branchName: "Gulshan Branch",
        routingNo: "090261122",
        routingNumber: "090261122",
        bankAccountNo: "115.120.778899",
        bankAccountNumber: "115.120.778899",
        bankAccountName: "Farhana Sultana",
      })
    );

    // 2. Employee with Rocket MFS Wallet (12-digit number)
    await saveEmployee(
      ctx,
      makeEmp({
        code: "EMP-RCK-2",
        name: "আবু তাহের",
        basicSalary: 25000,
        joiningDate: D("2026-01-01"),
        paymentMethod: "ROCKET",
        bankName: "Rocket (DBBL)",
        branchName: "MFS",
        routingNo: null,
        routingNumber: null,
        bankAccountNo: "017551234567",
        bankAccountNumber: "017551234567",
        bankAccountName: "Abu Taher",
      })
    );

    // 3. Employee with Other Bank Account (BEFTN transfer)
    await saveEmployee(
      ctx,
      makeEmp({
        code: "EMP-BFT-3",
        name: "কাজী মাহবুব",
        basicSalary: 40000,
        joiningDate: D("2026-01-01"),
        paymentMethod: "BANK",
        bankName: "City Bank PLC",
        branchName: "Dhanmondi Branch",
        routingNo: "225271889",
        routingNumber: "225271889",
        bankAccountNo: "3101234567001",
        bankAccountNumber: "3101234567001",
        bankAccountName: "Kazi Mahbub",
      })
    );

    // Generate & finalize payroll for Nov 2026
    const { run } = await calculatePayrollRun(ctx, {
      year: 2026,
      month: 11,
      kind: "REGULAR",
      postingDate: D("2026-11-30"),
      note: "নভেম্বর ২০২৬ পে-রোল",
    });

    await postPayrollRun(ctx, run.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accurately detects transfer types for DBBL, Rocket, and BEFTN", () => {
    // Rocket checks
    expect(detectTransferType("Rocket", "017551234567", "ROCKET")).toBe("ROCKET");
    expect(detectTransferType(null, "018123456789", null)).toBe("ROCKET");
    expect(detectTransferType("রকেট ওয়ালেট", "019998887771", "MOBILE")).toBe("ROCKET");
    expect(detectTransferType(null, null, "MFS_ROCKET")).toBe("ROCKET");

    // DBBL checks
    expect(detectTransferType("Dutch-Bangla Bank PLC", "115.120.778899", "BANK")).toBe("DBBL");
    expect(detectTransferType("DBBL", "115120778899", "BANK")).toBe("DBBL");
    expect(detectTransferType("ডাচ-বাংলা ব্যাংক", "115.120.778899", "BANK")).toBe("DBBL");
    expect(detectTransferType("General Bank", "123456", "BANK", "090260000")).toBe("DBBL");

    // BEFTN checks
    expect(detectTransferType("Sonali Bank PLC", "00213456789", "BANK")).toBe("BEFTN");
    expect(detectTransferType("BRAC Bank", "1501209876543210", "BANK")).toBe("BEFTN");
  });

  it("resolves default DBBL routing code 090260000 for Rocket and DBBL accounts", () => {
    expect(resolveDbblRoutingNumber("ROCKET", null)).toBe(DBBL_DEFAULT_ROUTING);
    expect(resolveDbblRoutingNumber("ROCKET", "")).toBe(DBBL_DEFAULT_ROUTING);
    expect(resolveDbblRoutingNumber("DBBL", null)).toBe(DBBL_DEFAULT_ROUTING);
    expect(resolveDbblRoutingNumber("DBBL", "090261122")).toBe("090261122");
    expect(resolveDbblRoutingNumber("BEFTN", "225271889")).toBe("225271889");
  });

  it("generates 7-column DBBL bulk upload CSV matching corporate specifications", async () => {
    const data = await getBankSalaryAdviceData(ctx.businessId, {
      year: 2026,
      month: 11,
      bankAccountId: dbblAccountId,
    });

    const csv = generateDbblBankAdviceCsv(data);

    // Verify UTF-8 BOM
    expect(csv.startsWith("\uFEFF")).toBe(true);

    // Verify exact 7-column header
    expect(csv).toContain(
      '"Debit Account No","Beneficiary Account / Rocket No","Beneficiary Name","Transfer Type","Amount","Routing Number","Remarks"'
    );

    // Verify DBBL Account row
    expect(csv).toContain('"105.110.009876","115.120.778899","Farhana Sultana","DBBL","35000.00","090261122"');

    // Verify Rocket Wallet row (auto-resolves 090260000 routing)
    expect(csv).toContain('"105.110.009876","017551234567","Abu Taher","ROCKET","25000.00","090260000"');

    // Verify BEFTN row
    expect(csv).toContain('"105.110.009876","3101234567001","Kazi Mahbub","BEFTN","40000.00","225271889"');
  });

  it("generates 7-column DBBL bulk upload Excel (.xlsx) with text formatting", async () => {
    const data = await getBankSalaryAdviceData(ctx.businessId, {
      year: 2026,
      month: 11,
      bankAccountId: dbblAccountId,
    });

    const xlsxBuffer = await generateDbblBankAdviceXlsx(data);
    expect(xlsxBuffer).toBeInstanceOf(Buffer);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws).toBeDefined();

    // Check Row 1 Headers (exact 7 columns)
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual([
      "Debit Account No",
      "Beneficiary Account / Rocket No",
      "Beneficiary Name",
      "Transfer Type",
      "Amount",
      "Routing Number",
      "Remarks",
    ]);

    // Check rows count: 3 employees + 1 header = 4 rows
    expect(ws.rowCount).toBe(4);

    // Verify Row 2 (EMP-BFT-3: Kazi Mahbub - BEFTN)
    const row2 = ws.getRow(2);
    expect(row2.getCell(1).value).toBe("105.110.009876");
    expect(row2.getCell(1).numFmt).toBe("@"); // Text format preserves leading zeros
    expect(row2.getCell(2).value).toBe("3101234567001");
    expect(row2.getCell(2).numFmt).toBe("@");
    expect(row2.getCell(3).value).toBe("Kazi Mahbub");
    expect(row2.getCell(4).value).toBe("BEFTN");
    expect(row2.getCell(5).value).toBe(40000);
    expect(row2.getCell(6).value).toBe("225271889");
    expect(row2.getCell(6).numFmt).toBe("@");

    // Verify Row 3 (EMP-DBBL-1: Farhana Sultana - DBBL)
    const row3 = ws.getRow(3);
    expect(row3.getCell(1).value).toBe("105.110.009876");
    expect(row3.getCell(2).value).toBe("115.120.778899");
    expect(row3.getCell(3).value).toBe("Farhana Sultana");
    expect(row3.getCell(4).value).toBe("DBBL");
    expect(row3.getCell(5).value).toBe(35000);
    expect(row3.getCell(6).value).toBe("090261122");

    // Verify Row 4 (EMP-RCK-2: Abu Taher - Rocket)
    const row4 = ws.getRow(4);
    expect(row4.getCell(1).value).toBe("105.110.009876");
    expect(row4.getCell(2).value).toBe("017551234567");
    expect(row4.getCell(3).value).toBe("Abu Taher");
    expect(row4.getCell(4).value).toBe("ROCKET");
    expect(row4.getCell(5).value).toBe(25000);
    expect(row4.getCell(6).value).toBe("090260000"); // Auto-resolved DBBL routing
  });

  it("builds standard DBBL Account, Rocket MFS B2C, and BEFTN API payloads", () => {
    // 1. Rocket payload
    const rckPayload = buildDbblDisbursementPayload({
      corporateAccountNo: "105.110.009876",
      idempotencyKey: "idemp-rck-1",
      beneficiaryName: "Abu Taher",
      accountNumber: "017551234567",
      paymentMethod: "ROCKET",
      amount: 25000,
      periodLabel: "2026-11",
    });
    expect(rckPayload.service_type).toBe("ROCKET_MFS_B2C");
    expect(rckPayload.transfer_type).toBe("ROCKET");
    expect(rckPayload.corporate_account).toBe("105.110.009876");
    expect(rckPayload.beneficiary.wallet_number).toBe("017551234567");
    expect(rckPayload.beneficiary.mfs_provider).toBe("ROCKET");
    expect(rckPayload.routing_no).toBe(DBBL_DEFAULT_ROUTING);
    expect(rckPayload.amount).toBe(25000);

    // 2. DBBL Account payload
    const dblPayload = buildDbblDisbursementPayload({
      corporateAccountNo: "105.110.009876",
      idempotencyKey: "idemp-dbl-2",
      beneficiaryName: "Farhana Sultana",
      accountNumber: "115.120.778899",
      bankName: "Dutch-Bangla Bank PLC",
      branchName: "Gulshan Branch",
      routingNumber: "090261122",
      amount: 35000,
      periodLabel: "2026-11",
    });
    expect(dblPayload.service_type).toBe("DBBL_ACCOUNT_TRANSFER");
    expect(dblPayload.transfer_type).toBe("DBBL");
    expect(dblPayload.beneficiary.account_number).toBe("115.120.778899");
    expect(dblPayload.beneficiary.bank_name).toBe("Dutch-Bangla Bank PLC");
    expect(dblPayload.routing_no).toBe("090261122");

    // 3. BEFTN payload
    const bftPayload = buildDbblDisbursementPayload({
      corporateAccountNo: "105.110.009876",
      idempotencyKey: "idemp-bft-3",
      beneficiaryName: "Kazi Mahbub",
      accountNumber: "3101234567001",
      bankName: "City Bank PLC",
      branchName: "Dhanmondi Branch",
      routingNumber: "225271889",
      amount: 40000,
      periodLabel: "2026-11",
    });
    expect(bftPayload.service_type).toBe("DBBL_BEFTN_TRANSFER");
    expect(bftPayload.transfer_type).toBe("BEFTN");
    expect(bftPayload.routing_no).toBe("225271889");
  });

  it("previews DBBL & Rocket disbursement and displays ready statuses", async () => {
    const preview = await getBankDisbursementPreview(ctx, {
      year: 2026,
      month: 11,
      bankAccountId: dbblAccountId,
    });

    expect(preview.summary.totalEmployees).toBe(3);
    expect(preview.summary.totalAmount).toBe(100000); // 35,000 + 25,000 + 40,000
    expect(preview.summary.readyCount).toBe(3);
    expect(preview.summary.missingInfoCount).toBe(0);

    const empRck = preview.employees.find((e) => e.code === "EMP-RCK-2");
    expect(empRck?.transferType).toBe("ROCKET");
    expect(empRck?.isReady).toBe(true); // Rocket does not fail on routing requirement
    expect(empRck?.routingNumber).toBe(DBBL_DEFAULT_ROUTING);

    const empDbl = preview.employees.find((e) => e.code === "EMP-DBBL-1");
    expect(empDbl?.transferType).toBe("DBBL");
    expect(empDbl?.isReady).toBe(true);

    const empBft = preview.employees.find((e) => e.code === "EMP-BFT-3");
    expect(empBft?.transferType).toBe("BEFTN");
    expect(empBft?.isReady).toBe(true);
  });

  it("executes disbursement and generates authentic DBBL and Rocket transaction credentials", async () => {
    const result = await executeBankDisbursement(ctx, {
      year: 2026,
      month: 11,
      bankAccountId: dbblAccountId,
      securityPin: testPassword,
      reference: "DBBL-NOV-2026",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("SUCCESS");
    expect(result.successCount).toBe(3);
    expect(result.successfulAmount).toBe(100000);
    expect(result.voucherNo).toBeDefined();

    // Check transaction IDs for DBBL and Rocket
    const rckTransfer = result.transfers.find((t) => t.accountNumber === "017551234567");
    expect(rckTransfer?.bankTxId).toMatch(/^TXN-RCK-/);
    expect(rckTransfer?.status).toBe("SUCCESS");

    const dblTransfer = result.transfers.find((t) => t.accountNumber === "115.120.778899");
    expect(dblTransfer?.bankTxId).toMatch(/^TXN-DBL-/);
    expect(dblTransfer?.status).toBe("SUCCESS");

    const bftTransfer = result.transfers.find((t) => t.accountNumber === "3101234567001");
    expect(bftTransfer?.bankTxId).toMatch(/^TXN-(CUS|BFT)-/);
    expect(bftTransfer?.status).toBe("SUCCESS");

    // Verify ledger balance: bank credited with total 100,000
    const entries = await prisma.journalEntry.findMany({
      where: { businessId: ctx.businessId, accountId: dbblAccountId },
    });
    const creditTotal = entries.reduce((s, e) => s + num(e.credit), 0);
    expect(creditTotal).toBe(100000);

    // Verify all payslips paid
    const payslips = await prisma.payslip.findMany({
      where: { businessId: ctx.businessId, year: 2026, month: 11 },
    });
    for (const p of payslips) {
      expect(num(p.paidAmount)).toBe(num(p.net));
    }
  });
});
