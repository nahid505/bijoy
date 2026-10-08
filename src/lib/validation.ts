import { z } from "zod";
import { round2 } from "./calc";
import { looksLikeEmail, normalizeBdMobile } from "./mobile";

const MAX_AMOUNT = 999_999_999_999;

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `সর্বোচ্চ ${max} অক্ষর`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const requiredText = (label: string, max = 200) =>
  z.string({ required_error: `${label} আবশ্যক` }).trim().min(1, `${label} আবশ্যক`).max(max, `সর্বোচ্চ ${max} অক্ষর`);

const money = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(MAX_AMOUNT, "পরিমাণ খুব বড়");
const positiveMoney = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).positive("শূন্যের বেশি হতে হবে").max(MAX_AMOUNT, "পরিমাণ খুব বড়");
const quantity = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).positive("পরিমাণ শূন্যের বেশি হতে হবে").max(1_000_000_000, "পরিমাণ খুব বড়");
const nonNegQty = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(1_000_000_000);
const dateField = z.coerce.date({ errorMap: () => ({ message: "সঠিক তারিখ দিন" }) });
const optionalId = z.string().trim().optional().nullable().transform((v) => (v ? v : null));
const email = z.string().trim().toLowerCase().email("সঠিক ইমেইল দিন").max(200);
const optionalEmail = z.union([email, z.literal("")]).optional().nullable().transform((v) => (v ? v : null));

// ───────────────────────── auth ─────────────────────────

/** Login with a mobile number or an e-mail address (field name kept as "email" for compatibility). */
export const loginSchema = z.object({
  email: z
    .string({ required_error: "মোবাইল নম্বর বা ইমেইল দিন" })
    .trim()
    .min(1, "মোবাইল নম্বর বা ইমেইল দিন")
    .max(200)
    .transform((v, ctx) => {
      if (looksLikeEmail(v)) return { kind: "email" as const, value: v.toLowerCase() };
      const mobile = normalizeBdMobile(v);
      if (!mobile) {
        ctx.addIssue({ code: "custom", message: "সঠিক মোবাইল নম্বর বা ইমেইল দিন" });
        return z.NEVER;
      }
      return { kind: "mobile" as const, value: mobile };
    }),
  password: z.string().min(1, "পাসওয়ার্ড আবশ্যক").max(200),
});

// Frequently used passwords that pass the length / character rules but must still be refused.
const COMMON_PASSWORDS = new Set([
  "password1", "password123", "passw0rd", "abc12345", "abcd1234", "qwerty123", "qwerty12", "a1234567", "12345678a", "1q2w3e4r",
  "iloveyou1", "welcome1", "admin123", "letmein1", "bangladesh1", "bangladesh123", "dhaka123", "bijoy123", "lenden123", "pass1234",
]);
const HAS_LETTER = /[A-Za-zঀ-৿]/;
const HAS_DIGIT = /[0-9০-৯]/;
const ONE_CHAR_REPEATED = /^(.)\1+$/;

/** New passwords: 8–128 characters, at least one letter and one digit, not a common password. */
export const passwordSchema = z
  .string({ required_error: "পাসওয়ার্ড আবশ্যক" })
  .min(8, "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে")
  .max(128, "পাসওয়ার্ড সর্বোচ্চ ১২৮ অক্ষরের হতে পারে")
  .refine((v) => HAS_LETTER.test(v) && HAS_DIGIT.test(v), "পাসওয়ার্ডে অন্তত একটি অক্ষর ও একটি সংখ্যা থাকতে হবে")
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()) && !ONE_CHAR_REPEATED.test(v), "পাসওয়ার্ডটি খুব সহজ — অনুমানযোগ্য নয় এমন পাসওয়ার্ড দিন");

export const mobileSchema = z
  .string({ required_error: "মোবাইল নম্বর আবশ্যক" })
  .trim()
  .min(1, "মোবাইল নম্বর আবশ্যক")
  .max(30, "সঠিক মোবাইল নম্বর দিন")
  .transform((v, ctx) => {
    const m = normalizeBdMobile(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)" });
      return z.NEVER;
    }
    return m;
  });

/** Business types offered at sign-up (key → label in src/lib/business-types.ts). */
export const BUSINESS_TYPES = ["RETAIL", "WHOLESALE", "PHARMACY", "GROCERY", "ELECTRONICS", "CLOTHING", "RESTAURANT", "MANUFACTURING", "SERVICE", "DISTRIBUTION", "OTHER"] as const;

/** Self-service sign-up: a new owner with a new business. */
export const registrationSchema = z
  .object({
    businessName: requiredText("ব্যবসার/প্রতিষ্ঠানের নাম", 120),
    ownerName: requiredText("মালিকের নাম", 100),
    mobile: mobileSchema,
    email: optionalEmail,
    businessType: z.enum(BUSINESS_TYPES).optional().nullable().catch(null).transform((v) => v ?? null),
    address: optionalText(300),
    plan: z.string().trim().max(30).regex(/^[A-Z0-9_]*$/).optional().nullable().catch(null).transform((v) => (v ? v : null)),
    password: passwordSchema,
    confirmPassword: z.string({ required_error: "পাসওয়ার্ড নিশ্চিত করুন" }).min(1, "পাসওয়ার্ড নিশ্চিত করুন"),
  })
  .superRefine((v, ctx) => {
    if (typeof v.password === "string" && v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "পাসওয়ার্ড দুটি মিলছে না" });
    // field-level failures (e.g. an invalid mobile) still reach this refinement: check types first
    if (typeof v.mobile === "string" && typeof v.password === "string" && v.password.replace(/[^0-9]/g, "").includes(v.mobile.slice(1))) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "মোবাইল নম্বর দিয়ে পাসওয়ার্ড বানানো যাবে না" });
    }
    for (const field of ["businessName", "ownerName"] as const) {
      if (typeof v[field] === "string" && /[<>]/.test(v[field])) ctx.addIssue({ code: "custom", path: [field], message: "নামে < বা > চিহ্ন ব্যবহার করা যাবে না" });
    }
  });
export type RegistrationInput = z.infer<typeof registrationSchema>;

const OTP_CODE = /^[0-9০-৯]{6}$/;

export const resetPasswordSchema = z
  .object({
    mobile: mobileSchema,
    otp: z.string().trim().regex(OTP_CODE, "৬ অঙ্কের কোড দিন"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "পাসওয়ার্ড নিশ্চিত করুন"),
  })
  .superRefine((v, ctx) => {
    if (typeof v.newPassword === "string" && v.newPassword !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "পাসওয়ার্ড দুটি মিলছে না" });
  });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "বর্তমান পাসওয়ার্ড দিন"), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "পাসওয়ার্ড মিলছে না" });

export const profileSchema = z.object({
  name: requiredText("নাম"),
  mobile: z
    .string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (!v) return null;
      const m = normalizeBdMobile(v);
      if (!m) {
        ctx.addIssue({ code: "custom", message: "সঠিক মোবাইল নম্বর দিন" });
        return z.NEVER;
      }
      return m;
    }),
});

// ───────────────────────── master data ─────────────────────────

export const partySchema = z.object({
  name: requiredText("নাম"),
  mobile: optionalText(30),
  email: optionalEmail,
  address: optionalText(500),
  openingBalance: money.default(0),
  notes: optionalText(1000),
  creditLimit: money.default(0),
  creditDays: z.coerce.number().int("পূর্ণ সংখ্যা দিন").min(0).max(3650).default(0),
  groupName: optionalText(60),
});
export type PartyInput = Omit<z.infer<typeof partySchema>, "groupName"> & { groupName?: string | null };

export const accountSchema = z.object({
  name: requiredText("হিসাবের নাম", 150),
  code: optionalText(30),
  groupId: z.string().min(1, "গ্রুপ নির্বাচন করুন"),
  kind: z.enum(["GENERAL", "CASH", "BANK"]).default("GENERAL"),
  description: optionalText(500),
  bankName: optionalText(150),
  accountNumber: optionalText(60),
  openingBalance: money.default(0),
  openingSide: z.enum(["DR", "CR"]).default("DR"),
});

export const productSchema = z.object({
  name: requiredText("পণ্যের নাম"),
  code: optionalText(60),
  barcode: optionalText(80),
  categoryId: optionalId,
  brandId: optionalId,
  unitId: z.string().min(1, "ইউনিট নির্বাচন করুন"),
  purchasePrice: money,
  salePrice: money,
  wholesalePrice: money.default(0),
  minStock: nonNegQty.default(0),
  openingStock: nonNegQty.default(0),
  openingRate: money.default(0),
  trackBatch: z.boolean().default(false),
});
export type ProductInput = z.infer<typeof productSchema>;

export const nameSchema = z.object({ name: requiredText("নাম", 100) });

export const unitSchema = z
  .object({ name: requiredText("ইউনিটের নাম", 50), baseUnitId: optionalId, factor: z.coerce.number().positive("রূপান্তর হার শূন্যের বেশি হতে হবে").default(1) })
  .transform((v) => ({ ...v, factor: v.baseUnitId ? v.factor : 1 }));

export const warehouseSchema = z.object({ name: requiredText("গুদামের নাম", 100), address: optionalText(300) });

// ───────────────────────── vouchers ─────────────────────────

const voucherHeader = {
  date: dateField,
  reference: optionalText(100),
  narration: optionalText(1000),
};

const optionalDate = z
  .union([z.literal(""), z.null(), z.undefined(), z.coerce.date({ errorMap: () => ({ message: "সঠিক তারিখ দিন" }) })])
  .transform((v) => (v instanceof Date ? v : null));

export const tradeVoucherSchema = z.object({
  ...voucherHeader,
  partyAccountId: optionalId,
  warehouseId: optionalId,
  returnOfId: optionalId,
  dueDate: optionalDate,
  discount: money.default(0),
  vatPercent: z.coerce.number().min(0).max(100).default(0),
  payments: z
    .array(z.object({ accountId: z.string().min(1, "নগদ/ব্যাংক হিসাব নির্বাচন করুন"), amount: positiveMoney, reference: optionalText(100) }))
    .max(10)
    .default([]),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "পণ্য নির্বাচন করুন"),
        unitId: optionalId,
        quantity,
        rate: money,
        discount: money.default(0),
        batchNo: optionalText(60),
        expiryDate: optionalDate,
        mfgDate: optionalDate,
      }),
    )
    .min(1, "কমপক্ষে একটি পণ্য যোগ করুন")
    .max(300),
});
export type TradeVoucherInput = z.infer<typeof tradeVoucherSchema>;

export const cashVoucherSchema = z.object({
  ...voucherHeader,
  cashAccountId: z.string().min(1, "নগদ/ব্যাংক হিসাব নির্বাচন করুন"),
  lines: z
    .array(z.object({ accountId: z.string().min(1, "হিসাব নির্বাচন করুন"), amount: positiveMoney, narration: optionalText(300) }))
    .min(1, "কমপক্ষে একটি লাইন যোগ করুন")
    .max(100),
});
export type CashVoucherInput = z.infer<typeof cashVoucherSchema>;

export const journalVoucherSchema = z
  .object({
    ...voucherHeader,
    lines: z
      .array(z.object({ accountId: z.string().min(1, "হিসাব নির্বাচন করুন"), debit: money.default(0), credit: money.default(0), narration: optionalText(300) }))
      .min(2, "কমপক্ষে দুটি লাইন প্রয়োজন")
      .max(200),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if (l.debit > 0 && l.credit > 0) ctx.addIssue({ code: "custom", path: ["lines", i, "debit"], message: "একই লাইনে ডেবিট ও ক্রেডিট নয়" });
      if (l.debit === 0 && l.credit === 0) ctx.addIssue({ code: "custom", path: ["lines", i, "debit"], message: "ডেবিট বা ক্রেডিট দিন" });
    });
    const dr = round2(v.lines.reduce((s, l) => s + l.debit, 0));
    const cr = round2(v.lines.reduce((s, l) => s + l.credit, 0));
    if (dr !== cr) ctx.addIssue({ code: "custom", path: ["lines"], message: `মোট ডেবিট (${dr}) ও মোট ক্রেডিট (${cr}) সমান নয়` });
  });
export type JournalVoucherInput = z.infer<typeof journalVoucherSchema>;

export const stockJournalSchema = z.object({
  ...voucherHeader,
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, "পণ্য নির্বাচন করুন"),
        warehouseId: z.string().min(1, "গুদাম নির্বাচন করুন"),
        direction: z.coerce.number().pipe(z.union([z.literal(1), z.literal(-1)], { errorMap: () => ({ message: "দিক নির্বাচন করুন" }) })),
        quantity,
        batchNo: optionalText(60),
        expiryDate: optionalDate,
        mfgDate: optionalDate,
        rate: z.coerce.number().min(0).optional().nullable().transform((v) => (v === null || v === undefined || Number.isNaN(v) ? undefined : v)),
      }),
    )
    .min(1, "কমপক্ষে একটি লাইন যোগ করুন")
    .max(200),
});
export type StockJournalInput = z.infer<typeof stockJournalSchema>;

// ───────────────────────── business & users ─────────────────────────

const prefix = (label: string) => requiredText(label, 10).regex(/^[A-Za-z0-9-]+$/, "শুধু ইংরেজি অক্ষর, সংখ্যা ও -");

export const businessSchema = z.object({
  name: requiredText("ব্যবসার নাম"),
  address: optionalText(500),
  mobile: optionalText(50),
  email: optionalEmail,
  binNumber: optionalText(50),
  tinNumber: optionalText(50),
  tradeLicense: optionalText(80),
  currency: requiredText("মুদ্রা", 10),
  currencySymbol: requiredText("মুদ্রা চিহ্ন", 5),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  booksStartDate: dateField,
  invoicePrefix: prefix("ইনভয়েস প্রিফিক্স"),
  defaultVatPercent: z.coerce.number().min(0).max(100),
  invoiceFooter: optionalText(300),
  invoiceTerms: optionalText(1000),
  lockDate: optionalDate,
  expiryWarningDays: z
    .array(z.coerce.number().int("পূর্ণ দিন দিন").min(1, "কমপক্ষে ১ দিন").max(3650, "সর্বোচ্চ ৩৬৫০ দিন"))
    .min(1, "কমপক্ষে একটি সতর্কতা দিন")
    .max(8)
    .transform((v) => [...new Set(v)].sort((a, b) => b - a)),
  allowExpiredSale: z.boolean().default(false),
});

export const newBusinessSchema = z.object({
  name: requiredText("ব্যবসার নাম"),
  mobile: optionalText(50),
  address: optionalText(500),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(7),
});

export const memberSchema = z.object({
  name: requiredText("নাম"),
  email,
  roleId: z.string().min(1, "রোল নির্বাচন করুন"),
  isActive: z.boolean().default(true),
  password: z.union([passwordSchema, z.literal("")]).optional().transform((v) => (v ? v : undefined)),
});

export const roleSchema = z.object({
  name: requiredText("রোলের নাম", 60),
  description: optionalText(300),
  permissions: z.array(z.string()).default([]),
});

// ───────────────────────── payroll ─────────────────────────

const asciiDigits = (v: string) => v.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
const optionalMobile = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const m = normalizeBdMobile(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)" });
      return z.NEVER;
    }
    return m;
  });
const optionalDateField = z
  .union([z.literal(""), z.null(), z.undefined(), dateField])
  .transform((v) => (v instanceof Date ? v : null));
const calcType = z.enum(["FIXED", "PERCENT_OF_BASIC", "PERCENT_OF_GROSS", "RULE"]);
const hours = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(744, "ঘণ্টা খুব বেশি");

export const employeeSchema = z
  .object({
    code: z.string().trim().max(30).optional().nullable().transform((v) => (v ? v : null)),
    name: requiredText("কর্মচারীর নাম", 150),
    mobile: optionalMobile,
    email: optionalEmail,
    address: optionalText(500),
    nid: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v ? asciiDigits(v).replace(/\s/g, "") : null))
      .refine((v) => v === null || /^(\d{10}|\d{13}|\d{17})$/.test(v), "জাতীয় পরিচয়পত্র নম্বর ১০, ১৩ বা ১৭ অঙ্কের হতে হবে"),
    tin: optionalText(30),
    departmentId: optionalId,
    designation: optionalText(100),
    joiningDate: dateField,
    exitDate: optionalDateField,
    status: z.enum(["ACTIVE", "PROBATION", "ON_LEAVE", "RESIGNED", "TERMINATED"]).default("ACTIVE"),
    basicSalary: money,
    overtimeEligible: z.boolean().default(true),
    overtimeRate: z.union([z.literal(""), z.null(), z.undefined(), money]).transform((v) => (typeof v === "number" && v > 0 ? v : null)),
    paymentMethod: z.enum(["CASH", "BANK", "MOBILE"]).optional().nullable().transform((v) => v ?? null),
    bankName: optionalText(100),
    bankAccountNo: optionalText(60),
    notes: optionalText(1000),
    components: z
      .array(z.object({ componentId: z.string().min(1, "উপাদান নির্বাচন করুন"), calcType, value: money }))
      .max(50)
      .default([]),
    revisionNote: optionalText(300),
    effectiveFrom: optionalDateField,
  })
  .superRefine((v, ctx) => {
    if (v.exitDate && v.joiningDate && v.exitDate < v.joiningDate) ctx.addIssue({ code: "custom", path: ["exitDate"], message: "অব্যাহতির তারিখ যোগদানের আগে হতে পারে না" });
    const seen = new Set<string>();
    v.components.forEach((c, i) => {
      if (seen.has(c.componentId)) ctx.addIssue({ code: "custom", path: ["components", i, "componentId"], message: "একই উপাদান দুবার দেওয়া হয়েছে" });
      seen.add(c.componentId);
      if (c.calcType !== "FIXED" && c.value > 1000) ctx.addIssue({ code: "custom", path: ["components", i, "value"], message: "শতাংশ ১০০০ এর বেশি হতে পারে না" });
    });
  });
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const payComponentSchema = z
  .object({
    name: requiredText("উপাদানের নাম", 80),
    kind: z.enum(["EARNING", "DEDUCTION", "EMPLOYER"]),
    calcType,
    defaultValue: money,
    ruleKey: optionalText(60),
    appliesTo: z.enum(["REGULAR", "BONUS"]).default("REGULAR"),
    accountId: optionalId,
    liabilityAccountId: optionalId,
    taxable: z.boolean().default(true),
    isActive: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "EARNING" && v.calcType === "PERCENT_OF_GROSS") ctx.addIssue({ code: "custom", path: ["calcType"], message: "আয়ের উপাদান মোট বেতনের % হতে পারে না" });
    if (v.calcType !== "FIXED" && v.calcType !== "RULE" && v.defaultValue > 1000) ctx.addIssue({ code: "custom", path: ["defaultValue"], message: "শতাংশ ১০০০ এর বেশি হতে পারে না" });
  });
export type PayComponentInput = z.infer<typeof payComponentSchema>;

export const payrollSettingsSchema = z.object({
  workingDaysMode: z.enum(["FIXED", "CALENDAR", "CALENDAR_LESS_OFF_DAYS"]),
  fixedWorkingDays: z.coerce.number().int().min(1, "১ থেকে ৩১").max(31, "১ থেকে ৩১"),
  weeklyOffDays: z.array(z.coerce.number().int().min(0).max(6)).max(6).default([]),
  hoursPerDay: z.coerce.number().min(1, "১ থেকে ২৪").max(24, "১ থেকে ২৪"),
  overtimeMultiplier: z.coerce.number().min(1, "১ থেকে ৫").max(5, "১ থেকে ৫"),
  lateDaysPerAbsence: z.coerce.number().int().min(0).max(31),
  absenceBasis: z.enum(["BASIC", "GROSS"]),
  salaryPayableAccountId: optionalId,
  advanceAccountId: optionalId,
});
export type PayrollSettingsFormInput = z.infer<typeof payrollSettingsSchema>;

export const attendanceSchema = z.object({
  date: dateField,
  rows: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        status: z.enum(["PRESENT", "LATE", "ABSENT", "LEAVE", "UNPAID_LEAVE", "HALF_DAY", "HOLIDAY"]).nullable(),
        overtimeHours: z.coerce.number().min(0, "ঋণাত্মক হতে পারবে না").max(24, "দিনে সর্বোচ্চ ২৪ ঘণ্টা"),
        lateMinutes: z.coerce.number().int().min(0).max(1440).default(0),
        note: optionalText(200),
      }),
    )
    .max(2000),
});

export const payrollRunSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "মাস নির্বাচন করুন"),
  kind: z.enum(["REGULAR", "BONUS"]).default("REGULAR"),
  postingDate: dateField,
  note: optionalText(300),
});

export const payslipAdjustSchema = z.object({
  extraOvertimeHours: hours.default(0),
  manual: z
    .array(z.object({ componentId: z.string().min(1, "উপাদান নির্বাচন করুন"), amount: positiveMoney, note: optionalText(200) }))
    .max(30)
    .default([]),
});

export const salaryPaymentSchema = z.object({
  date: dateField,
  cashAccountId: z.string().min(1, "নগদ/ব্যাংক হিসাব নির্বাচন করুন"),
  reference: optionalText(100),
  narration: optionalText(300),
  items: z.array(z.object({ employeeId: z.string().min(1), amount: positiveMoney })).min(1, "অন্তত একজন কর্মচারী নির্বাচন করুন").max(2000),
});

export const advanceSchema = z
  .object({
    employeeId: z.string().min(1, "কর্মচারী নির্বাচন করুন"),
    kind: z.enum(["ADVANCE", "LOAN"]),
    date: dateField,
    amount: positiveMoney,
    installment: positiveMoney,
    cashAccountId: z.string().min(1, "নগদ/ব্যাংক হিসাব নির্বাচন করুন"),
    note: optionalText(300),
  })
  .refine((v) => v.installment <= v.amount, { path: ["installment"], message: "কিস্তি মোট টাকার বেশি হতে পারে না" });

export const departmentSchema = z.object({ name: requiredText("বিভাগের নাম", 80) });

/** Flatten zod errors into { "path.to.field": [messages] } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
