import { z } from "zod";
import { toAsciiDigits } from "./digits";
import { weighbridgeGross } from "./paddy";
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
/** free / scheme quantity: moves stock with the quantity but is never billed (absent = 0) */
const freeQuantity = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(1_000_000_000, "পরিমাণ খুব বড়").optional();
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
export const BUSINESS_TYPES = ["RETAIL", "WHOLESALE", "PHARMACY", "GROCERY", "ELECTRONICS", "CLOTHING", "RESTAURANT", "MANUFACTURING", "AUTO_RICE_MILL", "SERVICE", "DISTRIBUTION", "DEPOT", "OTHER"] as const;

/** Self-service sign-up: a new owner with a new business. */
export const registrationSchema = z
  .object({
    businessName: requiredText("ব্যবসার/প্রতিষ্ঠানের নাম", 120),
    ownerName: requiredText("মালিকের নাম", 100),
    mobile: mobileSchema,
    email: optionalEmail,
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
  route: optionalText(80), // depot: dealer's route / area
  ownerName: optionalText(150), // depot dealer: proprietor / owner (name = the shop / business)
  imageUrl: z.string().optional().nullable(),
});
export type PartyInput = Omit<z.infer<typeof partySchema>, "groupName" | "route" | "ownerName"> & {
  groupName?: string | null;
  route?: string | null;
  ownerName?: string | null;
  imageUrl?: string | null;
};

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
  imageUrl: z.string().optional().nullable(),
});

/** A user account group; a sub-group (parentId) takes its parent's nature. */
export const accountGroupSchema = z.object({
  name: requiredText("গ্রুপের নাম", 100),
  nature: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"], { errorMap: () => ({ message: "মূল ধরন নির্বাচন করুন" }) }),
  parentId: optionalId,
  description: optionalText(500),
});
export type AccountGroupInput = z.infer<typeof accountGroupSchema>;

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
  depotCommissionRate: money.optional(), // depot: commission per base unit or percent (absent = unchanged)
  depotCommissionType: z.enum(["FIXED", "PERCENT"]).optional(), // absent = unchanged
  isDepotProduct: z.boolean().optional(), // absent = unchanged (new product: general)
  newBrandName: optionalText(80).optional(), // depot form: company / brand typed in — created when not found
  newCategoryName: optionalText(80).optional(), // depot form: product group typed in — created when not found
  minStock: nonNegQty.default(0),
  openingStock: nonNegQty.default(0),
  openingRate: money.default(0),
  trackBatch: z.boolean().default(false),
}).refine((p) => p.depotCommissionType !== "PERCENT" || (p.depotCommissionRate ?? 0) <= 100, { path: ["depotCommissionRate"], message: "শতাংশ ১০০-এর বেশি হতে পারে না" });
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
        freeQuantity,
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

// ───────────────────────── paddy purchase (weighbridge slip) ─────────────────────────

/** Depot delivery challan (see src/lib/depot.ts). Rate = commission per unit (DO release) or sale rate (market sale). */
export const depotDeliverySchema = z
  .object({
    ...voucherHeader,
    mode: z.enum(["COMPANY_PAID", "DEPOT_COLLECTION"], { errorMap: () => ({ message: "ডেলিভারির ধরন নির্বাচন করুন" }) }),
    doNumber: optionalText(60),
    companyAccountId: optionalId, // the company (supplier) — required for a DO release
    dealerAccountId: optionalId, // the dealer (customer) — required for a DO release; empty = cash sale
    warehouseId: optionalId,
    vehicleNo: optionalText(40),
    driverName: optionalText(80),
    notes: optionalText(500),
    lines: z
      // challanRate: the rate printed on the dealer challan (absent → the product's purchase price)
      .array(z.object({ productId: z.string().min(1, "পণ্য নির্বাচন করুন"), quantity, freeQuantity, rate: money.default(0), challanRate: money.optional() }))
      .min(1, "অন্তত একটি পণ্য দিন")
      .max(200, "সর্বোচ্চ ২০০টি লাইন"),
    paidAmount: money.default(0),
    cashAccountId: optionalId,
  })
  .superRefine((v, ctx) => {
    if (v.mode === "COMPANY_PAID") {
      if (!v.companyAccountId) ctx.addIssue({ code: "custom", path: ["companyAccountId"], message: "কোম্পানি নির্বাচন করুন" });
      if (!v.dealerAccountId) ctx.addIssue({ code: "custom", path: ["dealerAccountId"], message: "ডিলার নির্বাচন করুন" });
    } else {
      v.lines.forEach((l, i) => {
        if (!(l.rate > 0)) ctx.addIssue({ code: "custom", path: ["lines", i, "rate"], message: "বিক্রয় দর দিন" });
      });
      if (v.paidAmount > 0 && !v.cashAccountId) ctx.addIssue({ code: "custom", path: ["cashAccountId"], message: "কালেকশনের নগদ/ব্যাংক হিসাব নির্বাচন করুন" });
      if (!v.dealerAccountId && !v.cashAccountId) ctx.addIssue({ code: "custom", path: ["cashAccountId"], message: "ডিলার ছাড়া নগদ বিক্রয়ে নগদ/ব্যাংক হিসাব নির্বাচন করুন" });
    }
  });
export type DepotDeliveryInput = z.infer<typeof depotDeliverySchema>;

/** Commission received from (or adjusted with) a company. */
export const commissionSettlementSchema = z
  .object({
    date: dateField,
    companyAccountId: z.string().min(1, "কোম্পানি নির্বাচন করুন"),
    amount: positiveMoney,
    method: z.enum(["CASH", "ADJUST"]),
    cashAccountId: optionalId,
    reference: optionalText(100),
  })
  .superRefine((v, ctx) => {
    if (v.method === "CASH" && !v.cashAccountId) ctx.addIssue({ code: "custom", path: ["cashAccountId"], message: "যে নগদ/ব্যাংক হিসাবে টাকা এসেছে তা নির্বাচন করুন" });
  });
export type CommissionSettlementInput = z.infer<typeof commissionSettlementSchema>;

/** Depot commission → the business's general income (depot cash out, general cash in). */
export const commissionTransferSchema = z
  .object({
    date: dateField,
    amount: positiveMoney,
    depotCashAccountId: z.string().min(1, "ডিপোর যে নগদ/ব্যাংক থেকে টাকা যাবে তা নির্বাচন করুন"),
    generalCashAccountId: z.string().min(1, "সাধারণ হিসাবের যে নগদ/ব্যাংকে টাকা আসবে তা নির্বাচন করুন"),
    reference: optionalText(100),
  });
export type CommissionTransferInput = z.infer<typeof commissionTransferSchema>;

/** Depot expense: paid from the depot cash (default "ডিপো ক্যাশ") into a general expense head. */
export const depotExpenseSchema = z.object({
  date: dateField,
  expenseAccountId: z.string().min(1, "খরচের খাত নির্বাচন করুন"),
  cashAccountId: z.string().min(1, "পেমেন্ট মেথড (নগদ/ব্যাংক) নির্বাচন করুন"),
  amount: positiveMoney,
  reference: optionalText(100),
  narration: optionalText(500),
});
export type DepotExpenseInput = z.infer<typeof depotExpenseSchema>;

/** Fund transfer between the main cash / bank and "ডিপো ক্যাশ" — IN: main → depot, OUT: depot → main. */
export const depotFundSchema = z.object({
  date: dateField,
  direction: z.enum(["IN", "OUT"], { errorMap: () => ({ message: "স্থানান্তরের দিক নির্বাচন করুন" }) }),
  mainAccountId: z.string().min(1, "মূল নগদ/ব্যাংক হিসাব নির্বাচন করুন"),
  amount: positiveMoney,
  reference: optionalText(100),
  narration: optionalText(500),
});
export type DepotFundInput = z.infer<typeof depotFundSchema>;

export const paddyPurchaseSchema = z
  .object({
    ...voucherHeader,
    partyAccountId: optionalId, // supplier (empty = cash purchase, paid in full)
    productId: z.string().min(1, "ধান (পণ্য) নির্বাচন করুন"),
    warehouseId: optionalId,
    batchNo: optionalText(60),
    bagCount: z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).int("বস্তার সংখ্যা পূর্ণসংখ্যা হবে").min(0, "ঋণাত্মক হতে পারবে না").max(1_000_000).default(0),
    // typed directly, or (weighbridge) loaded − empty vehicle — see the transform below
    grossKg: z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(100_000_000, "ওজন খুব বড়").default(0),
    dhaltaKg: z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(100_000_000).default(0),
    ratePerMon: z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).positive("প্রতি মণের দর দিন").max(10_000_000, "দর খুব বড়"),
    paidAmount: money.default(0),
    cashAccountId: optionalId,
    notes: optionalText(500),
    // auto rice mill: variety, moisture, weighbridge (loaded − empty vehicle = gross) and unloading labour
    variety: optionalText(60),
    moisturePct: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(100, "সর্বোচ্চ ১০০%").nullable()).default(null),
    vehicleGrossKg: z.preprocess((v) => (v === "" || v === null || v === undefined || v === 0 || v === "0" ? null : v), z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).positive().max(100_000_000).nullable()).default(null),
    vehicleTareKg: z.preprocess((v) => (v === "" || v === null || v === undefined || v === 0 || v === "0" ? null : v), z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).positive().max(100_000_000).nullable()).default(null),
    labourCost: money.default(0),
  })
  .superRefine((v, ctx) => {
    if ((v.vehicleGrossKg === null) !== (v.vehicleTareKg === null)) ctx.addIssue({ code: "custom", path: [v.vehicleGrossKg === null ? "vehicleGrossKg" : "vehicleTareKg"], message: "গাড়িসহ ও খালি গাড়ির — দুটো ওজনই দিন (অথবা কোনোটিই নয়)" });
    if (v.vehicleGrossKg !== null && v.vehicleTareKg !== null && v.vehicleTareKg >= v.vehicleGrossKg) ctx.addIssue({ code: "custom", path: ["vehicleTareKg"], message: "খালি গাড়ির ওজন গাড়িসহ ওজনের চেয়ে কম হতে হবে" });
    if (v.labourCost > 0 && !v.cashAccountId) ctx.addIssue({ code: "custom", path: ["cashAccountId"], message: "লেবার খরচ কোন নগদ/ব্যাংক থেকে দেওয়া হলো তা নির্বাচন করুন" });
    const gross = weighbridgeGross(v.vehicleGrossKg, v.vehicleTareKg) ?? v.grossKg;
    if (!(gross > 0)) ctx.addIssue({ code: "custom", path: ["grossKg"], message: "মোট ওজন দিন (অথবা গাড়িসহ ও খালি গাড়ির ওজন)" });
    else if (v.dhaltaKg >= gross) ctx.addIssue({ code: "custom", path: ["dhaltaKg"], message: "ঢলতা মোট ওজনের চেয়ে কম হতে হবে" });
    if (v.paidAmount > 0 && !v.cashAccountId) ctx.addIssue({ code: "custom", path: ["cashAccountId"], message: "পরিশোধের নগদ/ব্যাংক হিসাব নির্বাচন করুন" });
    if (!v.partyAccountId && !v.cashAccountId) ctx.addIssue({ code: "custom", path: ["cashAccountId"], message: "সরবরাহকারী ছাড়া নগদ ক্রয়ে নগদ/ব্যাংক হিসাব নির্বাচন করুন" });
  })
  .transform((v) => ({ ...v, grossKg: weighbridgeGross(v.vehicleGrossKg, v.vehicleTareKg) ?? v.grossKg }));
export type PaddyPurchaseInput = z.infer<typeof paddyPurchaseSchema>;

// ───────────────────────── production (BOM) ─────────────────────────

const costShare = z.coerce.number({ invalid_type_error: "সঠিক সংখ্যা দিন" }).min(0, "ঋণাত্মক হতে পারবে না").max(100, "সর্বোচ্চ ১০০%");
const productLine = { productId: z.string().min(1, "পণ্য নির্বাচন করুন"), quantity };

/** Shared rules: products not repeated, none both material and product, output shares total 100 %. */
function productionRules(v: { inputs: { productId: string }[]; outputs: { productId: string; costShare: number }[] }, ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const [kind, list] of [["inputs", v.inputs], ["outputs", v.outputs]] as const) {
    list.forEach((l, i) => {
      if (seen.has(l.productId)) ctx.addIssue({ code: "custom", path: [kind, i, "productId"], message: "একই পণ্য একাধিকবার বা কাঁচামাল ও উৎপাদিত পণ্য — দুই জায়গায় দেওয়া যাবে না" });
      seen.add(l.productId);
    });
  }
  const total = v.outputs.reduce((s, o) => s + o.costShare, 0);
  if (Math.abs(total - 100) >= 0.01) ctx.addIssue({ code: "custom", path: ["outputs"], message: `উৎপাদিত পণ্যের খরচ-ভাগের যোগফল ১০০% হতে হবে (এখন ${Math.round(total * 100) / 100}%)` });
}

export const recipeSchema = z
  .object({
    name: requiredText("রেসিপির নাম", 120),
    code: optionalText(40),
    description: optionalText(500),
    isActive: z.boolean().default(true),
    inputs: z.array(z.object(productLine)).min(1, "কমপক্ষে একটি কাঁচামাল দিন").max(50),
    outputs: z.array(z.object({ ...productLine, costShare })).min(1, "কমপক্ষে একটি উৎপাদিত পণ্য দিন").max(50),
  })
  .superRefine(productionRules);
export type RecipeInput = z.infer<typeof recipeSchema>;

export const productionSchema = z
  .object({
    ...voucherHeader,
    recipeId: optionalId,
    batches: z.coerce.number().positive().max(1_000_000).default(1),
    warehouseId: optionalId,
    inputs: z.array(z.object({ ...productLine, batchNo: optionalText(60) })).min(1, "কমপক্ষে একটি কাঁচামাল দিন").max(50),
    outputs: z.array(z.object({ ...productLine, costShare, batchNo: optionalText(60), expiryDate: optionalDate })).min(1, "কমপক্ষে একটি উৎপাদিত পণ্য দিন").max(50),
    extraCost: money.default(0),
    costAccountId: optionalId,
  })
  .superRefine((v, ctx) => {
    productionRules(v, ctx);
    if (v.extraCost > 0 && !v.costAccountId) ctx.addIssue({ code: "custom", path: ["costAccountId"], message: "অতিরিক্ত খরচ কোন হিসাব থেকে (নগদ/ব্যাংক/খরচ খাত) তা নির্বাচন করুন" });
  });
export type ProductionInput = z.infer<typeof productionSchema>;

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

/**
 * The business types an owner picks in settings ("ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা"): any number of BUSINESS_TYPES, none = a
 * general business. DEPOT turns on depot management; the others the general sales / POS / purchase / inventory menus.
 */
export const businessTypesSchema = z.object({
  businessTypes: z
    .array(z.string({ invalid_type_error: "ব্যবসার ধরন সঠিক নয়" }).trim().toUpperCase().pipe(z.enum(BUSINESS_TYPES, { errorMap: () => ({ message: "অজানা ব্যবসার ধরন" }) })), { invalid_type_error: "ব্যবসার ধরনের তালিকা দিন" })
    .max(BUSINESS_TYPES.length)
    .transform((v) => BUSINESS_TYPES.filter((t) => v.includes(t))), // distinct, in the list's own order
});
export type BusinessTypesInput = z.infer<typeof businessTypesSchema>;

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
      .transform((v) => (v ? toAsciiDigits(v).replace(/\s/g, "") : null))
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
