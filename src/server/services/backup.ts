// Business backup (JSON, versioned, checksummed), validation and restore.
// Restore always creates a NEW business (ids remapped) inside one transaction —
// it can never overwrite or corrupt existing books.
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { UserError } from "@/lib/errors";
import { ensureDefaultRoles } from "./bootstrap";
import { revalueProducts } from "./posting";
import { trialBalance } from "./report";

export const BACKUP_FORMAT = "bijoy-lenden-backup";
export const BACKUP_VERSION = 4;
const SUPPORTED_VERSIONS = [2, 3, 4]; // v2 (before batches / notifications) and v3 (before payroll) files can still be restored

const TABLES = [
  "accountGroups", "accounts", "units", "categories", "brands", "warehouses", "products", "customers", "suppliers",
  "vouchers", "journalEntries", "voucherItems", "voucherPayments", "stockMovements", "counters",
] as const;
const V3_TABLES = ["productBatches", "notifications"] as const;
type Table = (typeof TABLES)[number] | (typeof V3_TABLES)[number];
type Row = Record<string, unknown>;
/** v4: payroll (employees, structures, attendance, runs, payslips, advances, salary payments). */
const PAYROLL_TABLES = ["departments", "employees", "payComponents", "employeeComponents", "salaryRevisions", "attendances", "payrollRuns", "payslips", "payslipLines", "advances", "salaryPayments"] as const;
type PayrollData = { settings: Row | null } & Record<(typeof PAYROLL_TABLES)[number], Row[]>;
export type BackupData = { business: Row; smsTemplates?: Row[]; smsSettings?: Row | null; payroll?: PayrollData } & Record<Table, Row[]>;

async function exportPayroll(businessId: string): Promise<PayrollData> {
  const where = { businessId };
  const [settings, departments, employees, payComponents, employeeComponents, salaryRevisions, attendances, payrollRuns, payslips, payslipLines, advances, salaryPayments] = await Promise.all([
    prisma.payrollSettings.findUnique({ where }),
    prisma.department.findMany({ where }),
    prisma.employee.findMany({ where }),
    prisma.payComponent.findMany({ where }),
    prisma.employeeSalaryComponent.findMany({ where: { employee: { businessId } } }),
    prisma.salaryRevision.findMany({ where }),
    prisma.attendance.findMany({ where }),
    prisma.payrollRun.findMany({ where }),
    prisma.payslip.findMany({ where }),
    prisma.payslipLine.findMany({ where: { payslip: { businessId } } }),
    prisma.employeeAdvance.findMany({ where }),
    prisma.salaryPayment.findMany({ where }),
  ]);
  return { settings, departments, employees, payComponents, employeeComponents, salaryRevisions, attendances, payrollRuns, payslips, payslipLines, advances, salaryPayments } as unknown as PayrollData;
}

const checksumOf = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

export async function exportBusiness(businessId: string) {
  const where = { businessId };
  const [business, accountGroups, accounts, units, categories, brands, warehouses, products, customers, suppliers, vouchers, journalEntries, voucherItems, voucherPayments, stockMovements, counters, productBatches, notifications] =
    await Promise.all([
      prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
      prisma.accountGroup.findMany({ where }),
      prisma.account.findMany({ where }),
      prisma.unit.findMany({ where }),
      prisma.category.findMany({ where }),
      prisma.brand.findMany({ where }),
      prisma.warehouse.findMany({ where }),
      prisma.product.findMany({ where }),
      prisma.customer.findMany({ where }),
      prisma.supplier.findMany({ where }),
      prisma.voucher.findMany({ where, orderBy: { createdAt: "asc" } }),
      prisma.journalEntry.findMany({ where }),
      prisma.voucherItem.findMany({ where: { voucher: { businessId } } }),
      prisma.voucherPayment.findMany({ where: { voucher: { businessId } } }),
      prisma.stockMovement.findMany({ where, orderBy: { createdAt: "asc" } }),
      prisma.counter.findMany({ where }),
      prisma.productBatch.findMany({ where }),
      prisma.notification.findMany({ where, orderBy: { createdAt: "asc" } }),
    ]);
  const [smsTemplates, smsSettingsRow, payroll] = await Promise.all([
    prisma.smsTemplate.findMany({ where }),
    // the encrypted API key, balance and on/off state are NOT exported (secrets stay on the server)
    prisma.smsSettings.findUnique({ where: { businessId }, select: { provider: true, senderId: true, lowBalanceThreshold: true, events: true, alertMobiles: true, expiryAlertDays: true, dueReminderEveryDays: true } }),
    exportPayroll(businessId),
  ]);
  const data = JSON.parse(
    JSON.stringify({ business, accountGroups, accounts, units, categories, brands, warehouses, products, customers, suppliers, vouchers, journalEntries, voucherItems, voucherPayments, stockMovements, counters, productBatches, notifications, smsTemplates, smsSettings: smsSettingsRow, payroll }),
  ) as BackupData;
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), checksum: checksumOf(data), data };
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
  businessName?: string;
  totals?: { debit: number; credit: number };
}

/** Structural + accounting validation of a backup file. Nothing is written. */
export function validateBackup(raw: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats: Record<string, number> = {};
  const file = raw as { format?: string; version?: number; checksum?: string; data?: BackupData };
  if (!file || typeof file !== "object") return { ok: false, errors: ["ফাইলটি বৈধ JSON নয়"], warnings, stats };
  if (file.format !== BACKUP_FORMAT) errors.push("এটি বিজয় লেনদেন ব্যাকআপ ফাইল নয়");
  if (!SUPPORTED_VERSIONS.includes(file.version ?? -1)) errors.push(`অসমর্থিত ব্যাকআপ সংস্করণ: ${file.version ?? "নেই"} (সমর্থিত ${SUPPORTED_VERSIONS.join(", ")})`);
  const data = file.data;
  if (!data || typeof data !== "object" || !data.business) return { ok: false, errors: [...errors, "ব্যাকআপে ব্যবসার তথ্য নেই"], warnings, stats };
  for (const t of [...TABLES, ...((file.version ?? 0) >= 3 ? V3_TABLES : [])]) {
    if (!Array.isArray(data[t])) errors.push(`"${t}" তালিকা নেই`);
    else stats[t] = data[t].length;
  }
  if (errors.length) return { ok: false, errors, warnings, stats };
  if (!file.checksum) errors.push("চেকসাম নেই");
  else if (checksumOf(data) !== file.checksum) errors.push("চেকসাম মেলেনি — ফাইলটি পরিবর্তিত বা ক্ষতিগ্রস্ত");
  if ((file.version ?? 0) < 3) {
    // v2 file: no batch / notification tables (added after the checksum check so it stays valid)
    data.productBatches = [];
    data.notifications = [];
  }

  const ids = (t: Table) => new Set(data[t].map((r) => r.id as string));
  const [groupIds, accountIds, unitIds, productIds, warehouseIds, voucherIds, itemIds] = [ids("accountGroups"), ids("accounts"), ids("units"), ids("products"), ids("warehouses"), ids("vouchers"), ids("voucherItems")];
  const ref = (cond: boolean, msg: string) => {
    if (!cond && errors.length < 50) errors.push(msg);
  };
  for (const a of data.accounts) ref(groupIds.has(a.groupId as string), `হিসাব "${a.name}" এর গ্রুপ পাওয়া যায়নি`);
  for (const p of data.products) ref(unitIds.has(p.unitId as string), `পণ্য "${p.name}" এর ইউনিট পাওয়া যায়নি`);
  for (const c of [...data.customers, ...data.suppliers]) ref(accountIds.has(c.accountId as string), `পার্টি "${c.name}" এর লেজার পাওয়া যায়নি`);
  for (const e of data.journalEntries) ref(voucherIds.has(e.voucherId as string) && accountIds.has(e.accountId as string), "জার্নাল এন্ট্রির ভাউচার/হিসাব পাওয়া যায়নি");
  for (const i of data.voucherItems) ref(voucherIds.has(i.voucherId as string) && productIds.has(i.productId as string), "ভাউচার লাইনের পণ্য/ভাউচার পাওয়া যায়নি");
  for (const p of data.voucherPayments) ref(voucherIds.has(p.voucherId as string) && accountIds.has(p.accountId as string), "পেমেন্ট লাইনের হিসাব/ভাউচার পাওয়া যায়নি");
  const batchIds = ids("productBatches");
  const supplierIds = ids("suppliers");
  for (const b of data.productBatches) {
    ref(productIds.has(b.productId as string), `ব্যাচ "${b.batchNo}" এর পণ্য পাওয়া যায়নি`);
    if (b.supplierId) ref(supplierIds.has(b.supplierId as string), `ব্যাচ "${b.batchNo}" এর সরবরাহকারী পাওয়া যায়নি`);
  }
  for (const i of data.voucherItems) if (i.batchId) ref(batchIds.has(i.batchId as string), "ভাউচার লাইনের ব্যাচ পাওয়া যায়নি");
  for (const m of data.stockMovements) {
    ref(productIds.has(m.productId as string) && warehouseIds.has(m.warehouseId as string), "স্টক মুভমেন্টের পণ্য/গুদাম পাওয়া যায়নি");
    if (m.voucherItemId) ref(itemIds.has(m.voucherItemId as string), "স্টক মুভমেন্টের ভাউচার লাইন পাওয়া যায়নি");
    if (m.batchId) ref(batchIds.has(m.batchId as string), "স্টক মুভমেন্টের ব্যাচ পাওয়া যায়নি");
  }
  for (const v of data.vouchers) if (v.adjustmentAccountId) ref(accountIds.has(v.adjustmentAccountId as string), "স্টক জার্নালের সমন্বয় হিসাব পাওয়া যায়নি");
  if ((file.version ?? 0) >= 4) {
    const pr = data.payroll;
    if (!pr || PAYROLL_TABLES.some((t) => !Array.isArray(pr[t]))) errors.push("বেতনের (payroll) তালিকা নেই");
    else {
      for (const t of PAYROLL_TABLES) stats[`payroll.${t}`] = pr[t].length;
      const pid = (t: (typeof PAYROLL_TABLES)[number]) => new Set(pr[t].map((r) => r.id as string));
      const [empIds, deptIds, compIds, runIds, slipIds, advIds] = [pid("employees"), pid("departments"), pid("payComponents"), pid("payrollRuns"), pid("payslips"), pid("advances")];
      for (const e of pr.employees) if (e.departmentId) ref(deptIds.has(e.departmentId as string), `কর্মচারী "${e.name}" এর বিভাগ পাওয়া যায়নি`);
      for (const c of pr.payComponents) for (const k of ["accountId", "liabilityAccountId"]) if (c[k]) ref(accountIds.has(c[k] as string), `বেতন উপাদান "${c.name}" এর লেজার পাওয়া যায়নি`);
      for (const r of pr.payrollRuns) if (r.voucherId) ref(voucherIds.has(r.voucherId as string), "বেতন হিসাবের ভাউচার পাওয়া যায়নি");
      for (const x of pr.payslips) ref(runIds.has(x.runId as string) && empIds.has(x.employeeId as string), "পে-স্লিপের কর্মচারী/বেতন হিসাব পাওয়া যায়নি");
      for (const l of pr.payslipLines) {
        ref(slipIds.has(l.payslipId as string) && accountIds.has(l.accountId as string), "পে-স্লিপ লাইনের লেজার পাওয়া যায়নি");
        if (l.componentId) ref(compIds.has(l.componentId as string), "পে-স্লিপ লাইনের উপাদান পাওয়া যায়নি");
        if (l.advanceId) ref(advIds.has(l.advanceId as string), "পে-স্লিপ লাইনের অগ্রিম পাওয়া যায়নি");
      }
      for (const a of pr.advances) ref(empIds.has(a.employeeId as string) && voucherIds.has(a.voucherId as string), "অগ্রিমের কর্মচারী/ভাউচার পাওয়া যায়নি");
      for (const x of pr.salaryPayments) ref(slipIds.has(x.payslipId as string) && voucherIds.has(x.voucherId as string), "বেতন পরিশোধের পে-স্লিপ/ভাউচার পাওয়া যায়নি");
    }
  }
  // THE accounting rule, per voucher
  const per = new Map<string, { d: number; c: number }>();
  let d = 0;
  let c = 0;
  for (const e of data.journalEntries) {
    const x = per.get(e.voucherId as string) ?? { d: 0, c: 0 };
    x.d += Number(e.debit);
    x.c += Number(e.credit);
    per.set(e.voucherId as string, x);
    d += Number(e.debit);
    c += Number(e.credit);
  }
  let unbalanced = 0;
  for (const x of per.values()) if (round2(x.d) !== round2(x.c)) unbalanced++;
  if (unbalanced) errors.push(`${unbalanced} টি ভাউচারে ডেবিট ≠ ক্রেডিট`);
  const keys = new Set(data.accounts.map((a) => a.systemKey).filter(Boolean));
  for (const k of ["CASH", "INVENTORY", "SALES", "COGS", "OPENING_EQUITY"]) if (!keys.has(k)) errors.push(`সিস্টেম হিসাব ${k} নেই`);
  if (!data.warehouses.length) errors.push("কোনো গুদাম নেই");
  if (data.vouchers.length === 0) warnings.push("ব্যাকআপে কোনো ভাউচার নেই");
  return { ok: errors.length === 0, errors, warnings, stats, businessName: String(data.business.name ?? ""), totals: { debit: round2(d), credit: round2(c) } };
}

/** Older (v2) backups only carry batch numbers on lines: create the ProductBatch rows and link them. */
async function linkLegacyBatches(tx: Prisma.TransactionClient, businessId: string) {
  await tx.$executeRaw`
    INSERT INTO "ProductBatch" ("id", "businessId", "productId", "batchNo", "expiryDate", "purchaseDate", "updatedAt")
    SELECT gen_random_uuid()::text, ${businessId}, m."productId", m."batchNo", MIN(m."expiryDate"), MIN(m."date"), CURRENT_TIMESTAMP
    FROM "StockMovement" m WHERE m."businessId" = ${businessId} AND m."batchNo" IS NOT NULL
    GROUP BY m."productId", m."batchNo"`;
  await tx.$executeRaw`UPDATE "StockMovement" m SET "batchId" = b."id" FROM "ProductBatch" b
    WHERE m."businessId" = ${businessId} AND b."productId" = m."productId" AND b."batchNo" = m."batchNo"`;
  await tx.$executeRaw`UPDATE "VoucherItem" i SET "batchId" = b."id" FROM "ProductBatch" b, "Voucher" v
    WHERE v."id" = i."voucherId" AND v."businessId" = ${businessId} AND b."productId" = i."productId" AND b."batchNo" = i."batchNo"`;
}

/** Restores a validated backup as a NEW business owned by `userId`. Returns the new business id. */
export async function restoreBackup(raw: unknown, userId: string): Promise<{ businessId: string; name: string }> {
  const report = validateBackup(raw);
  if (!report.ok) throw new UserError(`ব্যাকআপ যাচাই ব্যর্থ: ${report.errors.slice(0, 3).join("; ")}`);
  const data = (raw as { data: BackupData }).data;
  const map = new Map<string, string>();
  const id = (old: unknown) => {
    if (old === null || old === undefined) return null;
    const k = String(old);
    if (!map.has(k)) map.set(k, randomUUID());
    return map.get(k)!;
  };
  const must = (old: unknown) => id(old)!;
  const date = (v: unknown) => (v ? new Date(String(v)) : null);
  const b = data.business;

  return prisma.$transaction(
    async (tx) => {
      const name = `${String(b.name)} (রিস্টোর ${new Date().toISOString().slice(0, 10)})`;
      const business = await tx.business.create({
        data: {
          name, logo: (b.logo as string) ?? null, address: (b.address as string) ?? null, mobile: (b.mobile as string) ?? null, email: (b.email as string) ?? null,
          binNumber: (b.binNumber as string) ?? null, tinNumber: (b.tinNumber as string) ?? null, tradeLicense: (b.tradeLicense as string) ?? null,
          currency: String(b.currency ?? "BDT"), currencySymbol: String(b.currencySymbol ?? "৳"), fiscalYearStartMonth: Number(b.fiscalYearStartMonth ?? 7),
          booksStartDate: date(b.booksStartDate)!, invoicePrefix: String(b.invoicePrefix ?? "INV"), defaultVatPercent: Number(b.defaultVatPercent ?? 0),
          invoiceFooter: (b.invoiceFooter as string) ?? null, invoiceTerms: (b.invoiceTerms as string) ?? null, lockDate: date(b.lockDate),
          ...(Array.isArray(b.expiryWarningDays) ? { expiryWarningDays: (b.expiryWarningDays as unknown[]).map(Number) } : {}),
          allowExpiredSale: Boolean(b.allowExpiredSale),
        },
      });
      const businessId = business.id;
      await tx.accountGroup.createMany({ data: data.accountGroups.map((g) => ({ id: must(g.id), businessId, name: String(g.name), nature: g.nature as never, isDirect: Boolean(g.isDirect), systemKey: (g.systemKey as string) ?? null, sortOrder: Number(g.sortOrder ?? 0) })) });
      await tx.account.createMany({
        data: data.accounts.map((a) => ({
          id: must(a.id), businessId, groupId: must(a.groupId), name: String(a.name), code: (a.code as string) ?? null, nature: a.nature as never, kind: a.kind as never,
          systemKey: (a.systemKey as string) ?? null, isSystem: Boolean(a.isSystem), isActive: Boolean(a.isActive), description: (a.description as string) ?? null,
          bankName: (a.bankName as string) ?? null, accountNumber: (a.accountNumber as string) ?? null,
        })),
      });
      const baseUnits = data.units.filter((u) => !u.baseUnitId);
      const altUnits = data.units.filter((u) => u.baseUnitId);
      await tx.unit.createMany({ data: [...baseUnits, ...altUnits].map((u) => ({ id: must(u.id), businessId, name: String(u.name), baseUnitId: id(u.baseUnitId), factor: Number(u.factor ?? 1) })) });
      await tx.category.createMany({ data: data.categories.map((x) => ({ id: must(x.id), businessId, name: String(x.name) })) });
      await tx.brand.createMany({ data: data.brands.map((x) => ({ id: must(x.id), businessId, name: String(x.name) })) });
      await tx.warehouse.createMany({ data: data.warehouses.map((w) => ({ id: must(w.id), businessId, name: String(w.name), address: (w.address as string) ?? null, isDefault: Boolean(w.isDefault) })) });
      await tx.product.createMany({
        data: data.products.map((p) => ({
          id: must(p.id), businessId, name: String(p.name), code: (p.code as string) ?? null, barcode: (p.barcode as string) ?? null, categoryId: id(p.categoryId), brandId: id(p.brandId), unitId: must(p.unitId),
          purchasePrice: Number(p.purchasePrice), salePrice: Number(p.salePrice), wholesalePrice: Number(p.wholesalePrice ?? 0), minStock: Number(p.minStock ?? 0),
          openingStock: Number(p.openingStock ?? 0), openingRate: Number(p.openingRate ?? 0), stock: 0, avgCost: 0, trackBatch: Boolean(p.trackBatch), isActive: Boolean(p.isActive),
        })),
      });
      const party = (x: Row) => ({ id: must(x.id), businessId, accountId: must(x.accountId), name: String(x.name), mobile: (x.mobile as string) ?? null, email: (x.email as string) ?? null, address: (x.address as string) ?? null, notes: (x.notes as string) ?? null, creditDays: Number(x.creditDays ?? 0), isActive: Boolean(x.isActive) });
      await tx.customer.createMany({ data: data.customers.map((x) => ({ ...party(x), creditLimit: Number(x.creditLimit ?? 0), groupName: (x.groupName as string) ?? null })) });
      await tx.supplier.createMany({ data: data.suppliers.map(party) });
      await tx.voucher.createMany({
        data: data.vouchers.map((v) => ({
          id: must(v.id), businessId, type: v.type as never, voucherNo: String(v.voucherNo), date: date(v.date)!, reference: (v.reference as string) ?? null, narration: (v.narration as string) ?? null,
          partyAccountId: id(v.partyAccountId), cashAccountId: id(v.cashAccountId), warehouseId: id(v.warehouseId), subtotal: Number(v.subtotal), discount: Number(v.discount),
          vatPercent: Number(v.vatPercent), vatAmount: Number(v.vatAmount), amount: Number(v.amount), paidAmount: Number(v.paidAmount),
          sourceKey: v.sourceKey ? String(v.sourceKey).replace(/:([^:]+)$/, (_m, old) => `:${must(old)}`) : null,
          dueDate: date(v.dueDate), adjustmentAccountId: id(v.adjustmentAccountId), createdById: userId,
        })),
      });
      for (const v of data.vouchers.filter((x) => x.returnOfId)) await tx.voucher.update({ where: { id: must(v.id) }, data: { returnOfId: must(v.returnOfId) } });
      await tx.productBatch.createMany({
        data: data.productBatches.map((x) => ({
          id: must(x.id), businessId, productId: must(x.productId), batchNo: String(x.batchNo), mfgDate: date(x.mfgDate), expiryDate: date(x.expiryDate),
          supplierId: id(x.supplierId), purchaseDate: date(x.purchaseDate), purchasePrice: Number(x.purchasePrice ?? 0), salePrice: Number(x.salePrice ?? 0), quantity: 0,
        })),
      });
      await tx.voucherItem.createMany({
        data: data.voucherItems.map((i) => ({
          id: must(i.id), voucherId: must(i.voucherId), productId: must(i.productId), warehouseId: id(i.warehouseId), unitId: id(i.unitId), unitFactor: Number(i.unitFactor ?? 1),
          quantity: Number(i.quantity), baseQuantity: Number(i.baseQuantity), rate: Number(i.rate), discount: Number(i.discount ?? 0), amount: Number(i.amount),
          costRate: Number(i.costRate ?? 0), costAmount: Number(i.costAmount ?? 0), direction: Number(i.direction ?? 0), batchId: id(i.batchId), batchNo: (i.batchNo as string) ?? null, expiryDate: date(i.expiryDate), lineNo: Number(i.lineNo ?? 0),
        })),
      });
      await tx.voucherPayment.createMany({ data: data.voucherPayments.map((p) => ({ id: must(p.id), voucherId: must(p.voucherId), accountId: must(p.accountId), amount: Number(p.amount), reference: (p.reference as string) ?? null, lineNo: Number(p.lineNo ?? 0) })) });
      await tx.journalEntry.createMany({
        data: data.journalEntries.map((e) => ({ id: must(e.id), businessId, voucherId: must(e.voucherId), accountId: must(e.accountId), date: date(e.date)!, debit: Number(e.debit), credit: Number(e.credit), narration: (e.narration as string) ?? null, lineNo: Number(e.lineNo ?? 0) })),
      });
      await tx.stockMovement.createMany({
        data: data.stockMovements.map((m) => ({
          id: must(m.id), businessId, productId: must(m.productId), warehouseId: must(m.warehouseId), voucherId: id(m.voucherId), voucherItemId: id(m.voucherItemId), type: m.type as never,
          date: date(m.date)!, quantityIn: Number(m.quantityIn), quantityOut: Number(m.quantityOut), unitCost: Number(m.unitCost), value: Number(m.value),
          batchId: id(m.batchId), batchNo: (m.batchNo as string) ?? null, expiryDate: date(m.expiryDate), createdAt: date(m.createdAt) ?? undefined,
        })),
      });
      if (data.productBatches.length === 0) await linkLegacyBatches(tx, businessId); // v2 file: rebuild lots from batch numbers
      // alert history: dedupe keys embed batch / product / account ids, which are remapped too
      const remapKey = (text: string) => text.replace(/[A-Za-z0-9_-]{20,}/g, (token) => map.get(token) ?? token);
      await tx.notification.createMany({
        data: data.notifications.map((n) => ({
          id: must(n.id), businessId, kind: n.kind as never, severity: n.severity as never, dedupeKey: remapKey(String(n.dedupeKey)),
          title: String(n.title), message: String(n.message), link: n.link ? remapKey(String(n.link)) : null,
          productId: id(n.productId), batchId: id(n.batchId), accountId: id(n.accountId), level: n.level === null || n.level === undefined ? null : Number(n.level),
          quantity: n.quantity === null || n.quantity === undefined ? null : Number(n.quantity), amount: n.amount === null || n.amount === undefined ? null : Number(n.amount),
          dueOn: date(n.dueOn), createdAt: date(n.createdAt) ?? undefined, resolvedAt: date(n.resolvedAt),
        })),
      });
      await tx.counter.createMany({ data: data.counters.map((c) => ({ businessId, key: String(c.key), value: Number(c.value) })) });
      if (data.payroll) await restorePayroll(tx, businessId, data.payroll, { id, must, date, userId });
      // SMS: templates as they were; settings switched OFF and without any API key, so a restored
      // copy can never start sending SMS on its own
      if (Array.isArray(data.smsTemplates)) {
        await tx.smsTemplate.createMany({ data: data.smsTemplates.map((t) => ({ businessId, event: String(t.event), body: String(t.body) })) });
      }
      if (data.smsSettings) {
        const ss = data.smsSettings;
        await tx.smsSettings.create({
          data: {
            businessId, enabled: false, provider: String(ss.provider ?? "platform"), senderId: (ss.senderId as string) ?? null, lowBalanceThreshold: Number(ss.lowBalanceThreshold ?? 100),
            events: Array.isArray(ss.events) ? (ss.events as unknown[]).map(String) : undefined, alertMobiles: Array.isArray(ss.alertMobiles) ? (ss.alertMobiles as unknown[]).map(String) : [],
            expiryAlertDays: Array.isArray(ss.expiryAlertDays) ? (ss.expiryAlertDays as unknown[]).map(Number) : undefined, dueReminderEveryDays: Number(ss.dueReminderEveryDays ?? 7),
          },
        });
      }

      // access: default roles + restoring user as Owner
      await ensureDefaultRoles(tx, businessId);
      const owner = await tx.role.findFirstOrThrow({ where: { businessId, isSystem: true } });
      await tx.membership.create({ data: { businessId, userId, roleId: owner.id } });

      // rebuild stock caches and verify
      await revalueProducts(tx, businessId, data.products.map((p) => must(p.id)));
      return { businessId, name };
    },
    { timeout: 300_000, maxWait: 20_000 },
  ).then(async (r) => {
    const tb = await trialBalance(r.businessId, {});
    if (!tb.balanced) throw new UserError("রিস্টোরের পর ট্রায়াল ব্যালেন্স মেলেনি");
    return r;
  });
}

/** Payroll rows of a v4 backup, ids remapped like everything else (payroll voucher source keys included). */
async function restorePayroll(
  tx: Prisma.TransactionClient,
  businessId: string,
  pr: PayrollData,
  h: { id: (old: unknown) => string | null; must: (old: unknown) => string; date: (v: unknown) => Date | null; userId: string },
) {
  const { id, must, date, userId } = h;
  const n = (v: unknown) => Number(v ?? 0);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  if (pr.settings) {
    const x = pr.settings;
    await tx.payrollSettings.create({
      data: {
        businessId, workingDaysMode: String(x.workingDaysMode ?? "FIXED"), fixedWorkingDays: n(x.fixedWorkingDays ?? 26),
        weeklyOffDays: Array.isArray(x.weeklyOffDays) ? (x.weeklyOffDays as unknown[]).map(Number) : [5],
        hoursPerDay: n(x.hoursPerDay ?? 8), overtimeMultiplier: n(x.overtimeMultiplier ?? 2), lateDaysPerAbsence: n(x.lateDaysPerAbsence ?? 3), absenceBasis: String(x.absenceBasis ?? "BASIC"),
        salaryPayableAccountId: id(x.salaryPayableAccountId), advanceAccountId: id(x.advanceAccountId),
      },
    });
  }
  await tx.department.createMany({ data: pr.departments.map((d) => ({ id: must(d.id), businessId, name: String(d.name), isActive: d.isActive !== false })) });
  await tx.payComponent.createMany({
    data: pr.payComponents.map((c) => ({
      id: must(c.id), businessId, name: String(c.name), kind: c.kind as never, calcType: c.calcType as never, defaultValue: n(c.defaultValue), ruleKey: str(c.ruleKey),
      appliesTo: (c.appliesTo ?? "REGULAR") as never, accountId: id(c.accountId), liabilityAccountId: id(c.liabilityAccountId), systemKey: str(c.systemKey),
      taxable: c.taxable !== false, isActive: c.isActive !== false, sortOrder: n(c.sortOrder ?? 100),
    })),
  });
  await tx.employee.createMany({
    data: pr.employees.map((e) => ({
      id: must(e.id), businessId, code: String(e.code), name: String(e.name), mobile: str(e.mobile), email: str(e.email), address: str(e.address), nid: str(e.nid), tin: str(e.tin),
      departmentId: id(e.departmentId), designation: str(e.designation), joiningDate: date(e.joiningDate)!, exitDate: date(e.exitDate), status: e.status as never, basicSalary: n(e.basicSalary),
      overtimeEligible: e.overtimeEligible !== false, overtimeRate: e.overtimeRate === null || e.overtimeRate === undefined ? null : n(e.overtimeRate),
      paymentMethod: str(e.paymentMethod), bankName: str(e.bankName), bankAccountNo: str(e.bankAccountNo), notes: str(e.notes),
    })),
  });
  await tx.employeeSalaryComponent.createMany({ data: pr.employeeComponents.map((l) => ({ id: must(l.id), employeeId: must(l.employeeId), componentId: must(l.componentId), calcType: l.calcType as never, value: n(l.value) })) });
  await tx.salaryRevision.createMany({
    data: pr.salaryRevisions.map((r) => ({
      id: must(r.id), businessId, employeeId: must(r.employeeId), effectiveFrom: date(r.effectiveFrom)!, basicSalary: n(r.basicSalary),
      structure: (r.structure ?? {}) as Prisma.InputJsonValue, note: str(r.note), createdById: userId, createdAt: date(r.createdAt) ?? undefined,
    })),
  });
  await tx.attendance.createMany({
    data: pr.attendances.map((a) => ({ id: must(a.id), businessId, employeeId: must(a.employeeId), date: date(a.date)!, status: a.status as never, overtimeHours: n(a.overtimeHours), lateMinutes: n(a.lateMinutes), note: str(a.note) })),
  });
  await tx.payrollRun.createMany({
    data: pr.payrollRuns.map((r) => ({
      id: must(r.id), businessId, year: n(r.year), month: n(r.month), kind: r.kind as never, status: r.status as never, postingDate: date(r.postingDate)!, workingDays: n(r.workingDays),
      totalGross: n(r.totalGross), totalDeductions: n(r.totalDeductions), totalNet: n(r.totalNet), totalEmployer: n(r.totalEmployer), voucherId: id(r.voucherId), note: str(r.note),
      createdById: userId, postedById: r.postedById ? userId : null, postedAt: date(r.postedAt),
    })),
  });
  const DEC = ["basicSalary", "workingDays", "payableDays", "presentDays", "absentDays", "leaveDays", "unpaidLeaveDays", "halfDays", "lateDays", "holidays", "deductedDays", "overtimeHours", "extraOvertimeHours", "overtimeRate", "gross", "totalDeductions", "net", "employerCost", "paidAmount"];
  await tx.payslip.createMany({
    data: pr.payslips.map((x) => ({
      id: must(x.id), businessId, runId: must(x.runId), employeeId: must(x.employeeId), year: n(x.year), month: n(x.month), kind: x.kind as never,
      employeeCode: String(x.employeeCode), employeeName: String(x.employeeName), designation: str(x.designation), departmentName: str(x.departmentName),
      ...Object.fromEntries(DEC.map((k) => [k, n(x[k])])),
    })) as unknown as Prisma.PayslipCreateManyInput[],
  });
  await tx.employeeAdvance.createMany({
    data: pr.advances.map((a) => ({
      id: must(a.id), businessId, employeeId: must(a.employeeId), kind: a.kind as never, date: date(a.date)!, amount: n(a.amount), installment: n(a.installment),
      voucherId: must(a.voucherId), note: str(a.note), createdById: userId,
    })),
  });
  await tx.payslipLine.createMany({
    data: pr.payslipLines.map((l) => ({
      id: must(l.id), payslipId: must(l.payslipId), componentId: id(l.componentId), advanceId: id(l.advanceId), kind: l.kind as never, name: String(l.name), amount: n(l.amount),
      accountId: must(l.accountId), liabilityAccountId: id(l.liabilityAccountId), isManual: Boolean(l.isManual), note: str(l.note), sortOrder: n(l.sortOrder),
    })),
  });
  await tx.salaryPayment.createMany({
    data: pr.salaryPayments.map((x) => ({ id: must(x.id), businessId, employeeId: must(x.employeeId), payslipId: must(x.payslipId), voucherId: must(x.voucherId), date: date(x.date)!, amount: n(x.amount), createdById: userId })),
  });
}
