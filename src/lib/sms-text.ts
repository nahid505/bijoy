// SMS text rules — pure and unit-tested.
//
// Encoding: a message that uses only the GSM 03.38 alphabet is sent as GSM-7 (160 chars, or 153
// per part when split); anything else — Bangla included — is sent as UCS-2 (70 UTF-16 units, or
// 67 per part). GSM extension characters (€ [ ] { } \ ^ ~ |) take two septets.

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";
const BASIC = new Set(GSM_BASIC);
const EXTENDED = new Set(GSM_EXTENDED);

export type SmsEncoding = "GSM7" | "UCS2";

export interface SmsSegments {
  encoding: SmsEncoding;
  /** length in the units that count for the encoding (septets or UTF-16 code units) */
  units: number;
  parts: number;
  perPart: number;
  /** units left in the last part */
  remaining: number;
}

export const MAX_SMS_PARTS = 10;

export function smsSegments(text: string): SmsSegments {
  let gsm = true;
  let septets = 0;
  for (const ch of text) {
    if (BASIC.has(ch)) septets += 1;
    else if (EXTENDED.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const single = septets <= 160;
    const perPart = single ? 160 : 153;
    const parts = Math.max(1, Math.ceil(septets / perPart));
    return { encoding: "GSM7", units: septets, parts, perPart, remaining: parts * perPart - septets };
  }
  const units = text.length; // UTF-16 code units (emoji / surrogate pairs count 2)
  const single = units <= 70;
  const perPart = single ? 70 : 67;
  const parts = Math.max(1, Math.ceil(units / perPart));
  return { encoding: "UCS2", units, parts, perPart, remaining: parts * perPart - units };
}

// ───────────────────────── templates ─────────────────────────

export const SMS_VARIABLES = [
  "customer_name", "supplier_name", "invoice_no", "total", "paid", "due", "date", "business_name", "product_name", "expiry_date", "otp",
] as const;
export type SmsVariable = (typeof SMS_VARIABLES)[number];
export type SmsVars = Partial<Record<SmsVariable | "batch_no" | "quantity" | "days" | "amount" | "time", string>>;

/** Replaces {variable} placeholders; unknown placeholders are removed, values are single-line. */
export function renderTemplate(body: string, vars: SmsVars): string {
  return body
    .replace(/\{([a-z_]+)\}/g, (_, key: string) => (vars[key as SmsVariable] ?? "").replace(/[\r\n]+/g, " ").trim())
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface SmsEventDef {
  key: string;
  label: string;
  group: "customer" | "supplier" | "security" | "inventory";
  /** automatic events can be switched on/off per business; security codes are always sent */
  automatic: boolean;
  defaultBody: string;
  variables: string[];
}

export const SMS_EVENTS: SmsEventDef[] = [
  { key: "SALE_INVOICE", group: "customer", automatic: true, label: "নতুন বিক্রয় ইনভয়েস", variables: ["customer_name", "invoice_no", "total", "paid", "due", "date", "business_name"], defaultBody: "প্রিয় {customer_name}, {business_name} থেকে ইনভয়েস {invoice_no}: মোট ৳{total}, পরিশোধ ৳{paid}, বাকি ৳{due} ({date})। ধন্যবাদ।" },
  { key: "PAYMENT_RECEIVED", group: "customer", automatic: true, label: "টাকা গ্রহণ (আদায়)", variables: ["customer_name", "paid", "due", "date", "business_name", "invoice_no"], defaultBody: "প্রিয় {customer_name}, {date} তারিখে ৳{paid} পরিশোধ পেয়েছি। বর্তমান বাকি ৳{due}। ধন্যবাদ — {business_name}" },
  { key: "DUE_REMINDER", group: "customer", automatic: true, label: "বকেয়া স্মরণ", variables: ["customer_name", "due", "date", "business_name"], defaultBody: "প্রিয় {customer_name}, {business_name} এ আপনার বকেয়া ৳{due}। অনুগ্রহ করে দ্রুত পরিশোধ করুন। ধন্যবাদ।" },
  { key: "SALES_RETURN", group: "customer", automatic: true, label: "বিক্রয় ফেরত", variables: ["customer_name", "invoice_no", "total", "due", "date", "business_name"], defaultBody: "প্রিয় {customer_name}, ফেরত {invoice_no} গ্রহণ করা হয়েছে: ৳{total} ({date})। বর্তমান বাকি ৳{due} — {business_name}" },
  { key: "INVOICE_CANCELLED", group: "customer", automatic: true, label: "ইনভয়েস বাতিল", variables: ["customer_name", "invoice_no", "total", "date", "business_name"], defaultBody: "প্রিয় {customer_name}, ইনভয়েস {invoice_no} (৳{total}) বাতিল করা হয়েছে — {business_name}" },
  { key: "PURCHASE", group: "supplier", automatic: true, label: "ক্রয়", variables: ["supplier_name", "invoice_no", "total", "paid", "due", "date", "business_name"], defaultBody: "প্রিয় {supplier_name}, {business_name} আপনার পণ্য গ্রহণ করেছে: {invoice_no}, মোট ৳{total}, পরিশোধ ৳{paid}, বাকি ৳{due} ({date})।" },
  { key: "SUPPLIER_PAYMENT", group: "supplier", automatic: true, label: "সরবরাহকারীকে পরিশোধ", variables: ["supplier_name", "paid", "due", "date", "business_name"], defaultBody: "প্রিয় {supplier_name}, {business_name} {date} তারিখে ৳{paid} পরিশোধ করেছে। অবশিষ্ট পাওনা ৳{due}।" },
  { key: "PURCHASE_RETURN", group: "supplier", automatic: true, label: "ক্রয় ফেরত", variables: ["supplier_name", "invoice_no", "total", "date", "business_name"], defaultBody: "প্রিয় {supplier_name}, {business_name} পণ্য ফেরত দিয়েছে: {invoice_no}, ৳{total} ({date})।" },
  { key: "SUPPLIER_DUE", group: "supplier", automatic: true, label: "সরবরাহকারীর পাওনা (বিবরণী)", variables: ["supplier_name", "due", "date", "business_name"], defaultBody: "প্রিয় {supplier_name}, {date} পর্যন্ত {business_name} এর কাছে আপনার পাওনা ৳{due}।" },
  { key: "LOW_STOCK", group: "inventory", automatic: true, label: "কম স্টক সতর্কতা", variables: ["product_name", "business_name"], defaultBody: "{business_name}: {product_name} এর মজুদ কম ({quantity})। দ্রুত অর্ডার দিন।" },
  { key: "EXPIRY_WARNING", group: "inventory", automatic: true, label: "মেয়াদ শেষের সতর্কতা", variables: ["product_name", "expiry_date", "business_name"], defaultBody: "{business_name}: {product_name} ব্যাচ {batch_no} এর মেয়াদ {days} দিন পর ({expiry_date}) শেষ হবে। মজুদ {quantity}।" },
  { key: "EXPIRED", group: "inventory", automatic: true, label: "মেয়াদোত্তীর্ণ পণ্য", variables: ["product_name", "expiry_date", "business_name"], defaultBody: "{business_name}: {product_name} ব্যাচ {batch_no} এর মেয়াদ {expiry_date} তারিখে শেষ হয়েছে। মজুদ {quantity} — বিক্রি বন্ধ রাখুন।" },
  { key: "REGISTRATION_OTP", group: "security", automatic: false, label: "রেজিস্ট্রেশন OTP", variables: ["otp"], defaultBody: "বিজয় লেনদেন: আপনার রেজিস্ট্রেশন কোড {otp}। ৫ মিনিট বৈধ। কাউকে জানাবেন না।" },
  { key: "LOGIN_OTP", group: "security", automatic: false, label: "লগইন OTP", variables: ["otp"], defaultBody: "বিজয় লেনদেন: আপনার লগইন কোড {otp}। ৫ মিনিট বৈধ। কাউকে জানাবেন না।" },
  { key: "PASSWORD_RESET_OTP", group: "security", automatic: false, label: "পাসওয়ার্ড রিসেট OTP", variables: ["otp"], defaultBody: "বিজয় লেনদেন: পাসওয়ার্ড রিসেট কোড {otp}। ৫ মিনিট বৈধ। আপনি না চাইলে উপেক্ষা করুন।" },
  { key: "NEW_LOGIN_ALERT", group: "security", automatic: false, label: "নতুন লগইন সতর্কতা", variables: ["date"], defaultBody: "বিজয় লেনদেন: আপনার অ্যাকাউন্টে {date} {time} এ নতুন লগইন হয়েছে। আপনি না হলে এখনই পাসওয়ার্ড পরিবর্তন করুন।" },
  { key: "MANUAL", group: "customer", automatic: false, label: "হাতে পাঠানো এসএমএস", variables: ["customer_name", "due", "business_name"], defaultBody: "" },
  { key: "TEST", group: "security", automatic: false, label: "টেস্ট এসএমএস", variables: ["business_name"], defaultBody: "বিজয় লেনদেন: {business_name} এর এসএমএস সেটিং সফলভাবে কাজ করছে।" },
];

export const SMS_EVENT = Object.fromEntries(SMS_EVENTS.map((e) => [e.key, e])) as Record<string, SmsEventDef>;
export const AUTOMATIC_EVENTS = SMS_EVENTS.filter((e) => e.automatic).map((e) => e.key);
/** Templates the business may edit (security codes use fixed platform text). */
export const EDITABLE_EVENTS = SMS_EVENTS.filter((e) => e.group !== "security" && e.key !== "MANUAL");

export const SMS_STATUS_LABELS: Record<string, string> = {
  QUEUED: "অপেক্ষমাণ",
  SENDING: "পাঠানো হচ্ছে",
  SENT: "পাঠানো হয়েছে",
  DELIVERED: "পৌঁছেছে",
  FAILED: "ব্যর্থ",
};
