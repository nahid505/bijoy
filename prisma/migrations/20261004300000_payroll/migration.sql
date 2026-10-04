-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'PROBATION', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PayComponentKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER');

-- CreateEnum
CREATE TYPE "PayCalcType" AS ENUM ('FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS', 'RULE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'UNPAID_LEAVE', 'HALF_DAY', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "PayrollKind" AS ENUM ('REGULAR', 'BONUS');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "AdvanceKind" AS ENUM ('ADVANCE', 'LOAN');

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "businessId" TEXT NOT NULL,
    "workingDaysMode" TEXT NOT NULL DEFAULT 'FIXED',
    "fixedWorkingDays" INTEGER NOT NULL DEFAULT 26,
    "weeklyOffDays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "hoursPerDay" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "overtimeMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "lateDaysPerAbsence" INTEGER NOT NULL DEFAULT 3,
    "absenceBasis" TEXT NOT NULL DEFAULT 'BASIC',
    "salaryPayableAccountId" TEXT,
    "advanceAccountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "nid" TEXT,
    "tin" TEXT,
    "departmentId" TEXT,
    "designation" TEXT,
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "basicSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overtimeEligible" BOOLEAN NOT NULL DEFAULT true,
    "overtimeRate" DECIMAL(14,2),
    "paymentMethod" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayComponentKind" NOT NULL,
    "calcType" "PayCalcType" NOT NULL DEFAULT 'FIXED',
    "defaultValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ruleKey" TEXT,
    "appliesTo" "PayrollKind" NOT NULL DEFAULT 'REGULAR',
    "accountId" TEXT,
    "liabilityAccountId" TEXT,
    "systemKey" TEXT,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSalaryComponent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "calcType" "PayCalcType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "EmployeeSalaryComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "structure" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "kind" "PayrollKind" NOT NULL DEFAULT 'REGULAR',
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" TIMESTAMP(3) NOT NULL,
    "workingDays" INTEGER NOT NULL,
    "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalEmployer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "voucherId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "kind" "PayrollKind" NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "designation" TEXT,
    "departmentName" TEXT,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "workingDays" DECIMAL(6,2) NOT NULL,
    "payableDays" DECIMAL(6,2) NOT NULL,
    "presentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "absentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "leaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "unpaidLeaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "halfDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lateDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "holidays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "deductedDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "extraOvertimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtimeRate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL,
    "totalDeductions" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "employerCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "componentId" TEXT,
    "advanceId" TEXT,
    "kind" "PayComponentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountId" TEXT NOT NULL,
    "liabilityAccountId" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAdvance" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "AdvanceKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "installment" DECIMAL(14,2) NOT NULL,
    "voucherId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_businessId_name_key" ON "Department"("businessId", "name");

-- CreateIndex
CREATE INDEX "Employee_businessId_status_idx" ON "Employee"("businessId", "status");

-- CreateIndex
CREATE INDEX "Employee_businessId_departmentId_idx" ON "Employee"("businessId", "departmentId");

-- CreateIndex
CREATE INDEX "Employee_businessId_name_idx" ON "Employee"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_businessId_code_key" ON "Employee"("businessId", "code");

-- CreateIndex
CREATE INDEX "PayComponent_businessId_kind_idx" ON "PayComponent"("businessId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_businessId_name_key" ON "PayComponent"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_businessId_systemKey_key" ON "PayComponent"("businessId", "systemKey");

-- CreateIndex
CREATE INDEX "EmployeeSalaryComponent_componentId_idx" ON "EmployeeSalaryComponent"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSalaryComponent_employeeId_componentId_key" ON "EmployeeSalaryComponent"("employeeId", "componentId");

-- CreateIndex
CREATE INDEX "SalaryRevision_employeeId_effectiveFrom_idx" ON "SalaryRevision"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryRevision_businessId_idx" ON "SalaryRevision"("businessId");

-- CreateIndex
CREATE INDEX "Attendance_businessId_date_idx" ON "Attendance"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_voucherId_key" ON "PayrollRun"("voucherId");

-- CreateIndex
CREATE INDEX "PayrollRun_businessId_status_idx" ON "PayrollRun"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_businessId_year_month_kind_key" ON "PayrollRun"("businessId", "year", "month", "kind");

-- CreateIndex
CREATE INDEX "Payslip_businessId_year_month_idx" ON "Payslip"("businessId", "year", "month");

-- CreateIndex
CREATE INDEX "Payslip_runId_idx" ON "Payslip"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_employeeId_year_month_kind_key" ON "Payslip"("employeeId", "year", "month", "kind");

-- CreateIndex
CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");

-- CreateIndex
CREATE INDEX "PayslipLine_advanceId_idx" ON "PayslipLine"("advanceId");

-- CreateIndex
CREATE INDEX "PayslipLine_componentId_idx" ON "PayslipLine"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAdvance_voucherId_key" ON "EmployeeAdvance"("voucherId");

-- CreateIndex
CREATE INDEX "EmployeeAdvance_businessId_employeeId_idx" ON "EmployeeAdvance"("businessId", "employeeId");

-- CreateIndex
CREATE INDEX "SalaryPayment_businessId_employeeId_idx" ON "SalaryPayment"("businessId", "employeeId");

-- CreateIndex
CREATE INDEX "SalaryPayment_businessId_date_idx" ON "SalaryPayment"("businessId", "date");

-- CreateIndex
CREATE INDEX "SalaryPayment_voucherId_idx" ON "SalaryPayment"("voucherId");

-- CreateIndex
CREATE INDEX "SalaryPayment_payslipId_idx" ON "SalaryPayment"("payslipId");

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_salaryPayableAccountId_fkey" FOREIGN KEY ("salaryPayableAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_advanceAccountId_fkey" FOREIGN KEY ("advanceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalaryComponent" ADD CONSTRAINT "EmployeeSalaryComponent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalaryComponent" ADD CONSTRAINT "EmployeeSalaryComponent_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "EmployeeAdvance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAdvance" ADD CONSTRAINT "EmployeeAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAdvance" ADD CONSTRAINT "EmployeeAdvance_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

