import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { periodLabel } from "@/lib/payroll";
import { paySalaries } from "./services/payroll";
import type { Ctx } from "./services/accounting";
import { UserError } from "./action-utils";

export const MONTH_NAMES_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export const periodLabelEn = (year: number, month: number) =>
  `${MONTH_NAMES_EN[month - 1] || month}-${year}`;

export const DBBL_DEFAULT_ROUTING = "090260000";

/**
 * Detects whether an employee's payment destination is DBBL Account, Rocket Wallet, or BEFTN.
 */
export function detectTransferType(
  bankName?: string | null,
  accountNo?: string | null,
  paymentMethod?: string | null,
  routingNo?: string | null
): "DBBL" | "ROCKET" | "BEFTN" {
  const normBank = (bankName || "").toLowerCase().trim();
  const normMethod = (paymentMethod || "").toUpperCase().trim();
  const cleanAcct = (accountNo || "").replace(/[^0-9]/g, "");

  // Rocket detection: payment method or bank name has rocket, or 12-digit number starting with 01
  if (
    normMethod === "ROCKET" ||
    normMethod === "MFS_ROCKET" ||
    normBank.includes("rocket") ||
    normBank.includes("রকেট") ||
    (cleanAcct.length === 12 && cleanAcct.startsWith("01"))
  ) {
    return "ROCKET";
  }

  // DBBL detection: bank name has Dutch-Bangla / DBBL or routing starts with 090
  if (
    normBank.includes("dutch") ||
    normBank.includes("dbbl") ||
    normBank.includes("ডাচ-বাংলা") ||
    (routingNo && routingNo.trim().startsWith("090"))
  ) {
    return "DBBL";
  }

  return "BEFTN";
}

/**
 * Resolves routing number: for DBBL or Rocket, defaults to 090260000 if not a valid DBBL branch routing code.
 */
export function resolveDbblRoutingNumber(
  transferType: "DBBL" | "ROCKET" | "BEFTN",
  employeeRouting?: string | null
): string {
  const cleaned = (employeeRouting || "").trim();
  if (transferType === "DBBL" || transferType === "ROCKET") {
    if (cleaned && cleaned.startsWith("090") && cleaned.length === 9) {
      return cleaned;
    }
    return DBBL_DEFAULT_ROUTING;
  }
  return cleaned || "—";
}

export interface BankAdviceItem {
  slNo: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  beneficiaryName: string;
  department: string;
  designation: string;
  bankName: string;
  branchName: string;
  routingNumber: string;
  accountNumber: string;
  paymentMethod: string;
  transferType: "DBBL" | "ROCKET" | "BEFTN";
  netAmount: number;
  paidAmount: number;
  dueAmount: number;
  narration: string;
}

export interface BankSalaryAdviceData {
  business: {
    id: string;
    name: string;
    address: string | null;
    mobile: string | null;
    email: string | null;
    tinNumber: string | null;
    logo: string | null;
    currencySymbol: string;
  };
  payingBank: {
    id: string;
    name: string;
    bankName: string | null;
    accountNumber: string | null;
  } | null;
  year: number;
  month: number;
  periodLabelBn: string;
  periodLabelEn: string;
  items: BankAdviceItem[];
  totalEmployees: number;
  totalNetAmount: number;
  totalDueAmount: number;
  totalPaidAmount: number;
  isFullyPaid: boolean;
}

/**
 * Retrieves the salary advice dataset for a given business, year and month.
 */
export async function getBankSalaryAdviceData(
  businessId: string,
  opts: { year: number; month: number; bankAccountId?: string | null }
): Promise<BankSalaryAdviceData> {
  const { year, month } = opts;

  const [business, settings, payingAccount] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, name: true, address: true, mobile: true, email: true, tinNumber: true, logo: true, currencySymbol: true },
    }),
    prisma.payrollSettings.findUnique({
      where: { businessId },
      select: { disbursementAccountId: true },
    }),
    opts.bankAccountId
      ? prisma.account.findFirst({
          where: { id: opts.bankAccountId, businessId },
          select: { id: true, name: true, bankName: true, accountNumber: true },
        })
      : null,
  ]);

  // If no payingAccount explicitly passed, fallback to default disbursementAccount or first BANK account
  let bank = payingAccount;
  if (!bank && settings?.disbursementAccountId) {
    bank = await prisma.account.findFirst({
      where: { id: settings.disbursementAccountId, businessId },
      select: { id: true, name: true, bankName: true, accountNumber: true },
    });
  }
  if (!bank) {
    bank = await prisma.account.findFirst({
      where: { businessId, kind: "BANK", isActive: true },
      select: { id: true, name: true, bankName: true, accountNumber: true },
    });
  }

  // Find all payslips for this month (from confirmed runs or all non-draft)
  const payslips = await prisma.payslip.findMany({
    where: {
      businessId,
      year,
      month,
      run: { status: "POSTED" },
    },
    include: {
      employee: {
        include: {
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { employee: { code: "asc" } },
    ],
  });

  const narrationDefault = `Salary for ${periodLabelEn(year, month)}`;

  const items: BankAdviceItem[] = payslips.map((p, idx) => {
    const e = p.employee;
    const net = round2(num(p.net));
    const paid = round2(num(p.paidAmount));
    const due = round2(Math.max(0, net - paid));
    const acct = e.bankAccountNo ?? e.bankAccountNumber ?? "";
    const routing = e.routingNo ?? e.routingNumber ?? "";
    const transferType = detectTransferType(e.bankName, acct, e.paymentMethod, routing);

    return {
      slNo: idx + 1,
      employeeId: e.id,
      employeeCode: e.code,
      employeeName: e.name,
      beneficiaryName: (e.bankAccountName || e.name).trim(),
      department: e.department?.name ?? "—",
      designation: e.designation ?? "—",
      bankName: e.bankName ?? "—",
      branchName: e.branchName ?? "—",
      routingNumber: routing || "—",
      accountNumber: acct || "—",
      paymentMethod: e.paymentMethod ?? "BANK",
      transferType,
      netAmount: net,
      paidAmount: paid,
      dueAmount: due,
      narration: narrationDefault,
    };
  });

  const totalNetAmount = round2(items.reduce((s, i) => s + i.netAmount, 0));
  const totalDueAmount = round2(items.reduce((s, i) => s + i.dueAmount, 0));
  const totalPaidAmount = round2(items.reduce((s, i) => s + i.paidAmount, 0));

  return {
    business,
    payingBank: bank,
    year,
    month,
    periodLabelBn: periodLabel(year, month),
    periodLabelEn: periodLabelEn(year, month),
    items,
    totalEmployees: items.length,
    totalNetAmount,
    totalDueAmount,
    totalPaidAmount,
    isFullyPaid: items.length > 0 && totalDueAmount <= 0.004,
  };
}

/**
 * Generates official corporate Excel spreadsheet (.xlsx) matching standard BEFTN / bank upload columns.
 */
export async function generateBankAdviceXlsx(data: BankSalaryAdviceData): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bijoy Lenden";

  const sheetName = `Salary-${data.periodLabelEn}`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName);

  // Title & Header info
  ws.addRow([data.business.name]).font = { bold: true, size: 14 };
  ws.addRow(["Bank Salary Advice Sheet"]).font = { bold: true, size: 12 };
  ws.addRow([`Period: ${data.periodLabelBn} (${data.periodLabelEn})`]);
  if (data.payingBank) {
    ws.addRow([`Debit Account: ${data.payingBank.name} ${data.payingBank.accountNumber ? `(A/C: ${data.payingBank.accountNumber})` : ""}`]);
  }
  ws.addRow([]);

  // Corporate bank upload columns:
  // 1. SL No, 2. Beneficiary Name, 3. Account Number, 4. Bank Name, 5. Branch Name, 6. Routing Number, 7. Net Salary Amount, 8. Narration / Remarks
  const headers = [
    "SL No",
    "Beneficiary Name",
    "Account Number",
    "Bank Name",
    "Branch Name",
    "Routing Number",
    "Net Salary Amount",
    "Narration / Remarks",
  ];

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } }; // Deep Navy
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });
  ws.views = [{ state: "frozen", ySplit: headerRow.number }];

  // Rows
  for (const item of data.items) {
    const row = ws.addRow([
      item.slNo,
      item.beneficiaryName,
      item.accountNumber,
      item.bankName,
      item.branchName,
      item.routingNumber,
      item.netAmount,
      item.narration,
    ]);

    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(2).alignment = { horizontal: "left" };
    row.getCell(3).alignment = { horizontal: "left" };
    row.getCell(3).numFmt = "@"; // Text format to preserve leading zeros in bank accounts
    row.getCell(4).alignment = { horizontal: "left" };
    row.getCell(5).alignment = { horizontal: "left" };
    row.getCell(6).alignment = { horizontal: "center" };
    row.getCell(6).numFmt = "@"; // Text format to preserve 9-digit routing numbers
    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(7).numFmt = "#,##0.00";
    row.getCell(8).alignment = { horizontal: "left" };

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  }

  // Total summary row
  const totalRow = ws.addRow([
    "Total",
    `Total Beneficiaries: ${data.totalEmployees}`,
    "",
    "",
    "",
    "",
    data.totalNetAmount,
    "",
  ]);

  totalRow.font = { bold: true };
  totalRow.getCell(1).alignment = { horizontal: "center" };
  totalRow.getCell(7).alignment = { horizontal: "right" };
  totalRow.getCell(7).numFmt = "#,##0.00";
  totalRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "double", color: { argb: "FF000000" } },
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  // Adjust column widths
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 24;
  ws.getColumn(4).width = 24;
  ws.getColumn(5).width = 20;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 20;
  ws.getColumn(8).width = 26;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvEscape(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '""';
  const str = String(s);
  const safe = /^[=+\-@\t\r]/.test(str) && !/^-?\d/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Generates standard BEFTN CSV export with UTF-8 BOM.
 */
export function generateBankAdviceCsv(data: BankSalaryAdviceData): string {
  const lines: string[] = [];

  // Headers: exactly 8 corporate bank upload columns
  lines.push([
    "SL No",
    "Beneficiary Name",
    "Account Number",
    "Bank Name",
    "Branch Name",
    "Routing Number",
    "Net Salary Amount",
    "Narration / Remarks",
  ].map(csvEscape).join(","));

  for (const item of data.items) {
    lines.push([
      item.slNo,
      item.beneficiaryName,
      item.accountNumber,
      item.bankName,
      item.branchName,
      item.routingNumber,
      item.netAmount.toFixed(2),
      item.narration,
    ].map(csvEscape).join(","));
  }

  // UTF-8 BOM (\uFEFF) ensures Excel opens Bangla names properly without garbled characters
  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Generates official DBBL and Rocket Corporate Bulk Upload spreadsheet (.xlsx)
 * with the exact 7-column layout expected by Dutch-Bangla Bank PLC.
 */
export async function generateDbblBankAdviceXlsx(data: BankSalaryAdviceData): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bijoy Lenden";

  const sheetName = `DBBL-Rocket-${data.periodLabelEn}`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName);

  const headers = [
    "Debit Account No",
    "Beneficiary Account / Rocket No",
    "Beneficiary Name",
    "Transfer Type",
    "Amount",
    "Routing Number",
    "Remarks",
  ];

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B6623" } }; // DBBL Corporate Green
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const debitAccountNo = data.payingBank?.accountNumber || "";
  const defaultRemarks = `Salary ${data.periodLabelEn}`;

  for (const item of data.items) {
    const routingNo = resolveDbblRoutingNumber(item.transferType, item.routingNumber);
    const row = ws.addRow([
      debitAccountNo,
      item.accountNumber,
      item.beneficiaryName,
      item.transferType,
      item.netAmount,
      routingNo,
      item.narration && item.narration.startsWith("Salary") ? item.narration : defaultRemarks,
    ]);

    row.height = 20;
    // Col A: Debit Account No
    row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    row.getCell(1).numFmt = "@"; // Text format to preserve leading zeros

    // Col B: Beneficiary Account / Rocket No
    row.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
    row.getCell(2).numFmt = "@"; // Text format to preserve 12 digits

    // Col C: Beneficiary Name
    row.getCell(3).alignment = { horizontal: "left", vertical: "middle" };

    // Col D: Transfer Type
    row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };

    // Col E: Amount
    row.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    row.getCell(5).numFmt = "#,##0.00";

    // Col F: Routing Number
    row.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(6).numFmt = "@"; // Text format to preserve 9 digits

    // Col G: Remarks
    row.getCell(7).alignment = { horizontal: "left", vertical: "middle" };

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  }

  // Adjust column widths
  ws.getColumn(1).width = 24; // Debit Account No
  ws.getColumn(2).width = 26; // Beneficiary Account / Rocket No
  ws.getColumn(3).width = 28; // Beneficiary Name
  ws.getColumn(4).width = 16; // Transfer Type
  ws.getColumn(5).width = 18; // Amount
  ws.getColumn(6).width = 18; // Routing Number
  ws.getColumn(7).width = 24; // Remarks

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Generates standard DBBL & Rocket Bulk Upload CSV export with UTF-8 BOM.
 */
export function generateDbblBankAdviceCsv(data: BankSalaryAdviceData): string {
  const lines: string[] = [];

  // Headers: exactly 7 DBBL bulk upload columns
  lines.push([
    "Debit Account No",
    "Beneficiary Account / Rocket No",
    "Beneficiary Name",
    "Transfer Type",
    "Amount",
    "Routing Number",
    "Remarks",
  ].map(csvEscape).join(","));

  const debitAccountNo = data.payingBank?.accountNumber || "";
  const defaultRemarks = `Salary ${data.periodLabelEn}`;

  for (const item of data.items) {
    const routingNo = resolveDbblRoutingNumber(item.transferType, item.routingNumber);
    const remarks = item.narration && item.narration.startsWith("Salary") ? item.narration : defaultRemarks;

    lines.push([
      debitAccountNo,
      item.accountNumber,
      item.beneficiaryName,
      item.transferType,
      item.netAmount.toFixed(2),
      routingNo,
      remarks,
    ].map(csvEscape).join(","));
  }

  // UTF-8 BOM (\uFEFF) ensures Excel and banking portals parse UTF-8 Bangla characters seamlessly
  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Posts salary payments to the ledger for the given advice month,
 * crediting the selected bank account and debiting Salary Payable.
 */
export async function postBankSalaryAdvicePayment(
  ctx: Ctx,
  input: {
    year: number;
    month: number;
    bankAccountId: string;
    date?: Date;
    reference?: string | null;
  }
) {
  const date = input.date ?? new Date();

  // Find unpaid payslips for this period
  const payslips = await prisma.payslip.findMany({
    where: {
      businessId: ctx.businessId,
      year: input.year,
      month: input.month,
      run: { status: "POSTED" },
    },
    select: {
      id: true,
      employeeId: true,
      employeeName: true,
      employeeCode: true,
      net: true,
      paidAmount: true,
    },
  });

  if (payslips.length === 0) {
    throw new UserError("এই মাসের কোনো অনুমোদিত (চূড়ান্ত) পে-স্লিপ পাওয়া যায়নি");
  }

  const unpaidItems = payslips
    .map((p) => {
      const due = round2(Math.max(0, num(p.net) - num(p.paidAmount)));
      return { employeeId: p.employeeId, amount: due };
    })
    .filter((p) => p.amount > 0.004);

  if (unpaidItems.length === 0) {
    return {
      ok: true,
      alreadyPaid: true,
      message: `${periodLabel(input.year, input.month)} মাসের সকল কর্মচারীর বেতন ইতিমধ্যে পরিশোধিত হয়েছে`,
      voucherId: null,
      paidCount: 0,
      totalAmount: 0,
    };
  }

  const totalAmount = round2(unpaidItems.reduce((s, i) => s + i.amount, 0));
  const reference = input.reference || `Salary Advice ${periodLabelEn(input.year, input.month)}`;
  const narration = `ব্যাংক স্যালারি পরিশোধ — ${periodLabel(input.year, input.month)} (${unpaidItems.length} জন)`;

  const voucher = await paySalaries(ctx, {
    date,
    cashAccountId: input.bankAccountId,
    reference,
    narration,
    items: unpaidItems,
  });

  return {
    ok: true,
    alreadyPaid: false,
    message: `${periodLabel(input.year, input.month)} মাসের ${unpaidItems.length} জন কর্মচারীর বেতন বাবদ ${totalAmount.toFixed(2)} টাকা সফলভাবে ব্যাংক থেকে পরিশোধ ও লেজারে পোস্টিং হয়েছে`,
    voucherId: voucher.id,
    voucherNo: voucher.voucherNo,
    paidCount: unpaidItems.length,
    totalAmount,
  };
}
